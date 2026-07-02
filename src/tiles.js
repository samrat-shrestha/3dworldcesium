import * as Cesium from 'cesium';

/**
 * Load Google Photorealistic 3D Tiles via Cesium Ion.
 * Uses Ion asset ID 2275207 which provides Google's photorealistic 3D tiles.
 *
 * @param {Cesium.Viewer} viewer - The Cesium viewer instance
 * @returns {Promise<Cesium.Cesium3DTileset>} The loaded tileset
 */
export async function loadGoogleTiles(viewer) {
  try {
    const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(2275207, {
      maximumScreenSpaceError: 4,
      maximumMemoryUsage: 1024,
      // // Lower = higher detail. Default 16. Use 2 for street-level sharpness.
      // maximumScreenSpaceError: 2,

      // // Don't skip intermediate LODs — prevents the "blocky" appearance
      // // during progressive loading. Loads smoother but uses more bandwidth.
      // skipLevelOfDetail: false,

      // // Memory budget (MB) — higher allows more tiles to stay loaded
      // maximumMemoryUsage: 2048,
      // cacheBytes: 2048 * 1024 * 1024,

      // // Foveated rendering: prioritize detail in the center of the view
      // foveatedScreenSpaceError: true,
      // foveatedConeSize: 0.1,
      // foveatedMinimumScreenSpaceErrorRelaxation: 0.0,

      // // Preload tiles for smoother navigation
      // preloadWhenHidden: true,
      // preferLeaves: true,
    });

    viewer.scene.primitives.add(tileset);

    console.log('[HydroViz] Google Photorealistic 3D Tiles loaded successfully');
    return tileset;
  } catch (error) {
    console.error('[HydroViz] Failed to load Google 3D Tiles:', error);

    // Provide helpful error messages
    if (error.message && error.message.includes('401')) {
      throw new Error(
        'Authentication failed. Please check your Cesium Ion access token. ' +
        'Make sure the Google Photorealistic 3D Tiles asset (ID 2275207) is available in your Ion account.'
      );
    }

    if (error.message && error.message.includes('403')) {
      throw new Error(
        'Access denied. You may need to add the Google Photorealistic 3D Tiles asset to your Cesium Ion account. ' +
        'Visit: https://ion.cesium.com/assetDepot/2275207'
      );
    }

    throw new Error(`Failed to load 3D Tiles: ${error.message}`);
  }
}
