import * as Cesium from 'cesium';

/**
 * WaterRenderer — Animated water surface with USGS bare-earth elevation.
 *
 * Elevation pipeline:
 *   1. User clicks → pickPosition gives Cesium ellipsoid height (could be a rooftop)
 *   2. USGS EPQS returns bare-earth NAVD88 (MSL) elevation (no buildings/trees)
 *   3. Cesium's sampleHeightMostDetailed gives a ground-level ellipsoid height estimate
 *   4. Geoid offset = cesium_ground - usgs_navd88 (calibrated once, ~-25m for NOLA)
 *   5. Water rendered at: (usgs_navd88 + water_depth) + geoid_offset → ellipsoid height
 *
 * This gives accurate bare-earth elevation for flood simulation regardless of
 * whether the user clicked on a rooftop, tree, or ground.
 */
export class WaterRenderer {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {import('../services/ElevationService.js').ElevationService} elevationService
   */
  constructor(viewer, elevationService) {
    this.viewer = viewer;
    this.elevationService = elevationService;

    this.waterPrimitive = null;
    this.markerEntity = null;

    // Origin (set by click)
    this.originLat = null;
    this.originLng = null;

    // Elevation data
    this.groundNavd88 = null;    // NAVD88 (MSL) from USGS — bare-earth
    this.groundEllipsoid = null; // WGS84 ellipsoid — for Cesium rendering

    // Current water params
    this.currentLevel = 0;
    this.currentRadius = 0.008;
    this.animationId = null;
  }

  /**
   * Set water origin from a click event.
   * Fetches USGS bare-earth elevation and calibrates geoid offset if needed.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {number} clickedElevation - Ellipsoid height from pickPosition
   */
  async setOrigin(lat, lng, clickedElevation) {
    this.originLat = lat;
    this.originLng = lng;

    // Step 1: Get Cesium ground-level estimate (minimum of nearby samples)
    let cesiumGroundEstimate = clickedElevation;
    try {
      const offsets = [
        [0, 0],
        [0.0002, 0], [-0.0002, 0],
        [0, 0.0002], [0, -0.0002],
        [0.0004, 0], [-0.0004, 0],
        [0, 0.0004], [0, -0.0004],
      ];

      const cartographics = offsets.map(([dlat, dlng]) =>
        Cesium.Cartographic.fromDegrees(lng + dlng, lat + dlat)
      );

      const results = await this.viewer.scene.sampleHeightMostDetailed(cartographics);

      let minHeight = clickedElevation;
      for (const r of results) {
        if (r.height !== undefined && !isNaN(r.height) && r.height < minHeight) {
          minHeight = r.height;
        }
      }
      cesiumGroundEstimate = minHeight;
    } catch (e) {
      console.warn('[WaterRenderer] Cesium ground sampling failed:', e.message);
    }

    // Step 2: Fetch USGS bare-earth elevation (single API call)
    const usgsNavd88 = await this.elevationService.getElevationNAVD88(lat, lng);

    if (usgsNavd88 !== null) {
      // Calibrate geoid offset if this is the first click
      if (!this.elevationService.isCalibrated) {
        // geoid_offset = cesium_ellipsoid_ground - usgs_navd88
        this.elevationService.geoidOffset = cesiumGroundEstimate - usgsNavd88;
        console.log(
          `[WaterRenderer] Geoid offset calibrated: ${this.elevationService.geoidOffset.toFixed(2)}m ` +
          `(Cesium ground: ${cesiumGroundEstimate.toFixed(2)}m, USGS: ${usgsNavd88.toFixed(2)}m)`
        );
      }

      this.groundNavd88 = usgsNavd88;
      this.groundEllipsoid = this.elevationService.toEllipsoid(usgsNavd88);

      console.log(
        `[WaterRenderer] Ground: ${usgsNavd88.toFixed(2)}m NAVD88 → ` +
        `${this.groundEllipsoid.toFixed(2)}m ellipsoid (for rendering)`
      );
    } else {
      // Fallback: use Cesium ground estimate if USGS is unavailable
      this.groundEllipsoid = cesiumGroundEstimate;
      this.groundNavd88 = this.elevationService.toNAVD88(cesiumGroundEstimate);
      console.warn('[WaterRenderer] USGS unavailable, using Cesium ground estimate');
    }

    this._updateMarker(lat, lng, this.groundEllipsoid);
  }

  /**
   * Update the water surface.
   * @param {number} waterLevelAboveGround - Meters above ground
   * @param {number} [radius=0.008]
   */
  updateWater(waterLevelAboveGround, radius = 0.008) {
    this.currentLevel = waterLevelAboveGround;
    this.currentRadius = radius;
    this._removeWater();

    if (!this.originLat || !this.originLng || this.groundEllipsoid === null) return;
    if (waterLevelAboveGround <= 0) return;

    // Water surface in ellipsoid height = ground_ellipsoid + depth
    const waterSurfaceEllipsoid = this.groundEllipsoid + waterLevelAboveGround;
    this._renderWaterPrimitive(waterSurfaceEllipsoid);
  }

  /**
   * Render water using Cesium Primitive + Water material.
   * @param {number} waterSurfaceEllipsoid - Absolute ellipsoid height
   */
  _renderWaterPrimitive(waterSurfaceEllipsoid) {
    const positions = this._createCircularPolygon(
      this.originLat, this.originLng, this.currentRadius, 64
    );

    const polygonGeometry = new Cesium.PolygonGeometry({
      polygonHierarchy: new Cesium.PolygonHierarchy(positions),
      height: waterSurfaceEllipsoid,
      vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
      granularity: 0.0001, // Forces Cesium to tessellate the polygon so it perfectly hugs the earth's curve
    });

    const geometryInstance = new Cesium.GeometryInstance({
      geometry: polygonGeometry,
      id: 'hydroviz-water-surface',
    });

    const waterMaterial = Cesium.Material.fromType('Water', {
      baseWaterColor: new Cesium.Color(0.15, 0.25, 0.20, 0.85),
      normalMap: Cesium.buildModuleUrl('Assets/Textures/waterNormals.jpg'),
      frequency: 8000.0,
      animationSpeed: 0.008, // Greatly reduced to make the water look calmer and slower
      amplitude: 6.0, // Reduced from 8.0 to make the waves less intense
      specularIntensity: 0.4, // Raised slightly to give it that realistic glint, but not blinding
    });

    this.waterPrimitive = this.viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: geometryInstance,
        appearance: new Cesium.EllipsoidSurfaceAppearance({
          material: waterMaterial,
          aboveGround: false,
          translucent: true,
        }),
        asynchronous: false,
      })
    );
  }

  _updateMarker(lat, lng, ellipsoidHeight) {
    if (this.markerEntity) {
      this.viewer.entities.remove(this.markerEntity);
    }

    const mslLabel = this.groundNavd88 !== null
      ? `${this.groundNavd88.toFixed(1)}m NAVD88`
      : 'Measuring...';

    this.markerEntity = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, ellipsoidHeight + 2),
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString('#4a90d9'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.NONE,
      },
      label: {
        text: `Origin · ${mslLabel}`,
        font: '11px Inter, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: new Cesium.Color(0, 0, 0, 0.8),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  _createCircularPolygon(lat, lng, radius, segments) {
    const positions = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      positions.push(Cesium.Cartesian3.fromDegrees(
        lng + radius * Math.cos(angle),
        lat + radius * 0.75 * Math.sin(angle)
      ));
    }
    return positions;
  }

  _removeWater() {
    if (this.waterPrimitive) {
      this.viewer.scene.primitives.remove(this.waterPrimitive);
      this.waterPrimitive = null;
    }
  }

  animateRise(targetLevel, duration = 3000, onUpdate = null) {
    return new Promise((resolve) => {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }

      if (this.groundEllipsoid === null || !this.originLat) {
        resolve();
        return;
      }

      const startTime = performance.now();
      let lastUpdateLevel = -1;
      const threshold = 0.5;

      const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        const currentLevel = targetLevel * easedProgress;

        if (Math.abs(currentLevel - lastUpdateLevel) >= threshold || progress >= 1) {
          this._removeWater();
          const waterSurface = this.groundEllipsoid + currentLevel;
          this._renderWaterPrimitive(waterSurface);
          lastUpdateLevel = currentLevel;
          this.currentLevel = currentLevel;
        }

        if (onUpdate) onUpdate(currentLevel);

        if (progress < 1) {
          this.animationId = requestAnimationFrame(animate);
        } else {
          this.animationId = null;
          this.currentLevel = targetLevel;
          resolve();
        }
      };

      this.animationId = requestAnimationFrame(animate);
    });
  }

  clear() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this._removeWater();
    if (this.markerEntity) {
      this.viewer.entities.remove(this.markerEntity);
      this.markerEntity = null;
    }
    this.originLat = null;
    this.originLng = null;
    this.groundNavd88 = null;
    this.groundEllipsoid = null;
    this.currentLevel = 0;
  }

  clearWaterOnly() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this._removeWater();
    this.currentLevel = 0;
  }

  hasOrigin() {
    return this.originLat !== null && this.originLng !== null;
  }

  getGroundElevation() { return this.groundEllipsoid; }
  getGroundNavd88() { return this.groundNavd88; }

  getWaterSurfaceElevation() {
    if (this.groundEllipsoid === null || this.currentLevel <= 0) return Number.NEGATIVE_INFINITY;
    return this.groundEllipsoid + this.currentLevel;
  }

  getWaterSurfaceNavd88() {
    if (this.groundNavd88 === null || this.currentLevel <= 0) return null;
    return this.groundNavd88 + this.currentLevel;
  }

  getEstimatedArea() {
    if (this.currentLevel <= 0) return 0;
    const radiusKm = this.currentRadius * 111;
    return Math.PI * radiusKm * (radiusKm * 0.75);
  }
}
