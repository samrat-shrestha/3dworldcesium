import * as Cesium from 'cesium';

/**
 * Initialize the CesiumJS Viewer optimized for 3D tile exploration.
 * @param {string} containerId
 * @returns {Cesium.Viewer}
 */
export function initViewer(containerId) {
  const viewer = new Cesium.Viewer(containerId, {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    vrButton: false,
    homeButton: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    infoBox: false,
    geocoder: false,

    msaaSamples: 4,
    useBrowserRecommendedResolution: true,
    orderIndependentTranslucency: true,
    shadows: false,
    terrainShadows: Cesium.ShadowMode.DISABLED,
  });

  // Hide default globe — Google 3D Tiles have their own terrain
  viewer.scene.globe.show = false;
  viewer.scene.skyAtmosphere.show = true;

  // Post-processing
  viewer.scene.postProcessStages.fxaa.enabled = true;

  // Depth testing for accurate pickPosition on 3D tiles
  viewer.scene.globe.depthTestAgainstTerrain = true;

  // Lighting
  viewer.scene.light = new Cesium.DirectionalLight({
    direction: Cesium.Cartesian3.normalize(
      new Cesium.Cartesian3(0.2, -0.5, -0.8),
      new Cesium.Cartesian3()
    ),
    intensity: 1.5,
  });

  // Camera controller for immersive 3D navigation
  const controller = viewer.scene.screenSpaceCameraController;
  controller.minimumZoomDistance = 3;
  controller.maximumZoomDistance = 20000;
  controller.enableTilt = true;
  controller.enableLook = true;
  controller.inertiaSpin = 0.9;
  controller.inertiaTranslate = 0.9;
  controller.inertiaZoom = 0.8;

  return viewer;
}

/**
 * Fly to a location with a camera preset.
 * @param {Cesium.Viewer} viewer
 * @param {number} lng
 * @param {number} lat
 * @param {'aerial'|'street'|'orbit'} preset
 * @param {number} [duration=2.0]
 */
export function flyToPreset(viewer, lng, lat, preset = 'aerial', duration = 2.0) {
  const presets = {
    aerial: { altitude: 250, heading: 20, pitch: -25 },
    street: { altitude: 12, heading: 45, pitch: -3 },
    orbit:  { altitude: 600, heading: 0, pitch: -50 },
  };

  const p = presets[preset] || presets.aerial;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, p.altitude),
    orientation: {
      heading: Cesium.Math.toRadians(p.heading),
      pitch: Cesium.Math.toRadians(p.pitch),
      roll: 0,
    },
    duration,
  });
}
