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
    fpControls = new FirstPersonControls(viewer);
    debrisManager = new FloatingDebrisManager(viewer);

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

async function handleBuildingClick(lat, lng, clickedElevation, presetBuildingName = null) {
  const groundElev = waterRenderer.getGroundElevationAt(lat, lng);
  if (groundElev === null) return;

  const waterSurface = waterRenderer.getWaterSurfaceNavd88();
  if (waterSurface === null) return;

  const waterDepth = waterSurface - groundElev;
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

  damagePanel.show();
  damagePanel.setLoadingAddress();
  damagePanel.setDamageInfo(lat, lng, waterDepth * 3.28084);

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

      if (level > 0 && activeFlagEntities.length === 0) {
        const origin = waterRenderer.getOrigin();
        spawnFlags(origin.lat, origin.lng, controls.currentRadius * 111);
      } else if (level <= 0 && activeFlagEntities.length > 0) {
        activeFlagEntities.forEach(f => viewer.entities.remove(f));
        activeFlagEntities = [];
        activePOIData = [];
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
      activeFlagEntities.forEach(f => viewer.entities.remove(f));
      activeFlagEntities = [];
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

// ─── Dynamic Flags (Google Places API) ───────────────────────
const GOOGLE_PLACES_API_KEY = 'AIzaSyA6A821SVHUtMukcDMnZK7OXSw8MxwTGck';

async function spawnFlags(originLat, originLng, radiusKm) {
  // Clear old flags
  activeFlagEntities.forEach(f => viewer.entities.remove(f));
  activeFlagEntities = [];
  activePOIData = [];

  const radiusMeters = radiusKm * 1000;
  const types = ['hospital', 'fire_station', 'school'];
  const baseUrl = import.meta.env.DEV
    ? '/api/google-places/maps/api/place/nearbysearch/json'
    : 'https://hydroinformatics.tulane.edu/lab/cors/https://maps.googleapis.com/maps/api/place/nearbysearch/json';

  try {
    const fetchPromises = types.map(type =>
      fetch(`${baseUrl}?location=${originLat},${originLng}&radius=${radiusMeters}&type=${type}&key=${GOOGLE_PLACES_API_KEY}`)
        .then(res => res.json())
    );

    const responses = await Promise.all(fetchPromises);

    let allResults = [];
    responses.forEach(data => {
      if (data.status === 'OK' && data.results) {
        allResults.push(...data.results);
      }
    });

    if (allResults.length === 0) {
      console.log('[HydroViz] No critical infrastructure found in this radius.');
      return;
    }

    // Limit to 10 to not spam the map
    allResults = allResults.slice(0, 10);

    const cartographics = [];
    for (let i = 0; i < allResults.length; i++) {
      const loc = allResults[i].geometry.location;
      cartographics.push(Cesium.Cartographic.fromDegrees(loc.lng, loc.lat));
    }

    // Sample the precise ground/building height from the loaded 3D Tiles
    const sampled = await viewer.scene.sampleHeightMostDetailed(cartographics);

    for (let i = 0; i < sampled.length; i++) {
      const carto = sampled[i];
      const result = allResults[i];

      const name = result.name || 'FACILITY';
      const typeLabel = result.types ? result.types[0].replace('_', ' ').toUpperCase() : 'INFRASTRUCTURE';

      if (carto && carto.height !== undefined && !isNaN(carto.height)) {
        const flag = viewer.entities.add({
          position: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height),
          name: name,
          description: `Facility Type: ${typeLabel}`,
          model: {
            uri: './assets/models/red_flag.glb',
            scale: 2.0,
            minimumPixelSize: 96,
            maximumScale: 100.0,
            color: Cesium.Color.RED,
            colorBlendMode: Cesium.ColorBlendMode.MIX,
            colorBlendAmount: 0.8,
          }
        });
        activeFlagEntities.push(flag);
        activePOIData.push({
          name: name,
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          entity: flag
        });
      }
    }

    console.log(`[HydroViz] Spawned ${activeFlagEntities.length} real infrastructure flags.`);
  } catch (e) {
    console.warn('[HydroViz] Failed to fetch or place flags:', e);
  }
}

// ─── Start ───────────────────────────────────────────────────
boot();
