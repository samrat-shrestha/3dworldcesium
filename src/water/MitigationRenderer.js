import * as Cesium from 'cesium';

/**
 * MitigationRenderer — renders 3D mitigation visuals around a building.
 *
 * Supported visuals:
 *   mid=1  Elevate Structure  → translucent stilts/pillars under the building
 *   mid=11 Sandbagging        → low tan wall ring around the building
 *   mid=12 Levees/Floodwalls  → taller concrete-gray wall ring around the building
 */
export class MitigationRenderer {
  constructor(viewer) {
    this.viewer = viewer;
    this._entities = [];
    this._activeMid = null;
    this._activeDesign = null;
  }

  /**
   * Render a mitigation visual at a building location.
   */
  show(lat, lng, groundElevation, mid, designFt, sqft = 1500) {
    this.clear();
    this._activeMid = mid;
    this._activeDesign = designFt;

    const designM = designFt * 0.3048;
    // Estimate building footprint: assume square, with some padding
    const sideFt = Math.sqrt(sqft);
    const sideM = sideFt * 0.3048;

    // Add generous padding so the visuals are clearly around the building
    const padded = sideM * 0.7; // half-side with padding
    const halfLatDeg = padded / 111320;
    const cosLat = Math.cos(lat * Math.PI / 180);
    const halfLngDeg = padded / (111320 * cosLat);

    if (mid === 1) {
      this._renderElevation(lat, lng, groundElevation, designM, halfLatDeg, halfLngDeg, sideM);
    } else if (mid === 11) {
      this._renderSandbags(lat, lng, groundElevation, designM, halfLatDeg, halfLngDeg, sideM);
    } else if (mid === 12) {
      this._renderFloodwall(lat, lng, groundElevation, designM, halfLatDeg, halfLngDeg, sideM);
    }
  }

  clear() {
    for (const entity of this._entities) {
      this.viewer.entities.remove(entity);
    }
    this._entities = [];
    this._activeMid = null;
    this._activeDesign = null;
  }

  get isActive() { return this._entities.length > 0; }

  // ─── Elevate Structure (mid=1) ──────────────────────────────
  _renderElevation(lat, lng, groundElev, heightM, halfLatDeg, halfLngDeg, sideM) {
    const pillarColor = new Cesium.Color(0.72, 0.58, 0.42, 0.9);
    const pillarOutline = new Cesium.Color(0.5, 0.4, 0.28, 1.0);
    const pillarRadius = Math.max(0.25, sideM * 0.04);

    // 8 pillars: 4 corners + 4 midpoints
    const offsets = [
      [-0.85, -0.85], [0.85, -0.85], [0.85, 0.85], [-0.85, 0.85],
      [0, -0.85], [0.85, 0], [0, 0.85], [-0.85, 0],
    ];

    for (const [fy, fx] of offsets) {
      const pLat = lat + halfLatDeg * fy;
      const pLng = lng + halfLngDeg * fx;
      this._entities.push(this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(pLng, pLat, groundElev + heightM / 2),
        cylinder: {
          length: heightM,
          topRadius: pillarRadius,
          bottomRadius: pillarRadius * 1.3,
          material: pillarColor,
          outline: true,
          outlineColor: pillarOutline,
          outlineWidth: 2,
        }
      }));
    }

    // Elevated platform slab
    const cosLat = Math.cos(lat * Math.PI / 180);
    const platWidthM = halfLngDeg * 2 * 111320 * cosLat;
    const platDepthM = halfLatDeg * 2 * 111320;
    this._entities.push(this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, groundElev + heightM),
      box: {
        dimensions: new Cesium.Cartesian3(platWidthM, platDepthM, 0.2),
        material: new Cesium.Color(0.6, 0.5, 0.38, 0.6),
        outline: true,
        outlineColor: pillarOutline,
      }
    }));

    this._addLabel(lat, lng, groundElev + heightM + 3,
      `⬆ Elevated ${(heightM / 0.3048).toFixed(0)} ft`, '#d4a574');
  }

  // ─── Sandbagging (mid=11) ───────────────────────────────────
  _renderSandbags(lat, lng, groundElev, heightM, halfLatDeg, halfLngDeg, sideM) {
    const wallColor = new Cesium.Color(0.78, 0.68, 0.45, 0.88);
    const outlineColor = new Cesium.Color(0.62, 0.52, 0.32, 1.0);
    const thickness = Math.max(0.5, sideM * 0.06); // thicker walls

    this._renderWallRing(lat, lng, groundElev, heightM, halfLatDeg, halfLngDeg, thickness, wallColor, outlineColor);

    // Add small "sandbag bumps" on top of walls as corner accents
    const cornerOffsets = [
      [-1, -1], [1, -1], [1, 1], [-1, 1]
    ];
    for (const [fy, fx] of cornerOffsets) {
      const cLat = lat + halfLatDeg * fy;
      const cLng = lng + halfLngDeg * fx;
      this._entities.push(this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cLng, cLat, groundElev + heightM),
        ellipsoid: {
          radii: new Cesium.Cartesian3(thickness * 1.5, thickness * 1.5, heightM * 0.25),
          material: new Cesium.Color(0.72, 0.62, 0.38, 0.85),
        }
      }));
    }

    this._addLabel(lat, lng, groundElev + heightM + 3,
      `🧱 Sandbags ${(heightM / 0.3048).toFixed(0)} ft`, '#c4a55a');
  }

  // ─── Levees / Floodwalls (mid=12) ───────────────────────────
  _renderFloodwall(lat, lng, groundElev, heightM, halfLatDeg, halfLngDeg, sideM) {
    const wallColor = new Cesium.Color(0.58, 0.58, 0.62, 0.92);
    const outlineColor = new Cesium.Color(0.42, 0.42, 0.48, 1.0);
    const thickness = Math.max(0.35, sideM * 0.04);

    this._renderWallRing(lat, lng, groundElev, heightM, halfLatDeg, halfLngDeg, thickness, wallColor, outlineColor);

    // Vertical buttresses at corners for structural look
    const cornerOffsets = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [fy, fx] of cornerOffsets) {
      const cLat = lat + halfLatDeg * fy;
      const cLng = lng + halfLngDeg * fx;
      this._entities.push(this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cLng, cLat, groundElev + heightM / 2),
        box: {
          dimensions: new Cesium.Cartesian3(thickness * 3, thickness * 3, heightM),
          material: new Cesium.Color(0.52, 0.52, 0.56, 0.9),
          outline: true,
          outlineColor: outlineColor,
        }
      }));
    }

    this._addLabel(lat, lng, groundElev + heightM + 3,
      `🌊 Floodwall ${(heightM / 0.3048).toFixed(0)} ft`, '#8899aa');
  }

  // ─── Shared: Wall ring around building ──────────────────────
  _renderWallRing(lat, lng, groundElev, heightM, halfLatDeg, halfLngDeg, thicknessM, color, outlineColor) {
    const cosLat = Math.cos(lat * Math.PI / 180);

    // Actual wall dimensions in meters
    const fullWidthM = halfLngDeg * 2 * 111320 * cosLat;
    const fullDepthM = halfLatDeg * 2 * 111320;

    // Thickness in degrees
    const thickLatDeg = thicknessM / 111320;
    const thickLngDeg = thicknessM / (111320 * cosLat);

    const walls = [
      // South wall (full width)
      { lat: lat - halfLatDeg, lng: lng, w: fullWidthM + thicknessM * 2, d: thicknessM },
      // North wall (full width)
      { lat: lat + halfLatDeg, lng: lng, w: fullWidthM + thicknessM * 2, d: thicknessM },
      // West wall (between north and south)
      { lat: lat, lng: lng - halfLngDeg, w: thicknessM, d: fullDepthM },
      // East wall (between north and south)
      { lat: lat, lng: lng + halfLngDeg, w: thicknessM, d: fullDepthM },
    ];

    for (const wall of walls) {
      this._entities.push(this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(wall.lng, wall.lat, groundElev + heightM / 2),
        box: {
          dimensions: new Cesium.Cartesian3(wall.w, wall.d, heightM),
          material: color,
          outline: true,
          outlineColor: outlineColor,
          outlineWidth: 2,
        }
      }));
    }
  }

  // ─── Label above mitigation ─────────────────────────────────
  _addLabel(lat, lng, height, text, color) {
    this._entities.push(this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, height),
      label: {
        text: text,
        font: '14px Inter, sans-serif',
        fillColor: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(30, 1.2, 800, 0.5),
        showBackground: true,
        backgroundColor: new Cesium.Color(0, 0, 0, 0.5),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
      }
    }));
  }
}
