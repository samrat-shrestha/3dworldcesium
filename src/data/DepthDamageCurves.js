/**
 * DepthDamageCurves — depth-damage functions for building loss estimation.
 *
 * Loads real depth-damage curve data from public/data/curves.json, which
 * contains per-occupancy-type breakpoints for structural and content damage
 * percentages at integer depth values (ft above first-floor elevation).
 *
 * The curves.json file covers 27 occupancy types: RES1–RES6, COM1–COM9,
 * IND1–IND6, AGR1, GOV1–GOV2, EDU1–EDU2, REL1. Linear interpolation is
 * used between breakpoints; values outside the range clamp to the nearest
 * endpoint.
 *
 * Depth is measured relative to the FIRST-FLOOR ELEVATION, not ground.
 * A default foundation height is subtracted from ground-relative depth
 * before lookup — see DEFAULT_FOUNDATION_HEIGHT_FT.
 */

export const DEFAULT_FOUNDATION_HEIGHT_FT = 1.5;

// Assumed replacement value per building when real NSI data isn't available.
const REPLACEMENT_VALUE_USD = {
  RES1: 200000, RES2: 180000, RES3: 300000, RES4: 500000, RES5: 400000, RES6: 350000,
  COM1: 750000, COM2: 600000, COM3: 500000, COM4: 800000, COM5: 700000,
  COM6: 900000, COM7: 600000, COM8: 1000000, COM9: 800000,
  IND1: 900000, IND2: 850000, IND3: 800000, IND4: 750000, IND5: 700000, IND6: 650000,
  AGR1: 400000,
  GOV1: 1000000, GOV2: 900000,
  EDU1: 1200000, EDU2: 800000,
  REL1: 600000,
};

// Content value as fraction of structure replacement value.
const CONTENT_VALUE_RATIO = {
  RES1: 0.5, RES2: 0.5, RES3: 0.5, RES4: 0.5, RES5: 0.5, RES6: 0.5,
  COM1: 1.0, COM2: 1.0, COM3: 1.0, COM4: 1.0, COM5: 1.0,
  COM6: 1.0, COM7: 1.0, COM8: 1.0, COM9: 1.0,
  IND1: 1.0, IND2: 1.0, IND3: 1.0, IND4: 1.0, IND5: 1.0, IND6: 1.0,
  AGR1: 0.5,
  GOV1: 1.0, GOV2: 1.0,
  EDU1: 1.0, EDU2: 1.0,
  REL1: 1.0,
};

// ─── Parsed curve data ───────────────────────────────────────────────
// Maps occupancy → { structure: [[depth, pct], …], content: [[depth, pct], …] }
let CURVES = null;
let curvesLoadPromise = null;

const CURVES_URL = `${import.meta.env.BASE_URL}data/curves.json`;

/**
 * Load and parse curves.json into the CURVES lookup table.
 * Safe to call multiple times — subsequent calls share the same promise.
 * @returns {Promise<Object>}
 */
export function loadCurvesData() {
  if (CURVES) return Promise.resolve(CURVES);
  if (curvesLoadPromise) return curvesLoadPromise;

  curvesLoadPromise = fetch(CURVES_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      CURVES = parseCurvesJSON(data);
      console.log(`[DepthDamageCurves] Loaded curves for ${Object.keys(CURVES).length} occupancy types`);
      return CURVES;
    })
    .catch((error) => {
      console.warn('[DepthDamageCurves] Failed to load curves.json, using empty fallback:', error.message);
      CURVES = {};
      return CURVES;
    });

  return curvesLoadPromise;
}

/**
 * Parse the raw curves.json data into the CURVES lookup format.
 * Each entry has { occupancy, depth, cont_dam_per, struct_dam_per } with string values.
 * @param {{ curves: Array<{occupancy: string, depth: string, cont_dam_per: string, struct_dam_per: string}> }} data
 * @returns {Object}
 */
function parseCurvesJSON(data) {
  const curves = {};

  for (const entry of data.curves) {
    const occ = entry.occupancy;
    if (!curves[occ]) {
      curves[occ] = { structure: [], content: [] };
    }
    const depth = parseFloat(entry.depth);
    curves[occ].structure.push([depth, parseFloat(entry.struct_dam_per)]);
    curves[occ].content.push([depth, parseFloat(entry.cont_dam_per)]);
  }

  // Sort each curve's breakpoints by depth (should already be sorted, but be safe)
  for (const occ of Object.keys(curves)) {
    curves[occ].structure.sort((a, b) => a[0] - b[0]);
    curves[occ].content.sort((a, b) => a[0] - b[0]);
  }

  return curves;
}

/**
 * Check whether curves data has been loaded.
 * @returns {boolean}
 */
export function isCurvesDataLoaded() {
  return CURVES !== null;
}

/**
 * Get the list of occupancy types that have curve data.
 * @returns {string[]}
 */
export function getAvailableOccupancyTypes() {
  return CURVES ? Object.keys(CURVES) : [];
}

// ─── Interpolation ───────────────────────────────────────────────────

function interpolate(points, x) {
  if (!points || points.length === 0) return 0;
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[points.length - 1][0]) return points[points.length - 1][1];

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * Damage percent (0-100) for an occupancy type at a given depth above the
 * first-floor elevation.
 * @param {string} occupancy - Any occupancy type from curves.json (e.g. 'RES1', 'COM4', 'IND2')
 * @param {number} depthAboveFirstFloorFt
 * @param {'structure'|'content'} kind
 * @returns {number}
 */
export function getDamagePercent(occupancy, depthAboveFirstFloorFt, kind) {
  if (!CURVES) {
    console.warn('[DepthDamageCurves] Curves data not loaded yet — returning 0');
    return 0;
  }
  // Fall back to RES1 if occupancy type not found in curves data
  const curve = CURVES[occupancy] || CURVES['RES1'];
  if (!curve) return 0;
  return interpolate(curve[kind], depthAboveFirstFloorFt);
}

/**
 * Full damage estimate for a building given ground-relative flood depth.
 *
 * When real per-building figures are available (e.g. from NSIService),
 * pass them via `opts` to replace the class-average placeholders —
 * foundation height and dollar values become the building's actual values
 * instead of a flat estimate for its occupancy class.
 *
 * @param {string} occupancy - Any occupancy type from curves.json
 * @param {number} depthAboveGroundFt
 * @param {Object} [opts]
 * @param {number} [opts.foundationHeightFt] - Real first-floor height, if known
 * @param {number} [opts.replacementValueUSD] - Real structure value, if known
 * @param {number} [opts.contentValueUSD] - Real content value, if known
 * @returns {{
 *   depthAboveFirstFloorFt: number,
 *   foundationHeightFt: number,
 *   structuralPercent: number,
 *   contentPercent: number,
 *   structuralUSD: number,
 *   contentUSD: number,
 *   replacementValueUSD: number,
 * }}
 */
export function getDamageEstimate(occupancy, depthAboveGroundFt, opts = {}) {
  const foundationHeightFt = opts.foundationHeightFt ?? DEFAULT_FOUNDATION_HEIGHT_FT;
  const depthAboveFirstFloorFt = depthAboveGroundFt - foundationHeightFt;
  const structuralPercent = getDamagePercent(occupancy, depthAboveFirstFloorFt, 'structure');
  const contentPercent = getDamagePercent(occupancy, depthAboveFirstFloorFt, 'content');

  const replacementValueUSD = opts.replacementValueUSD
    ?? REPLACEMENT_VALUE_USD[occupancy]
    ?? REPLACEMENT_VALUE_USD.RES1;
  const contentValueUSD = opts.contentValueUSD
    ?? replacementValueUSD * (CONTENT_VALUE_RATIO[occupancy] ?? CONTENT_VALUE_RATIO.RES1);

  return {
    depthAboveFirstFloorFt,
    foundationHeightFt,
    structuralPercent,
    contentPercent,
    structuralUSD: replacementValueUSD * (structuralPercent / 100),
    contentUSD: contentValueUSD * (contentPercent / 100),
    replacementValueUSD,
  };
}
