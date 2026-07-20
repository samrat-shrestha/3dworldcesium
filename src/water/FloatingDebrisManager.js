import * as Cesium from 'cesium';

/**
 * Manages floating 3D objects (cars) that react to the water level.
 */
export class FloatingDebrisManager {
  /**
   * @param {Cesium.Viewer} viewer
   */
  constructor(viewer) {
    this.viewer = viewer;
    this.entities = [];
    this.waterSurfaceEllipsoid = Number.NEGATIVE_INFINITY;

    // Bind the preUpdate listener so we can remove it later
    this._onPreUpdate = this._onPreUpdate.bind(this);
    this.viewer.scene.preUpdate.addEventListener(this._onPreUpdate);
  }

  /**
   * Spawn N cars randomly around the given origin.
   * @param {number} originLat 
   * @param {number} originLng 
   * @param {number} radiusKm 
   * @param {number} count 
   * @param {number} originGroundElevation
   */
  async spawnDebris(originLat, originLng, radiusKm, count = 10, originGroundElevation = null) {
    this.clear();

    const cartographics = [];
    const models = ['car1.glb', 'car3.glb']; // Temporarily removed car2.glb as it is missing from the folder

    // Spawn them very close to the clicked origin (max 80 meters away)
    const spawnRadiusKm = Math.min(radiusKm, 0.08);

    // Generate EXTRA random positions because we will filter out buildings
    const candidatesCount = count * 5; 
    for (let i = 0; i < candidatesCount; i++) {
      // Random distance and angle
      const r = Math.random() * spawnRadiusKm;
      const theta = Math.random() * 2 * Math.PI;

      // Approximate degree conversion (roughly 111km per degree lat)
      const dLat = (r * Math.sin(theta)) / 111.0;
      const dLng = (r * Math.cos(theta)) / (111.0 * Math.cos(originLat * Math.PI / 180));

      const lat = originLat + dLat;
      const lng = originLng + dLng;

      // Add to array for batch ground sampling
      cartographics.push(Cesium.Cartographic.fromDegrees(lng, lat));
    }

    // Sample actual ground heights
    try {
      const sampled = await this.viewer.scene.sampleHeightMostDetailed(cartographics);
      let spawnedCount = 0;

      for (let index = 0; index < sampled.length; index++) {
        if (spawnedCount >= count) break; // Stop when we have enough cars

        const carto = sampled[index];
        if (!carto || carto.height === undefined || isNaN(carto.height)) continue;

        // HEURISTIC: If the point is more than 1.5 meters above the local ground origin, 
        // it's likely a building roof, a tree, or a steep hill. Skip it!
        if (originGroundElevation !== null) {
          if (carto.height > originGroundElevation + 1.5) {
            continue; 
          }
        }

        const modelFile = models[Math.floor(Math.random() * models.length)];
        const heading = Math.random() * Math.PI * 2;
        const position = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height);
        const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0);
        const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

        const entity = this.viewer.entities.add({
          position: position,
          orientation: orientation,
          model: {
            uri: `./assets/models/${modelFile}`,
            scale: 0.02,
          }
        });

        // Store custom properties for logic
        entity._debrisData = {
          lon: carto.longitude,
          lat: carto.latitude,
          groundHeight: carto.height,
          heading: heading,
          timeOffset: Math.random() * 100 // For random bobbing phase
        };

        this.entities.push(entity);
        spawnedCount++;
      }

      console.log(`[FloatingDebris] Spawned ${this.entities.length} cars`);
    } catch (e) {
      console.warn('[FloatingDebris] Failed to sample ground heights:', e);
    }
  }

  /**
   * Update the current water surface level.
   * @param {number} waterSurfaceEllipsoid 
   * @param {Float64Array[]} depthGrid - Optional 2D grid from SWE solver
   * @param {object} demMeta - Optional DEM metadata for coordinate mapping
   */
  updateWaterLevel(waterSurfaceEllipsoid, depthGrid = null, demMeta = null) {
    this.waterSurfaceEllipsoid = waterSurfaceEllipsoid;
    this.depthGrid = depthGrid;
    this.demMeta = demMeta;
  }

  /**
   * Runs every frame to update vertical positions of floating cars.
   */
  _onPreUpdate(scene, time) {
    if (this.entities.length === 0) return;

    // A time variable to drive the bobbing animation (seconds)
    const t = performance.now() / 1000.0;

    this.entities.forEach(entity => {
      const data = entity._debrisData;

      // If water is above ground, the car floats. Otherwise it rests on ground.
      let targetHeight = data.groundHeight;
      let pitch = 0;
      let roll = 0;

      let waterDepth = 0;
      let localWaterSurface = this.waterSurfaceEllipsoid;

      if (this.depthGrid && this.demMeta) {
        // Convert radians to degrees for grid mapping
        const latDeg = data.lat * 180 / Math.PI;
        const lonDeg = data.lon * 180 / Math.PI;

        // Map lon/lat to grid coordinates (r, c)
        const dLat = latDeg - this.demMeta.originLat;
        const dLng = lonDeg - this.demMeta.originLng;
        const rOffset = Math.round(dLat / this.demMeta.cellSizeLat);
        const cOffset = Math.round(dLng / this.demMeta.cellSizeLng);
        const r = Math.floor(this.demMeta.rows / 2) + rOffset;
        const c = Math.floor(this.demMeta.cols / 2) + cOffset;

        if (r >= 0 && r < this.demMeta.rows && c >= 0 && c < this.demMeta.cols) {
          waterDepth = this.depthGrid[r][c];
          localWaterSurface = data.groundHeight + waterDepth;
        } else {
          waterDepth = 0; // outside grid means dry
        }
      } else {
        waterDepth = this.waterSurfaceEllipsoid - data.groundHeight;
      }

      // Cars generally need at least 0.5-0.6 meters of water to begin floating.
      if (waterDepth > 0.6) {
        // Car floats!
        // Bobbing: small sine wave offset
        const bob = Math.sin(t * 2 + data.timeOffset) * 0.15;

        // The car should be partially submerged, not walking on water!
        // We'll submerge it by 0.6 meters.
        targetHeight = localWaterSurface - 0.8 + bob;

        // Slight rocking (pitch/roll)
        pitch = Math.sin(t * 1.5 + data.timeOffset) * 0.05;
        roll = Math.cos(t * 1.2 + data.timeOffset) * 0.05;
      }

      const position = Cesium.Cartesian3.fromRadians(data.lon, data.lat, targetHeight);
      const hpr = new Cesium.HeadingPitchRoll(data.heading, pitch, roll);
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

      entity.position = position;
      entity.orientation = orientation;
    });
  }

  clear() {
    this.entities.forEach(entity => {
      this.viewer.entities.remove(entity);
    });
    this.entities = [];
  }

  destroy() {
    this.clear();
    this.viewer.scene.preUpdate.removeEventListener(this._onPreUpdate);
  }
}
