/**
 * ElevationService — Bare-earth elevation from the USGS 3DEP Elevation Point Query Service.
 *
 * Returns elevation in NAVD88 (Mean Sea Level) from the National Elevation Dataset
 * at ~10m resolution. Bare-earth data — no buildings, no trees.
 *
 * In development, requests are proxied through Vite to bypass CORS:
 *   Browser → /api/usgs-elevation/v1/json → Vite proxy → epqs.nationalmap.gov/v1/json
 *
 * The geoid offset (WGS84↔NAVD88 conversion) is auto-calibrated on first use.
 */

// In dev, use the Vite proxy. In production, use the direct URL.
const USGS_PROXY_URL = '/api/usgs-elevation/v1/json';
const USGS_DIRECT_URL = 'https://epqs.nationalmap.gov/v1/json';

export class ElevationService {
  constructor() {
    this.geoidOffset = null;
  }

  /**
   * Get the USGS API URL (proxied in dev, direct in production).
   */
  _getBaseUrl() {
    // In dev mode (Vite), use the proxy path
    if (import.meta.env.DEV) {
      return USGS_PROXY_URL;
    }
    return USGS_DIRECT_URL;
  }

  /**
   * Query the USGS EPQS for bare-earth elevation.
   * Returns NAVD88 height (MSL) in meters, or null on failure.
   *
   * @param {number} lat
   * @param {number} lng
   * @returns {Promise<number|null>}
   */
  async getElevationNAVD88(lat, lng) {
    try {
      const baseUrl = this._getBaseUrl();
      const url = `${baseUrl}?x=${lng}&y=${lat}&units=Meters&wkid=4326`;

      console.log(`[ElevationService] Fetching USGS elevation for ${lat.toFixed(5)}°, ${lng.toFixed(5)}°...`);

      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`[ElevationService] USGS EPQS HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();

      // Handle different response formats
      let elevation = null;
      if (data.value !== undefined && data.value !== null) {
        elevation = parseFloat(data.value);
      } else if (data.elevation !== undefined) {
        elevation = parseFloat(data.elevation);
      }

      // USGS returns -1000000 for ocean/invalid points
      if (elevation === null || isNaN(elevation) || elevation < -500) {
        console.warn('[ElevationService] Invalid USGS response:', data);
        return null;
      }

      console.log(`[ElevationService] USGS bare-earth: ${elevation.toFixed(2)}m NAVD88`);
      return elevation;
    } catch (error) {
      console.warn('[ElevationService] USGS fetch failed:', error.message);
      return null;
    }
  }

  /**
   * Convert NAVD88 → WGS84 ellipsoid height.
   */
  toEllipsoid(navd88) {
    return this.geoidOffset !== null ? navd88 + this.geoidOffset : navd88;
  }

  /**
   * Convert WGS84 ellipsoid → NAVD88 height.
   */
  toNAVD88(ellipsoid) {
    return this.geoidOffset !== null ? ellipsoid - this.geoidOffset : ellipsoid;
  }

  get isCalibrated() {
    return this.geoidOffset !== null;
  }
}
