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
import { loadNSIData, findNearestBuilding, getAllBuildings, mapOccupancyClass } from './services/NSIService.js';
import { getDamageEstimate } from './data/DepthDamageCurves.js';
import { hazardFromFlow } from './water/HazardRating.js';

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
let activeFlagEntities = []; // store dynamically spawned flags
let activePOIData = []; // store the metadata of POIs for click matching
let previewTimeout = null; // auto-hide timer for region size preview
let pendingRiskFlagRequest = null; // risk flags waiting on the flow to settle

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
    // Risk flags are placed only once the water has settled, so they can be
    // classified with real depth×velocity from the start.
    waterRenderer.onFlowSettled = () => {
      if (!pendingRiskFlagRequest) return;
      const req = pendingRiskFlagRequest;
      pendingRiskFlagRequest = null;
      spawnRiskFlags(req.lat, req.lng, req.radiusKm);
    };
    fpControls = new FirstPersonControls(viewer);
    debrisManager = new FloatingDebrisManager(viewer);

    // Fire-and-forget: NSI building data (~5MB) loads in the background.
    // findNearestBuilding() returns null gracefully until it's ready.
    loadNSIData();

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
      if (waterRenderer.hasOrigin()) {
        const origin = waterRenderer.getOrigin();
        const originCarto = Cesium.Cartographic.fromDegrees(origin.lng, origin.lat);
        const clickCarto = Cesium.Cartographic.fromDegrees(lng, lat);
        const geodesic = new Cesium.EllipsoidGeodesic(originCarto, clickCarto);
        const distanceM = geodesic.surfaceDistance;

        // currentRadius is in degrees. ~111,000 meters per degree
        const radiusM = controls.currentRadius * 111000;

        // Treat click as building inspect if inside radius AND water is active
        if (distanceM <= radiusM && controls.currentLevel > 0) {
          // Check if click is near an active POI (within ~40 meters)
          let matchedPOI = null;
          let minDistance = 40; // 40 meters tolerance

          for (const poi of activePOIData) {
            const poiCarto = Cesium.Cartographic.fromDegrees(poi.lng, poi.lat);
            const poiGeodesic = new Cesium.EllipsoidGeodesic(poiCarto, clickCarto);
            const dist = poiGeodesic.surfaceDistance;
            if (dist < minDistance) {
              minDistance = dist;
              matchedPOI = poi;
            }
          }

          // Alternatively, check if they explicitly clicked a flag entity
          const pickedObject = viewer.scene.pick(movement.position);
          if (Cesium.defined(pickedObject) && Cesium.defined(pickedObject.id)) {
            const pickedPOI = activePOIData.find(p => p.entity === pickedObject.id);
            if (pickedPOI) matchedPOI = pickedPOI;
          }

          if (matchedPOI) {
            isBuildingClick = true;
            // Overwrite the click coordinates with the exact POI coordinates
            handleBuildingClick(matchedPOI.lat, matchedPOI.lng, clickedElevation, matchedPOI.name);
          } else {
            console.log("[HydroViz] Click ignored: Only active POIs (flags) are clickable.");
            return; // Ignore clicks on normal buildings
          }
        }
      }

      if (!isBuildingClick) {
        // Show loading state while fetching USGS elevation
        controls.setElevationLoading(true);
        waterRenderer.clearWaterOnly();
        // Origin is moving — drop any flag request still waiting on the
        // cancelled animation, or it would place flags at the old origin.
        pendingRiskFlagRequest = null;
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
  const flowState = waterRenderer.getFlowStateAt(lat, lng);
  const waterDepth = (flowState && !flowState.stale) ? flowState.depth : staticDepth;

  if (waterDepth <= 0) {
    // This building is dry at the new level — the panel no longer applies.
    damagePanel.hide();
    selectedBuilding = null;
    if (selectedBuildingMarker) {
      viewer.entities.remove(selectedBuildingMarker);
      selectedBuildingMarker = null;
    }
    return;
  }

  damagePanel.setDamageInfo(
    lat, lng, waterDepth * 3.28084, flowState, findNearestBuilding(lat, lng)
  );
}

async function handleBuildingClick(lat, lng, clickedElevation, presetBuildingName = null) {
  const groundElev = waterRenderer.getGroundElevationAt(lat, lng);
  if (groundElev === null) return;

  const waterSurface = waterRenderer.getWaterSurfaceNavd88();
  if (waterSurface === null) return;

  const staticDepth = waterSurface - groundElev;
  if (staticDepth <= 0) return;

  const flowState = waterRenderer.getFlowStateAt(lat, lng);
  // Prefer the solver's own per-cell depth (accounts for local terrain
  // variation within the flooded region) over the flat water-surface
  // estimate, when a simulation has actually run here.
  const waterDepth = (flowState && !flowState.stale) ? flowState.depth : staticDepth;
  if (waterDepth <= 0) return;

  if (selectedBuildingMarker) {
    viewer.entities.remove(selectedBuildingMarker);
    selectedBuildingMarker = null;
  }

  // Draw a simple red point marker
  selectedBuildingMarker = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lng, lat, clickedElevation),
    point: {
      pixelSize: 12,
      color: Cesium.Color.RED,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    }
  });

  selectedBuilding = { lat, lng };
  damagePanel.show();
  damagePanel.setLoadingAddress();
  const nsiMatch = findNearestBuilding(lat, lng);
  damagePanel.setDamageInfo(lat, lng, waterDepth * 3.28084, flowState, nsiMatch);

  let buildingName = presetBuildingName;

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
    const data = await res.json();

    if (data && data.display_name) {
      if (!buildingName && data.name) {
        buildingName = data.name;
      }

      const address = data.display_name.split(',').slice(0, 3).join(', ');
      damagePanel.setAddress(buildingName ? `${buildingName} (${address})` : address);
    } else {
      damagePanel.setAddress("Unknown Location");
    }
  } catch (e) {
    damagePanel.setAddress(buildingName || "Location Unavailable");
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
        // Re-evaluate on every level change: which buildings are riskiest,
        // and their hazard colours, both depend on the water level. Without
        // this, flags keep the old level's ranking — and since only flagged
        // buildings are clickable, newly at-risk ones become uninspectable.
        const origin = waterRenderer.getOrigin();
        scheduleRiskFlags(origin.lat, origin.lng, controls.currentRadius * 111);
      } else {
        pendingRiskFlagRequest = null;
        activeFlagEntities.forEach(f => viewer.entities.remove(f));
        activeFlagEntities = [];
        activePOIData = [];
        selectedBuilding = null;
        if (damagePanel) damagePanel.hide();
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
    },

    onClear: () => {
      waterRenderer.clear();
      debrisManager.clear();
      pendingRiskFlagRequest = null;
      activeFlagEntities.forEach(f => viewer.entities.remove(f));
      activeFlagEntities = [];
      activePOIData = [];
      selectedBuilding = null;
      debrisManager.updateWaterLevel(Number.NEGATIVE_INFINITY);
      infoPanel.setWaterLevel(0);
      infoPanel.setFloodArea(0);
      infoPanel.setWaterSurface(null);
      infoPanel.setOrigin(null);
      infoPanel.setGroundElevation(null);
      if (damagePanel) damagePanel.hide();
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
    }
  });
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

// ─── Dynamic Flags (top-5 riskiest NSI buildings by estimated loss) ──
const RISK_FLAG_COUNT = 5;
const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

async function spawnRiskFlags(originLat, originLng, radiusKm) {
  // Clear old flags
  activeFlagEntities.forEach(f => viewer.entities.remove(f));
  activeFlagEntities = [];
  activePOIData = [];

  await loadNSIData(); // resolves immediately if already loaded
  const allBuildings = getAllBuildings();
  if (allBuildings.length === 0) {
    console.log('[HydroViz] No NSI building data available for risk flags.');
    return;
  }

  const waterSurfaceNavd88 = waterRenderer.getWaterSurfaceNavd88();
  if (waterSurfaceNavd88 === null) return;

  const radiusM = radiusKm * 1000;
  const cosLat = Math.cos(originLat * Math.PI / 180);

  // Rank every nearby building with COMPLETE metadata by estimated total
  // loss (structural + content) at the current water level — combines
  // real building value with real flood depth there.
  const candidates = [];
  for (const b of allBuildings) {
    if (b.occtype == null || b.found_ht == null || b.val_struct == null || b.val_cont == null || b.sqft == null) continue;

    const dLatM = (b.lat - originLat) * 111320;
    const dLngM = (b.lng - originLng) * 111320 * cosLat;
    if (Math.sqrt(dLatM * dLatM + dLngM * dLngM) > radiusM) continue;

    const groundElev = waterRenderer.getGroundElevationAt(b.lat, b.lng);
    if (groundElev === null) continue;

    // Mirror handleBuildingClick/DamagePanel exactly, so a flag's colour can
    // never disagree with the panel that opens when you click it.
    const flowState = waterRenderer.getFlowStateAt(b.lat, b.lng);
    const staticDepthFt = (waterSurfaceNavd88 - groundElev) * 3.28084;
    const depthFt = (flowState && !flowState.stale)
      ? flowState.depth * 3.28084
      : staticDepthFt;
    if (depthFt <= 0) continue; // dry — not at risk

    const occupancy = mapOccupancyClass(b.occtype);
    const estimate = getDamageEstimate(occupancy, depthFt, {
      foundationHeightFt: b.found_ht,
      replacementValueUSD: b.val_struct,
      contentValueUSD: b.val_cont,
    });

    const hazard = hazardFromFlow(depthFt * 0.3048, flowState);

    candidates.push({
      building: b,
      occupancy,
      depthFt,
      hazard,
      totalLossUSD: estimate.structuralUSD + estimate.contentUSD,
    });
  }

  if (candidates.length === 0) {
    console.log('[HydroViz] No at-risk buildings with complete NSI data found in this radius.');
    return;
  }

  candidates.sort((a, b) => b.totalLossUSD - a.totalLossUSD);
  const topRisk = candidates.slice(0, RISK_FLAG_COUNT);

  const cartographics = topRisk.map(c => Cesium.Cartographic.fromDegrees(c.building.lng, c.building.lat));
  const sampled = await viewer.scene.sampleHeightMostDetailed(cartographics);

  for (let i = 0; i < sampled.length; i++) {
    const carto = sampled[i];
    const c = topRisk[i];
    if (!carto || carto.height === undefined || isNaN(carto.height)) continue;

    const lossLabel = currencyFmt.format(c.totalLossUSD);
    const flag = viewer.entities.add({
      position: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height),
      name: `${c.hazard.code} ${c.hazard.label} — ${c.occupancy} — Est. Loss ${lossLabel}`,
      description: `Hazard: ${c.hazard.code} ${c.hazard.label} — Occupancy: ${c.occupancy} — Depth: ${c.depthFt.toFixed(1)} ft — Est. Loss: ${lossLabel}`,
      model: {
        uri: './assets/models/red_flag.glb',
        scale: 2.0,
        minimumPixelSize: 96,
        maximumScale: 100.0,
        color: Cesium.Color.fromCssColorString(c.hazard.color),
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: 0.8,
      }
    });
    activeFlagEntities.push(flag);
    activePOIData.push({
      // No real building name from NSI (unlike the old Google Places
      // facility names) — leave null so the address line falls back to
      // the reverse-geocoded street address instead of the risk label.
      name: null,
      lat: c.building.lat,
      lng: c.building.lng,
      entity: flag
    });
  }

  console.log(`[HydroViz] Spawned ${activeFlagEntities.length} risk flags (top ${topRisk.length} of ${candidates.length} candidates by estimated loss).`);

  // Keep an open damage panel in sync with the level these flags reflect.
  refreshDamagePanelForSelection();
}

/**
 * Request risk flags for a region, deferring until the water has settled.
 *
 * Hazard class depends on depth×velocity, and velocity only exists once the
 * SWE animation has finished. Spawning mid-animation would force a depth-only
 * approximation that can disagree with the damage panel — so if a flow
 * animation is running, wait for WaterRenderer's onFlowSettled instead.
 */
function scheduleRiskFlags(lat, lng, radiusKm) {
  if (waterRenderer.isAnimating()) {
    pendingRiskFlagRequest = { lat, lng, radiusKm };
  } else {
    // Water is already static (e.g. level changed after the initial
    // animation) — safe to place immediately.
    spawnRiskFlags(lat, lng, radiusKm);
  }
}

// ─── Start ───────────────────────────────────────────────────
boot();
