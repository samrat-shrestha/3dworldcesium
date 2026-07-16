/**
 * FloodFill — DEM-aware flood simulation.
 *
 * Takes a 2D grid of elevation values and a seed point, runs BFS to find
 * all connected cells below the water level, then converts the result
 * into renderable cell rectangles.
 */

/**
 * Run BFS flood fill on a DEM grid.
 *
 * Starting from the seed cell, expands to 8-connected neighbors.
 * A cell is flooded if its elevation is below the specified water level
 * AND it is connected to the seed through other flooded cells.
 *
 * @param {number[][]} demGrid - 2D array [row][col] of MSL elevations
 * @param {number} seedRow - Starting row index
 * @param {number} seedCol - Starting column index
 * @param {number} waterLevelMSL - Absolute water level (meters MSL)
 * @returns {Set<string>} Set of "row,col" keys for flooded cells
 */
export function floodFill(demGrid, seedRow, seedCol, waterLevelMSL) {
  const rows = demGrid.length;
  const cols = demGrid[0].length;
  const flooded = new Set();
  const key = (r, c) => `${r},${c}`;

  // Bounds check
  if (seedRow < 0 || seedRow >= rows || seedCol < 0 || seedCol >= cols) return flooded;

  // Seed must be below water level to start filling
  if (demGrid[seedRow][seedCol] >= waterLevelMSL) return flooded;

  const queue = [[seedRow, seedCol]];
  flooded.add(key(seedRow, seedCol));

  // 8-connected neighbors (cardinal + diagonal)
  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      // Treat grid edges as walls — prevents water from wrapping around
      // terrain features (like levees) that extend beyond the grid
      if (nr === 0 || nr === rows - 1 || nc === 0 || nc === cols - 1) continue;
      const k = key(nr, nc);
      if (flooded.has(k)) continue;
      if (demGrid[nr][nc] < waterLevelMSL) {
        flooded.add(k);
        queue.push([nr, nc]);
      }
    }
  }

  return flooded;
}

/**
 * Convert flooded cells into an array of renderable rectangles.
 *
 * Each flooded cell becomes a { lat, lng, latSize, lngSize } object
 * describing a small quad that can be rendered at the water surface height.
 *
 * @param {Set<string>} floodedCells - Set of "row,col" keys
 * @param {Object} gridMeta - Grid metadata from ElevationService
 * @returns {Array<{lat: number, lng: number, latSize: number, lngSize: number}>}
 */
export function getFloodedCellRects(floodedCells, gridMeta) {
  const { originLat, originLng, cellSizeLat, cellSizeLng, rows, cols } = gridMeta;
  const halfRows = Math.floor(rows / 2);
  const halfCols = Math.floor(cols / 2);

  const rects = [];
  for (const cellKey of floodedCells) {
    const [r, c] = cellKey.split(',').map(Number);
    rects.push({
      lat: originLat + (r - halfRows) * cellSizeLat,
      lng: originLng + (c - halfCols) * cellSizeLng,
      latSize: cellSizeLat,
      lngSize: cellSizeLng,
    });
  }
  return rects;
}

/**
 * Generator version of floodFill for animated rendering.
 *
 * Yields the flooded Set after each BFS "ring" of expansion,
 * creating a visual effect of water spreading outward from the seed.
 *
 * @param {number[][]} demGrid - 2D array [row][col] of MSL elevations
 * @param {number} seedRow - Starting row index
 * @param {number} seedCol - Starting column index
 * @param {number} waterLevelMSL - Absolute water level (meters MSL)
 * @yields {Set<string>} Progressively growing set of flooded cell keys
 */
export function* floodFillAnimated(demGrid, seedRow, seedCol, waterLevelMSL) {
  const rows = demGrid.length;
  const cols = demGrid[0].length;
  const flooded = new Set();
  const key = (r, c) => `${r},${c}`;

  if (seedRow < 0 || seedRow >= rows || seedCol < 0 || seedCol >= cols) return;
  if (demGrid[seedRow][seedCol] >= waterLevelMSL) return;

  let frontier = [[seedRow, seedCol]];
  const seedKey = key(seedRow, seedCol);
  flooded.add(seedKey);
  yield { flooded, newCells: [seedKey] };

  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  while (frontier.length > 0) {
    const nextFrontier = [];
    const stepNewCells = [];
    for (const [r, c] of frontier) {
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        // Treat grid edges as walls
        if (nr === 0 || nr === rows - 1 || nc === 0 || nc === cols - 1) continue;
        const k = key(nr, nc);
        if (flooded.has(k)) continue;
        if (demGrid[nr][nc] < waterLevelMSL) {
          flooded.add(k);
          nextFrontier.push([nr, nc]);
          stepNewCells.push(k);
        }
      }
    }
    if (nextFrontier.length > 0) {
      frontier = nextFrontier;
      yield { flooded, newCells: stepNewCells };
    } else {
      break;
    }
  }
}
