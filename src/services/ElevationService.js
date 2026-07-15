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

const GOOGLE_PROXY_URL = '/api/google-elevation/maps/api/elevation/json';
const GOOGLE_DIRECT_URL = 'https://maps.googleapis.com/maps/api/elevation/json';

const GOOGLE_ELEVATION_API_KEY = 'AIzaSyA6A821SVHUtMukcDMnZK7OXSw8MxwTGck';

export class ElevationService {
  constructor() {
    this.geoidOffset = null;
    this.provider = 'google'; // 'google' or 'usgs'
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
  async _getUSGSElevation(lat, lng) {
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

  _getGoogleBaseUrl() {
    if (import.meta.env.DEV) {
      return GOOGLE_PROXY_URL;
    }
    return 'https://hydroinformatics.tulane.edu/lab/cors/https://maps.googleapis.com/maps/api/elevation/json';
  }

  async _getGoogleElevation(lat, lng) {
    try {
      const baseUrl = this._getGoogleBaseUrl();
      const url = `${baseUrl}?locations=${lat},${lng}&key=${GOOGLE_ELEVATION_API_KEY}`;
      console.log(`[ElevationService] Fetching Google elevation for ${lat.toFixed(5)}°, ${lng.toFixed(5)}°...`);

      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[ElevationService] Google API HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const elevation = data.results[0].elevation;
        console.log(`[ElevationService] Google elevation: ${elevation.toFixed(2)}m MSL`);
        return elevation;
      } else {
        console.warn('[ElevationService] Google API Error:', data.status, data.error_message);
        return null;
      }
    } catch (error) {
      console.warn('[ElevationService] Google fetch failed:', error.message);
      return null;
    }
  }

  async getElevation(lat, lng) {
    if (this.provider === 'google') {
      return await this._getGoogleElevation(lat, lng);
    } else {
      return await this._getUSGSElevation(lat, lng);
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

  /**
   * Fetch a grid of elevations centered on (lat, lng).
   *
   * Used for DEM-aware flood fill. Generates a gridSize × gridSize grid
   * of lat/lng points and fetches their elevations from Google in batches.
   *
   * @param {number} lat - Center latitude
   * @param {number} lng - Center longitude
   * @param {number} radiusDeg - Radius in degrees
   * @param {number} [gridSize=20] - Grid dimension (gridSize × gridSize)
   * @returns {Promise<{grid: number[][], meta: Object}|null>}
   */
  async getElevationGrid(lat, lng, radiusDeg, gridSize = 20) {
    try {
      const cellSizeLat = (2 * radiusDeg) / gridSize;
      const cellSizeLng = (2 * radiusDeg) / gridSize;
      const halfGrid = Math.floor(gridSize / 2);

      // Generate all grid points
      const locations = [];
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          const ptLat = lat + (r - halfGrid) * cellSizeLat;
          const ptLng = lng + (c - halfGrid) * cellSizeLng;
          locations.push({ lat: ptLat, lng: ptLng });
        }
      }

      console.log(`[ElevationService] Fetching ${gridSize}×${gridSize} DEM grid (${locations.length} points)...`);

      // Batch into chunks of 40 to stay well under strict 2KB (2048) proxy limits
      // Using concurrent Promise.all so performance remains lightning fast
      const batchSize = 40;
      const batches = [];
      for (let i = 0; i < locations.length; i += batchSize) {
        batches.push(locations.slice(i, i + batchSize));
      }

      const allElevations = [];
      const baseUrl = this._getGoogleBaseUrl();

      const fetchPromises = batches.map(async (batch) => {
        const locStr = batch.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
        const url = `${baseUrl}?locations=${encodeURIComponent(locStr)}&key=${GOOGLE_ELEVATION_API_KEY}`;

        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[ElevationService] DEM grid fetch HTTP ${response.status}`);
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.status !== 'OK' || !data.results) {
          console.warn('[ElevationService] DEM grid API error:', data.status, data.error_message);
          throw new Error(`API Error: ${data.status}`);
        }

        return data.results.map(r => r.elevation);
      });

      try {
        const batchResults = await Promise.all(fetchPromises);
        // Flatten the array of arrays into a single list
        batchResults.forEach(elevations => allElevations.push(...elevations));
      } catch (error) {
        return null;
      }

      // Reshape flat array into 2D grid [row][col]
      const grid = [];
      for (let r = 0; r < gridSize; r++) {
        const row = [];
        for (let c = 0; c < gridSize; c++) {
          row.push(allElevations[r * gridSize + c]);
        }
        grid.push(row);
      }

      const meta = {
        originLat: lat,
        originLng: lng,
        cellSizeLat,
        cellSizeLng,
        rows: gridSize,
        cols: gridSize,
        radiusDeg,
      };

      console.log(
        `[ElevationService] DEM grid fetched: ${gridSize}×${gridSize}, ` +
        `cell size: ~${(cellSizeLat * 111000).toFixed(0)}m`
      );
      return { grid, meta };
    } catch (error) {
      console.warn('[ElevationService] DEM grid fetch failed:', error.message);
      return null;
    }
  }
}
