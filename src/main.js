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
import { getSavedToken, showTokenModal } from './ui/TokenModal.js';
import { FirstPersonControls } from './navigation/FirstPersonControls.js';
import { FloatingDebrisManager } from './water/FloatingDebrisManager.js';

// ─── State ───────────────────────────────────────────────────
let viewer = null;
let elevationService = null;
let waterRenderer = null;
let controls = null;
let infoPanel = null;
let fpControls = null;
let clickHandler = null;
let debrisManager = null;
let currentLocation = LOCATIONS[0]; // French Quarter
let currentViewPreset = 'aerial';
let activeFlagEntities = []; // store dynamically spawned flags

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

      // Show loading state while fetching USGS elevation
      controls.setElevationLoading(true);
      waterRenderer.clearWaterOnly();

      // Async: fetches USGS bare-earth elevation + calibrates geoid
      await waterRenderer.setOrigin(lat, lng, clickedElevation);

      // Spawn floating cars within the water radius, passing ground elevation to avoid buildings
      debrisManager.spawnDebris(lat, lng, controls.currentRadius * 111, 15, waterRenderer.getGroundElevation());

      // Spawn flags dynamically on the ground around the clicked area
      spawnFlags(lat, lng, controls.currentRadius * 111);

      // Hide loading
      controls.setElevationLoading(false);

      // Show NAVD88 (MSL) elevation — much more meaningful to users
      const groundNavd88 = waterRenderer.getGroundNavd88();
      const origin = { lat, lng, elevation: groundNavd88 };

      controls.setOrigin(origin);
      controls.setGroundElevation(groundNavd88);
      infoPanel.setOrigin(origin);
      infoPanel.setGroundElevation(groundNavd88);

      // If water level is already set, render water at new origin
      if (controls.currentLevel > 0) {
        waterRenderer.updateWater(controls.currentLevel, controls.currentRadius);
        const surfaceNavd88 = waterRenderer.getWaterSurfaceNavd88();
        controls.setWaterSurface(surfaceNavd88);
        infoPanel.setWaterSurface(surfaceNavd88);
        debrisManager.updateWaterLevel(waterRenderer.getWaterSurfaceElevation());
      } else {
        debrisManager.updateWaterLevel(Number.NEGATIVE_INFINITY);
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

// ─── UI Setup ────────────────────────────────────────────────
function initUI() {
  controls = new Controls({
    onWaterLevelChange: (level) => {
      if (!waterRenderer.hasOrigin()) return;
      waterRenderer.updateWater(level, controls.currentRadius);
      infoPanel.setWaterLevel(level);
      infoPanel.setFloodArea(waterRenderer.getEstimatedArea());
      const surfaceNavd88 = waterRenderer.getWaterSurfaceNavd88();
      controls.setWaterSurface(surfaceNavd88);
      infoPanel.setWaterSurface(surfaceNavd88);
      debrisManager.updateWaterLevel(waterRenderer.getWaterSurfaceElevation());
    },

    onRadiusChange: (radius) => {
      if (!waterRenderer.hasOrigin() || controls.currentLevel <= 0) return;
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
    },
  });

  infoPanel = new InfoPanel(viewer);
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

// ─── Dynamic Flags (OpenStreetMap) ───────────────────────────
async function spawnFlags(originLat, originLng, radiusKm) {
  // Clear old flags
  activeFlagEntities.forEach(f => viewer.entities.remove(f));
  activeFlagEntities = [];

  const radiusMeters = radiusKm * 1000;

  // Overpass API Query for hospitals, fire stations, and schools in the radius
  const query = `
    [out:json];
    (
      node["amenity"="hospital"](around:${radiusMeters},${originLat},${originLng});
      node["amenity"="fire_station"](around:${radiusMeters},${originLat},${originLng});
      node["amenity"="school"](around:${radiusMeters},${originLat},${originLng});
    );
    out body 10; // Limit to 10 results so we don't spam the map
  `;

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    const data = await response.json();

    if (!data.elements || data.elements.length === 0) {
      console.log('[HydroViz] No critical infrastructure found in this radius.');
      return;
    }

    const cartographics = [];
    const elements = data.elements;

    for (let i = 0; i < elements.length; i++) {
      cartographics.push(Cesium.Cartographic.fromDegrees(elements[i].lon, elements[i].lat));
    }

    // Sample the precise ground/building height from the loaded 3D Tiles
    const sampled = await viewer.scene.sampleHeightMostDetailed(cartographics);

    for (let i = 0; i < sampled.length; i++) {
      const carto = sampled[i];
      const el = elements[i];

      // Try to use the actual name, fallback to the amenity type
      const name = el.tags.name || (el.tags.amenity.replace('_', ' ').toUpperCase());

      if (carto && carto.height !== undefined && !isNaN(carto.height)) {
        const flag = viewer.entities.add({
          position: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height),
          name: name,
          description: `Facility Type: ${el.tags.amenity}`,
          model: {
            uri: './assets/models/flag.glb',
            scale: 2.0,
            minimumPixelSize: 96,
            maximumScale: 100.0,
            color: Cesium.Color.fromCssColorString('#ff4444'),
            colorBlendMode: Cesium.ColorBlendMode.MIX,
            colorBlendAmount: 0.5,
          },
          label: {
            text: name,
            font: 'bold 16px Inter, sans-serif',
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: new Cesium.Color(0.7, 0.1, 0.1, 0.9),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -70),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 100000),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        activeFlagEntities.push(flag);
      }
    }

    console.log(`[HydroViz] Spawned ${activeFlagEntities.length} real infrastructure flags.`);
  } catch (e) {
    console.warn('[HydroViz] Failed to fetch or place flags:', e);
  }
}

// ─── Start ───────────────────────────────────────────────────
boot();
