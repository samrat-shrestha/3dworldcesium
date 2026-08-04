/**
 * DepthDamageCurves — depth-damage functions for building loss estimation.
 *
 * Curve shapes follow the general form of FEMA/HAZUS-MH depth-damage
 * functions (one-story, no-basement, credibility-weighted) for the three
 * occupancy classes the app already labels buildings with: RES1
 * (single-family residential), COM1 (commercial), GOV1 (government).
 *
 * IMPORTANT — these are illustrative approximations of published curve
 * shapes, not the official FEMA tables (which require a licensed HAZUS-MH
 * dataset to reproduce exactly). Good enough to make relative comparisons
 * (this building vs that one, this depth vs that depth) meaningful; not a
 * substitute for a certified HAZUS loss study.
 *
 * Depth is measured relative to the FIRST-FLOOR ELEVATION, not ground.
 * A default foundation height is subtracted from ground-relative depth
 * before lookup — see DEFAULT_FOUNDATION_HEIGHT_FT.
 */

export const OCCUPANCY_TYPES = ['RES1', 'COM1', 'GOV1'];

// Typical raised-foundation height for the region (New Orleans slab/pier
// construction commonly sits 1-2 ft above grade). Used when a real
// first-floor elevation isn't available.
export const DEFAULT_FOUNDATION_HEIGHT_FT = 1.5;

// Assumed replacement value per building, used only to turn a damage
// percentage into a dollar figure. No real valuation or footprint data is
// available, so these are single flat placeholders per occupancy type.
const REPLACEMENT_VALUE_USD = {
  RES1: 200000,
  COM1: 750000,
  GOV1: 1000000,
};

// Content value as a fraction of structure replacement value (HAZUS default
// convention: 50% for residential, 100% for commercial/government).
const CONTENT_VALUE_RATIO = {
  RES1: 0.5,
  COM1: 1.0,
  GOV1: 1.0,
};

// Breakpoints: [depthAboveFirstFloorFt, damagePercent]. Linear interpolation
// between points; clamped to the first/last value outside the range.
const CURVES = {
  RES1: {
    structure: [[-2, 0], [0, 9], [2, 22], [4, 32], [6, 44], [10, 58], [16, 72], [24, 80]],
    content: [[-2, 0], [0, 8], [2, 21], [4, 33], [6, 45], [10, 61], [16, 75], [24, 85]],
  },
  COM1: {
    structure: [[-2, 0], [0, 5], [2, 15], [4, 23], [6, 30], [10, 42], [16, 55], [24, 65]],
    content: [[-2, 0], [0, 9], [2, 20], [4, 31], [6, 38], [10, 50], [16, 62], [24, 70]],
  },
  GOV1: {
    structure: [[-2, 0], [0, 6], [2, 16], [4, 24], [6, 31], [10, 43], [16, 56], [24, 66]],
    content: [[-2, 0], [0, 10], [2, 22], [4, 33], [6, 40], [10, 52], [16, 64], [24, 72]],
  },
};

function interpolate(points, x) {
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
 * @param {string} occupancy - 'RES1' | 'COM1' | 'GOV1'
 * @param {number} depthAboveFirstFloorFt
 * @param {'structure'|'content'} kind
 * @returns {number}
 */
export function getDamagePercent(occupancy, depthAboveFirstFloorFt, kind) {
  const curve = CURVES[occupancy] || CURVES.RES1;
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
 * @param {string} occupancy - 'RES1' | 'COM1' | 'GOV1'
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
