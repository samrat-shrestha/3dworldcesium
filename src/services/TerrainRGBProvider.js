/**
 * TerrainRGBProvider
 * Fetches elevation from AWS Mapzen Terrarium PNG tiles.
 * 
 * Formula: elevation = (R * 256 + G + B / 256) - 32768
 * Max zoom level: 15
 */

export class TerrainRGBProvider {
  constructor() {
    this.zoom = 15;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  lon2tile(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
  }

  lat2tile(lat, zoom) {
    return Math.floor(
      (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)
    );
  }

  lon2tileFraction(lon, zoom) {
    return ((lon + 180) / 360) * Math.pow(2, zoom);
  }

  lat2tileFraction(lat, zoom) {
    return ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * Math.pow(2, zoom);
  }

  /**
   * Helper to load an image wrapped in a Promise
   */
  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "Anonymous"; // Required for CORS
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load tile: ${url}`));
      img.src = url;
    });
  }

  /**
   * Gets a single elevation point (mostly for the origin click).
   * It fetches a single tile and reads one pixel.
   */
  async getElevation(lat, lng) {
    const tx = this.lon2tile(lng, this.zoom);
    const ty = this.lat2tile(lat, this.zoom);

    try {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${this.zoom}/${tx}/${ty}.png`;
      console.log(`[TerrainRGB] Fetching point tile: ${url}`);

      const img = await this.loadImage(url);

      this.canvas.width = 256;
      this.canvas.height = 256;
      this.ctx.drawImage(img, 0, 0);

      const px = Math.floor((this.lon2tileFraction(lng, this.zoom) - tx) * 256);
      const py = Math.floor((this.lat2tileFraction(lat, this.zoom) - ty) * 256);

      const pixelData = this.ctx.getImageData(px, py, 1, 1).data;
      const r = pixelData[0];
      const g = pixelData[1];
      const b = pixelData[2];

      const elevation = (r * 256 + g + b / 256) - 32768;
      console.log(`[TerrainRGB] Extracted elevation: ${elevation.toFixed(2)}m`);
      return elevation;
    } catch (e) {
      console.error('[TerrainRGB] Point fetch failed:', e);
      return null;
    }
  }

  /**
   * Fetches the DEM grid by downloading all necessary tiles, stitching them
   * onto a canvas, and reading the pixel for every grid coordinate.
   */
  async getElevationGrid(lat, lng, radiusDeg, gridSize = 20) {
    try {
      const cellSizeLat = (2 * radiusDeg) / gridSize;
      const cosLat = Math.cos(lat * Math.PI / 180);
      const cellSizeLng = cellSizeLat / (cosLat || 1);
      const halfGrid = Math.floor(gridSize / 2);

      // Determine bounding box of the grid
      const minLat = lat - radiusDeg;
      const maxLat = lat + radiusDeg;
      const minLng = lng - (radiusDeg / (cosLat || 1));
      const maxLng = lng + (radiusDeg / (cosLat || 1));

      // Determine required tiles (y is inverted in Web Mercator)
      const minX = this.lon2tile(minLng, this.zoom);
      const maxX = this.lon2tile(maxLng, this.zoom);
      const minY = this.lat2tile(maxLat, this.zoom);
      const maxY = this.lat2tile(minLat, this.zoom);

      const numTilesX = maxX - minX + 1;
      const numTilesY = maxY - minY + 1;

      console.log(`[TerrainRGB] Grid spans ${numTilesX}x${numTilesY} tiles.`);

      this.canvas.width = numTilesX * 256;
      this.canvas.height = numTilesY * 256;

      // Clear canvas just in case
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      const tilePromises = [];
      for (let tx = minX; tx <= maxX; tx++) {
        for (let ty = minY; ty <= maxY; ty++) {
          const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${this.zoom}/${tx}/${ty}.png`;
          const promise = this.loadImage(url).then(img => {
            const offsetX = (tx - minX) * 256;
            const offsetY = (ty - minY) * 256;
            this.ctx.drawImage(img, offsetX, offsetY);
          });
          tilePromises.push(promise);
        }
      }

      console.log(`[TerrainRGB] Downloading ${tilePromises.length} tile(s)...`);
      await Promise.all(tilePromises);

      // Get entire stitched image data at once for fast pixel reads
      const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
      const canvasWidth = this.canvas.width;

      const grid = [];
      for (let r = 0; r < gridSize; r++) {
        const row = [];
        for (let c = 0; c < gridSize; c++) {
          const ptLat = lat + (r - halfGrid) * cellSizeLat;
          const ptLng = lng + (c - halfGrid) * cellSizeLng;

          const px = Math.floor((this.lon2tileFraction(ptLng, this.zoom) - minX) * 256);
          const py = Math.floor((this.lat2tileFraction(ptLat, this.zoom) - minY) * 256);

          // Handle edge cases where floating math pushes us just outside the canvas
          const safePx = Math.max(0, Math.min(px, this.canvas.width - 1));
          const safePy = Math.max(0, Math.min(py, this.canvas.height - 1));

          const index = (safePy * canvasWidth + safePx) * 4;
          const red = imageData[index];
          const green = imageData[index + 1];
          const blue = imageData[index + 2];

          const elevation = (red * 256 + green + blue / 256) - 32768;
          row.push(elevation);
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
        `[TerrainRGB] DEM grid generated: ${gridSize}×${gridSize}, ` +
        `cell size: ~${(cellSizeLat * 111000).toFixed(0)}m`
      );

      return { grid, meta };

    } catch (error) {
      console.warn('[TerrainRGB] DEM grid fetch failed:', error.message);
      return null;
    }
  }
}
