import * as Cesium from 'cesium';
import { floodFill, getFloodedCellRects, floodFillAnimated } from './FloodFill.js';

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

    // DEM grid cache for flood fill
    this.demData = null;
    this.demRadius = null;
    this._fetchingDEM = false;
    this._hasAnimatedForCurrentOrigin = false;
  }

  /**
   * Set water origin from a click event.
   * Fetches USGS bare-earth elevation and calibrates geoid offset if needed.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {number} clickedElevation - Ellipsoid height from pickPosition
   * @param {number} [radius=0.008] - Current coverage radius in degrees
   */
  async setOrigin(lat, lng, clickedElevation, radius = 0.008) {
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

    // Step 2: Fetch bare-earth elevation (Google or USGS)
    const usgsNavd88 = await this.elevationService.getElevation(lat, lng);

    if (usgsNavd88 !== null) {
      // Calibrate geoid offset if this is the first click
      if (!this.elevationService.isCalibrated) {
        // geoid_offset = cesium_ellipsoid_ground - usgs_navd88
        this.elevationService.geoidOffset = cesiumGroundEstimate - usgsNavd88;
        console.log(
          `[WaterRenderer] Geoid offset calibrated: ${this.elevationService.geoidOffset.toFixed(2)}m ` +
          `(Cesium ground: ${cesiumGroundEstimate.toFixed(2)}m, API: ${usgsNavd88.toFixed(2)}m)`
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
      console.warn('[WaterRenderer] Elevation API unavailable, using Cesium ground estimate');
    }

    this._updateMarker(lat, lng, this.groundEllipsoid);

    // Fetch DEM grid for flood fill
    console.log('[WaterRenderer] Fetching DEM grid for flood fill...');
    this.demData = await this.elevationService.getElevationGrid(lat, lng, radius, 40);
    this.demRadius = radius;
    if (this.demData) {
      // Align the DEM grid with our exact pinpoint ground elevation
      // This prevents flood fill from failing if the DEM provider (Google) 
      // differs from the pinpoint provider (USGS)
      const seedRow = Math.floor(this.demData.meta.rows / 2);
      const seedCol = Math.floor(this.demData.meta.cols / 2);
      const demCenterElevation = this.demData.grid[seedRow][seedCol];
      const gridOffset = this.groundNavd88 - demCenterElevation;

      for (let r = 0; r < this.demData.meta.rows; r++) {
        for (let c = 0; c < this.demData.meta.cols; c++) {
          this.demData.grid[r][c] += gridOffset;
        }
      }

      console.log(`[WaterRenderer] DEM grid ready for flood fill (aligned by ${gridOffset.toFixed(2)}m)`);
    } else {
      console.warn('[WaterRenderer] DEM grid unavailable, will use circular fallback');
    }

    this._hasAnimatedForCurrentOrigin = false;
  }

  /**
   * Update the water surface.
   * @param {number} waterLevelAboveGround - Meters above ground
   * @param {number} [radius=0.008]
   */
  updateWater(waterLevelAboveGround, radius = 0.008) {
    this.currentLevel = waterLevelAboveGround;
    this.currentRadius = radius;

    // If a flow animation is running, don't interrupt it —
    // just track the level so we can render the final state when it's done
    if (this.animationId) return;

    this._removeWater();

    if (!this.originLat || !this.originLng || this.groundEllipsoid === null) return;
    if (waterLevelAboveGround <= 0) return;

    // First render for this origin → play the flow animation
    if (!this._hasAnimatedForCurrentOrigin && this.demData) {
      this._hasAnimatedForCurrentOrigin = true;
      this.animateFloodFill(waterLevelAboveGround, radius);
      return;
    }

    const waterSurfaceEllipsoid = this.groundEllipsoid + waterLevelAboveGround;

    // If radius changed, invalidate DEM cache (will re-fetch on next click)
    if (this.demData && Math.abs(radius - this.demRadius) > 0.0001) {
      this.demData = null;
      this.demRadius = null;
    }

    // Try DEM-aware flood fill with cached grid
    if (this.demData) {
      const waterLevelMSL = this.groundNavd88 + waterLevelAboveGround;
      const seedRow = Math.floor(this.demData.meta.rows / 2);
      const seedCol = Math.floor(this.demData.meta.cols / 2);

      const floodedCells = floodFill(this.demData.grid, seedRow, seedCol, waterLevelMSL);

      if (floodedCells.size > 0) {
        const rects = getFloodedCellRects(floodedCells, this.demData.meta);
        this._renderFloodFillPrimitive(rects, waterSurfaceEllipsoid);
        return;
      }
    }

    // Fallback: circular water plane
    this._renderWaterPrimitive(waterSurfaceEllipsoid);
  }

  /**
   * Animate water spreading outward from the origin, ring by ring.
   * Uses the BFS generator to progressively reveal flooded cells.
   *
   * @param {number} waterLevelAboveGround - Meters above ground
   * @param {number} radius - Coverage radius in degrees
   * @param {Function} [onUpdate] - Callback with cell count after each ring
   */
  animateFloodFill(waterLevelAboveGround, radius, onUpdate = null) {
    // Cancel any existing animation
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    this.currentLevel = waterLevelAboveGround;
    this.currentRadius = radius;
    this._removeWater();

    if (!this.originLat || !this.originLng || this.groundEllipsoid === null) return;
    if (waterLevelAboveGround <= 0) return;

    const waterSurfaceEllipsoid = this.groundEllipsoid + waterLevelAboveGround;

    // No DEM? Fall back to circular water
    if (!this.demData) {
      this._renderWaterPrimitive(waterSurfaceEllipsoid);
      return;
    }

    const waterLevelMSL = this.groundNavd88 + waterLevelAboveGround;
    const seedRow = Math.floor(this.demData.meta.rows / 2);
    const seedCol = Math.floor(this.demData.meta.cols / 2);

    const generator = floodFillAnimated(
      this.demData.grid, seedRow, seedCol, waterLevelMSL
    );
    const meta = this.demData.meta;
    const stepInterval = 100; // ms between each BFS ring
    let lastStepTime = 0;

    console.log('[WaterRenderer] Starting flood flow animation...');

    const animate = (timestamp) => {
      if (timestamp - lastStepTime >= stepInterval) {
        const result = generator.next();

        if (!result.done && result.value && result.value.size > 0) {
          this._removeWater();
          const rects = getFloodedCellRects(result.value, meta);
          this._renderFloodFillPrimitive(rects, waterSurfaceEllipsoid);
          if (onUpdate) onUpdate(result.value.size);
          lastStepTime = timestamp;
        }

        if (result.done) {
          console.log('[WaterRenderer] Flow animation complete');
          this.animationId = null;
          // After animation, render at current slider level (user may have moved it)
          this.updateWater(this.currentLevel, this.currentRadius);
          return;
        }
      }
      this.animationId = requestAnimationFrame(animate);
    };

    this.animationId = requestAnimationFrame(animate);
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
      baseWaterColor: new Cesium.Color(0.02, 0.15, 0.6, 0.85),
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

  /**
   * Render flood fill result as per-cell water quads.
   * Each flooded cell becomes a small rectangle at the water surface height.
   * All cells share a single Primitive for efficient rendering.
   *
   * @param {Array} floodedRects - Array of { lat, lng, latSize, lngSize }
   * @param {number} waterSurfaceEllipsoid - Absolute ellipsoid height
   */
  _renderFloodFillPrimitive(floodedRects, waterSurfaceEllipsoid) {
    const instances = floodedRects.map((rect, i) => {
      const halfLat = rect.latSize / 2;
      const halfLng = rect.lngSize / 2;

      const positions = Cesium.Cartesian3.fromDegreesArray([
        rect.lng - halfLng, rect.lat - halfLat,
        rect.lng + halfLng, rect.lat - halfLat,
        rect.lng + halfLng, rect.lat + halfLat,
        rect.lng - halfLng, rect.lat + halfLat,
      ]);

      return new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(positions),
          height: waterSurfaceEllipsoid,
          vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
        }),
        id: `hydroviz-flood-cell-${i}`,
      });
    });

    if (instances.length === 0) return;

    const waterMaterial = Cesium.Material.fromType('Water', {
      baseWaterColor: new Cesium.Color(0.02, 0.15, 0.6, 0.85),
      normalMap: Cesium.buildModuleUrl('Assets/Textures/waterNormals.jpg'),
      frequency: 8000.0,
      animationSpeed: 0.008,
      amplitude: 6.0,
      specularIntensity: 0.4,
    });

    this.waterPrimitive = this.viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: instances,
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
    this.demData = null;
    this.demRadius = null;
    this._hasAnimatedForCurrentOrigin = false;
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

    // If flood fill is active, estimate from flooded cell count
    if (this.demData && this.groundNavd88 !== null) {
      const waterLevelMSL = this.groundNavd88 + this.currentLevel;
      const seedRow = Math.floor(this.demData.meta.rows / 2);
      const seedCol = Math.floor(this.demData.meta.cols / 2);
      const floodedCells = floodFill(this.demData.grid, seedRow, seedCol, waterLevelMSL);
      const cellAreaKm2 = (this.demData.meta.cellSizeLat * 111) * (this.demData.meta.cellSizeLng * 111 * Math.cos(this.originLat * Math.PI / 180));
      return floodedCells.size * cellAreaKm2;
    }

    // Fallback: circular estimate
    const radiusKm = this.currentRadius * 111;
    return Math.PI * radiusKm * (radiusKm * 0.75);
  }
}
