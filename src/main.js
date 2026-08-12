/**
 * HydroViz 3D — Main Application
 *
 * New Orleans focused flood simulation with:
 * - Click-to-place water origin (pickPosition for accurate elevation)
 * - WASD first-person navigation
 * - Camera view presets
 */

import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles/index.css';

import { initViewer, flyToPreset } from './viewer.js';
import { loadGoogleTiles } from './tiles.js';
import { WaterRenderer } from './water/WaterRenderer.js';
import { ElevationService } from './services/ElevationService.js';
import { Controls, LOCATIONS } from './ui/Controls.js';
import { InfoPanel } from './ui/InfoPanel.js';
import { DamagePanel } from './ui/DamagePanel.js';
import { getSavedToken, showTokenModal } from './ui/TokenModal.js';
import { FirstPersonControls } from './navigation/FirstPersonControls.js';
import { FloatingDebrisManager } from './water/FloatingDebrisManager.js';
import { loadNSIData, findNearestBuilding } from './services/NSIService.js';
import { loadCurvesData } from './data/DepthDamageCurves.js';
import { loadMitigationData } from './data/MitigationService.js';

import { MitigationPanel } from './ui/MitigationPanel.js';

// ─── State ───────────────────────────────────────────────────
let viewer = null;
let elevationService = null;
let waterRenderer = null;
let controls = null;
let infoPanel = null;
let damagePanel = null;
let fpControls = null;
let clickHandler = null;
let debrisManager = null;
let currentLocation = LOCATIONS[0]; // French Quarter
let currentViewPreset = 'aerial';
let previewTimeout = null; // auto-hide timer for region size preview

let mitigationPanel = null;

// ─── Boot ────────────────────────────────────────────────────
async function boot() {
  try {
    const token = await resolveToken();
    Cesium.Ion.defaultAccessToken = token;

    showLoading(true);

    viewer = initViewer('cesiumContainer');
    await loadGoogleTiles(viewer);

    // We will spawn flags dynamically on click instead of at boot
    elevationService = new ElevationService();
    waterRenderer = new WaterRenderer(viewer, elevationService);
    // Show the damage panel prompt once the SWE flow animation finishes
    waterRenderer.onFlowSettled = () => {
      if (controls) {
        controls.hideSimulationProgress();
        controls.setWaterSliderEnabled(true);
      }
      if (damagePanel && !selectedBuilding) damagePanel.showPrompt();
    };

    // Show progress bar when flood animation starts
    waterRenderer.onFlowStart = ({ fastForward }) => {
      if (controls) {
        controls.showSimulationProgress(
          fastForward ? 'Updating flood...' : 'Simulating flood...'
        );
        controls.setWaterSliderEnabled(false);
      }
    };

    // Update progress bar during flood animation
    waterRenderer.onFlowProgress = (progress) => {
      if (controls) controls.updateSimulationProgress(progress);
    };
    fpControls = new FirstPersonControls(viewer);
    debrisManager = new FloatingDebrisManager(viewer);


    // Fire-and-forget: NSI building data (~5MB), depth-damage curves,
    // and mitigation options load in the background.
    loadNSIData();
    loadCurvesData();
    loadMitigationData();

    initUI();
    initClickHandler();

    // Start at French Quarter, aerial view
    flyToPreset(viewer, currentLocation.lng, currentLocation.lat, 'aerial');

    showLoading(false);
    controls.show();
    infoPanel.show();
    document.getElementById('brandBadge').style.display = 'flex';

    console.log('[HydroViz] Application initialized — New Orleans');
  } catch (error) {
    console.error('[HydroViz] Boot failed:', error);
    showError(error.message);
  }
}

// ─── Token ───────────────────────────────────────────────────
async function resolveToken() {
  const saved = getSavedToken();
  if (saved) return saved;
  return showTokenModal();
}

// ─── Click Handler (pickPosition) ────────────────────────────
function initClickHandler() {
  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  clickHandler.setInputAction(async (movement) => {
    // Don't handle clicks when in walk mode (left click is used for looking)
    if (fpControls && fpControls.enabled) return;

    const cartesian = viewer.scene.pickPosition(movement.position);

    if (Cesium.defined(cartesian)) {
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lng = Cesium.Math.toDegrees(cartographic.longitude);
      const clickedElevation = cartographic.height;

      console.log(`[HydroViz] Clicked: ${lat.toFixed(5)}°, ${lng.toFixed(5)}° — clicked surface: ${clickedElevation.toFixed(1)}m`);

      let isBuildingClick = false;
      if (waterRenderer.hasOrigin() && controls.currentLevel > 0) {
        // Any click inside the DEM grid while water is active = building inspect
        if (waterRenderer.isInsideGrid(lat, lng)) {
          isBuildingClick = true;
          handleBuildingClick(lat, lng, clickedElevation);
        }
      }

      if (!isBuildingClick) {
        // Show loading state while fetching USGS elevation
        controls.setElevationLoading(true);
        waterRenderer.clearWaterOnly();
        selectedBuilding = null;
        if (damagePanel) damagePanel.hide();
        if (selectedBuildingMarker) {
          viewer.entities.remove(selectedBuildingMarker);
          selectedBuildingMarker = null;
        }

        // Async: fetches bare-earth elevation + calibrates geoid + fetches DEM grid
        await waterRenderer.setOrigin(lat, lng, clickedElevation, controls.currentRadius);

        // Spawn floating cars within the water radius, passing ground elevation to avoid buildings
        debrisManager.spawnDebris(lat, lng, controls.currentRadius * 111, 15, waterRenderer.getGroundElevation());

        // Hide loading
        controls.setElevationLoading(false);

        // Show NAVD88 (MSL) elevation — much more meaningful to users
        const groundNavd88 = waterRenderer.getGroundNavd88();
        const origin = { lat, lng, elevation: groundNavd88 };

        controls.setOrigin(origin);
        controls.setGroundElevation(groundNavd88);
        infoPanel.setOrigin(origin);
        infoPanel.setGroundElevation(groundNavd88);

        // If water level is already set, animate water spreading from new origin
        if (controls.currentLevel > 0) {
          waterRenderer.animateFloodFill(controls.currentLevel, controls.currentRadius);
          const surfaceNavd88 = waterRenderer.getWaterSurfaceNavd88();
          controls.setWaterSurface(surfaceNavd88);
          infoPanel.setWaterSurface(surfaceNavd88);
          debrisManager.updateWaterLevel(waterRenderer.getWaterSurfaceElevation());
        } else {
          debrisManager.updateWaterLevel(Number.NEGATIVE_INFINITY);
        }
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

let selectedBuildingMarker = null;
let selectedBuilding = null; // { lat, lng } of the building shown in the panel

/**
 * Recompute the open damage panel's figures for the currently selected
 * building. Used after the water level changes, so the panel doesn't keep
 * showing numbers for the previous level. Skips reverse-geocoding — the
 * address hasn't changed, and re-fetching on every slider move would
 * hammer Nominatim.
 */
function refreshDamagePanelForSelection() {
  if (!selectedBuilding) return;
  const { lat, lng } = selectedBuilding;

  const groundElev = waterRenderer.getGroundElevationAt(lat, lng);
  const waterSurface = waterRenderer.getWaterSurfaceNavd88();
  if (groundElev === null || waterSurface === null) return;

  const staticDepth = waterSurface - groundElev;
  if (!waterRenderer.isCellWet(lat, lng) || staticDepth <= 0) {
    // This building is dry at the new level — the panel no longer applies.
    damagePanel.hide();
    if (mitigationPanel) mitigationPanel.hide();
    selectedBuilding = null;
    if (selectedBuildingMarker) {
      viewer.entities.remove(selectedBuildingMarker);
      selectedBuildingMarker = null;
    }
    return;
  }

  const flowState = waterRenderer.getFlowStateAt(lat, lng);
  const waterDepth = staticDepth;

  const nsiMatch = findNearestBuilding(lat, lng);
  damagePanel.setDamageInfo(lat, lng, waterDepth * 3.28084, flowState, nsiMatch);

  // Refresh mitigation panel if visible
  if (mitigationPanel && nsiMatch) {
    mitigationPanel.setBuilding(waterDepth * 3.28084, nsiMatch, lat, lng);
  }
}

async function handleBuildingClick(lat, lng, clickedElevation) {
  const groundElev = waterRenderer.getGroundElevationAt(lat, lng);
  if (groundElev === null) return;

  const waterSurface = waterRenderer.getWaterSurfaceNavd88();
  if (waterSurface === null) return;

  const staticDepth = waterSurface - groundElev;
  if (staticDepth <= 0) return;

  // Only show damage if the solver actually has water at this cell.
  // Prevents phantom damage reports at dry buildings that happen to sit
  // below the water surface MSL but aren't connected to the flood.
  if (!waterRenderer.isCellWet(lat, lng)) return;

  const flowState = waterRenderer.getFlowStateAt(lat, lng);
  // Use the static equilibrium depth (water surface − building ground) for
  // the damage report. The SWE solver's instantaneous h[r][c] reflects
  // dynamic wave motion that may not have fully equilibrated, leading to
  // under-reported depths at buildings near the origin. Flow state is still
  // passed through for velocity and hazard classification.
  const waterDepth = staticDepth;
  if (waterDepth <= 0) return;

  if (selectedBuildingMarker) {
    viewer.entities.remove(selectedBuildingMarker);
    selectedBuildingMarker = null;
  }


  // Place a 3D map pin at the clicked building with a spinning animation
  const pinPosition = Cesium.Cartesian3.fromDegrees(lng, lat, clickedElevation);
  const spinStartTime = Date.now();

  selectedBuildingMarker = viewer.entities.add({
    position: pinPosition,
    orientation: new Cesium.CallbackProperty(() => {
      // One full revolution every 4 seconds
      const elapsed = (Date.now() - spinStartTime) / 1000;
      const heading = Cesium.Math.toRadians((elapsed * 90) % 360);
      return Cesium.Transforms.headingPitchRollQuaternion(
        pinPosition,
        new Cesium.HeadingPitchRoll(heading, 0, 0)
      );
    }, false),
    model: {
      uri: './assets/models/map_pin.glb',
      scale: 1.0,
      minimumPixelSize: 40,
      maximumScale: 30.0,
      color: Cesium.Color.fromCssColorString('#ff3333'),
      colorBlendMode: Cesium.ColorBlendMode.REPLACE,
      colorBlendAmount: 0.9,
    }
  });

  selectedBuilding = { lat, lng };
  const nsiMatch = findNearestBuilding(lat, lng);

  // If no NSI data exists for this building, show the no-data message
  if (!nsiMatch) {
    damagePanel.showNoData(lat, lng);
    if (mitigationPanel) mitigationPanel.hide();
    return;
  }

  damagePanel.show();
  damagePanel.setDamageInfo(lat, lng, waterDepth * 3.28084, flowState, nsiMatch);

  // Prepare mitigation data (panel shown via toggle in damage panel)
  if (mitigationPanel) {
    mitigationPanel.setBuilding(waterDepth * 3.28084, nsiMatch, lat, lng);
    // Don't auto-show — user toggles via "Show Mitigation Analysis" button
    damagePanel._updateMitToggle();
  }
}

function initUI() {
  controls = new Controls({
    onProviderChange: (provider) => {
      elevationService.provider = provider;
      // Clear the map so the user clicks again to fetch new elevation
      const clearBtn = document.getElementById('btnClear');
      if (clearBtn) clearBtn.click();
    },

    onWaterLevelChange: (level) => {
      if (!waterRenderer.hasOrigin()) return;
      waterRenderer.updateWater(level, controls.currentRadius);
      infoPanel.setWaterLevel(level);
      infoPanel.setFloodArea(waterRenderer.getEstimatedArea());
      const surfaceNavd88 = waterRenderer.getWaterSurfaceNavd88();
      controls.setWaterSurface(surfaceNavd88);
      infoPanel.setWaterSurface(surfaceNavd88);
      debrisManager.updateWaterLevel(waterRenderer.getWaterSurfaceElevation());

      if (level > 0) {
        // If a building is already selected, refresh its panel with new depth
        if (selectedBuilding) {
          refreshDamagePanelForSelection();
        }
      } else {
        selectedBuilding = null;
        if (damagePanel) damagePanel.hide();
        if (mitigationPanel) mitigationPanel.hide();
        if (selectedBuildingMarker) {
          viewer.entities.remove(selectedBuildingMarker);
          selectedBuildingMarker = null;
        }
      }
    },

    onRadiusChange: (radius) => {
      // No origin set — show a mesh preview at the camera center
      if (!waterRenderer.hasOrigin()) {
        // Clear any pending hide timer
        if (previewTimeout) clearTimeout(previewTimeout);

        const windowCenter = new Cesium.Cartesian2(
          viewer.canvas.clientWidth / 2,
          viewer.canvas.clientHeight / 2
        );
        let center = viewer.scene.pickPosition(windowCenter);
        if (!Cesium.defined(center)) {
          center = viewer.camera.pickEllipsoid(windowCenter, viewer.scene.globe.ellipsoid);
        }
        if (center) {
          const carto = Cesium.Cartographic.fromCartesian(center);
          waterRenderer.showPreviewRegion(
            Cesium.Math.toDegrees(carto.latitude),
            Cesium.Math.toDegrees(carto.longitude),
            radius,
            carto.height || 0
          );
        }

        // Auto-hide after 1.5s of no slider activity
        previewTimeout = setTimeout(() => {
          waterRenderer.removePreviewRegion();
          previewTimeout = null;
        }, 1500);

        return;
      }
      if (controls.currentLevel <= 0) return;
      waterRenderer.updateWater(controls.currentLevel, radius);
      infoPanel.setFloodArea(waterRenderer.getEstimatedArea());
    },

    onFlyTo: (location) => {
      currentLocation = location;
      infoPanel.setLocation(location.name);

      // Disable walk mode when flying
      if (fpControls.enabled) {
        fpControls.disable();
        controls.walkMode = false;
        // Reset walk button UI
        const btn = document.getElementById('btnWalk');
        if (btn) btn.classList.remove('active');
        const hints = document.getElementById('walkHints');
        if (hints) hints.style.display = 'none';
        const orbit = document.getElementById('orbitHints');
        if (orbit) orbit.style.display = 'block';
        const icon = document.getElementById('walkIcon');
        if (icon) icon.textContent = '⊙';
      }

      flyToPreset(viewer, location.lng, location.lat, currentViewPreset);
    },

    onViewChange: (preset) => {
      currentViewPreset = preset;

      // Disable walk mode when changing view presets
      if (fpControls.enabled) {
        fpControls.disable();
        controls.walkMode = false;
        const btn = document.getElementById('btnWalk');
        if (btn) btn.classList.remove('active');
        const hints = document.getElementById('walkHints');
        if (hints) hints.style.display = 'none';
        const orbit = document.getElementById('orbitHints');
        if (orbit) orbit.style.display = 'block';
        const icon = document.getElementById('walkIcon');
        if (icon) icon.textContent = '⊙';
      }

      flyToPreset(viewer, currentLocation.lng, currentLocation.lat, preset);
    },

    onWalkToggle: (enabled) => {
      if (enabled) {
        fpControls.enable();
      } else {
        fpControls.disable();
      }
    },

    onAnimate: async (targetLevel) => {
      if (!waterRenderer.hasOrigin()) {
        console.warn('[HydroViz] Click on the map first to set a water origin');
        return;
      }

      const level = targetLevel > 0 ? targetLevel : 5;
      waterRenderer.clearWaterOnly();

      await waterRenderer.animateRise(level, 3000, (currentLevel) => {
        controls.setWaterLevelDisplay(currentLevel);
        infoPanel.setWaterLevel(currentLevel);
        infoPanel.setFloodArea(waterRenderer.getEstimatedArea());
        const surfaceNavd88 = waterRenderer.getWaterSurfaceNavd88();
        controls.setWaterSurface(surfaceNavd88);
        infoPanel.setWaterSurface(surfaceNavd88);

        // Pass smooth current level to debris manager
        const surfaceEllipsoid = waterRenderer.getGroundElevation() + currentLevel;
        debrisManager.updateWaterLevel(surfaceEllipsoid);
      });

      // Show the damage panel with a prompt to click on buildings
      if (damagePanel) damagePanel.showPrompt();
    },

    onClear: () => {
      waterRenderer.clear();
      debrisManager.clear();

      selectedBuilding = null;
      debrisManager.updateWaterLevel(Number.NEGATIVE_INFINITY);
      infoPanel.setWaterLevel(0);
      infoPanel.setFloodArea(0);
      infoPanel.setWaterSurface(null);
      infoPanel.setOrigin(null);
      infoPanel.setGroundElevation(null);
      if (damagePanel) damagePanel.hide();
      if (mitigationPanel) mitigationPanel.hide();
      if (selectedBuildingMarker) {
        viewer.entities.remove(selectedBuildingMarker);
        selectedBuildingMarker = null;
      }
    },
  });

  infoPanel = new InfoPanel(viewer);
  damagePanel = new DamagePanel(viewer, {
    onClose: () => {
      if (selectedBuildingMarker) {
        viewer.entities.remove(selectedBuildingMarker);
        selectedBuildingMarker = null;
      }
    },
  });
  mitigationPanel = new MitigationPanel({
    onClose: () => {
      damagePanel._updateMitToggle();
    },
  });
  damagePanel.setMitigationPanel(mitigationPanel);
  infoPanel.setLocation(currentLocation.name);
}

// ─── Loading / Error ─────────────────────────────────────────
function showLoading(show) {
  document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
}

function showError(message) {
  showLoading(false);
  const overlay = document.getElementById('loadingOverlay');
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div style="text-align: center; max-width: 500px; padding: 24px;">
      <h2 style="font-size: 1.1rem; margin-bottom: 12px; color: #c44;">Error</h2>
      <p style="color: #999; font-size: 0.85rem; line-height: 1.6;">${message}</p>
      <button onclick="location.reload()"
        style="margin-top: 20px; padding: 10px 24px; background: #2a2f3e;
        border: 1px solid #444; border-radius: 6px; color: #ddd; cursor: pointer; font-family: inherit;">
        Reload
      </button>
    </div>
  `;
}

// ─── Start ───────────────────────────────────────────────────
boot();
