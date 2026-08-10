/**
 * NSIService — nearest-building lookup against a pre-trimmed extract of the
 * USACE National Structure Inventory (NSI).
 *
 * The full NSI dataset for Orleans Parish is ~120MB/135k buildings — far too
 * large to fetch at runtime. public/data/nsi_orleans.json is a one-time,
 * offline-generated trim (see scripts/build-nsi-dataset.mjs) covering a 1mi
 * radius around each preset location in Controls.js, keeping only the fields
 * DamagePanel actually uses. It's fetched once here and searched in memory.
 */

const DATA_URL = `${import.meta.env.BASE_URL}data/nsi_orleans.json`;

// Beyond this, a "nearest building" is probably the wrong building —
// treat it as no match rather than mis-attributing real building data.
const MAX_MATCH_DISTANCE_M = 50;

let buildings = null;
let loadPromise = null;

/**
 * Map an NSI occupancy code (e.g. "RES1-1SNB", "COM4", "GOV2", "RES3A") onto
 * an occupancy type that has a depth-damage curve in curves.json.
 *
 * curves.json contains curves for: RES1–RES6, COM1–COM9, IND1–IND6, AGR1,
 * GOV1–GOV2, EDU1–EDU2, REL1.
 *
 * NSI occtypes can include suffixes like "-1SNB" (stories/basement) or letter
 * suffixes like "RES3A"–"RES3F". We strip those to match the base type, then
 * fall back to a sensible default in the same category if the exact base type
 * isn't found.
 */

// Set of occupancy types that have curves in curves.json
const CURVE_OCCUPANCY_TYPES = new Set([
  'RES1', 'RES2', 'RES3', 'RES4', 'RES5', 'RES6',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'IND1', 'IND2', 'IND3', 'IND4', 'IND5', 'IND6',
  'AGR1',
  'GOV1', 'GOV2',
  'EDU1', 'EDU2',
  'REL1',
]);

export function mapOccupancyClass(occtype) {
  if (!occtype) return 'RES1';

  // Strip dash-suffixes first: "RES1-1SNB" → "RES1"
  const beforeDash = occtype.split('-')[0];

  // Check if the full prefix is a known curve type (e.g. "COM4", "GOV2")
  if (CURVE_OCCUPANCY_TYPES.has(beforeDash)) return beforeDash;

  // Strip trailing letters for subtypes: "RES3A" → "RES3", "RES3F" → "RES3"
  const baseMatch = beforeDash.match(/^([A-Z]+\d+)/);
  if (baseMatch && CURVE_OCCUPANCY_TYPES.has(baseMatch[1])) return baseMatch[1];

  // Fall back by category prefix
  if (beforeDash.startsWith('RES')) return 'RES1';
  if (beforeDash.startsWith('COM')) return 'COM1';
  if (beforeDash.startsWith('IND')) return 'IND1';
  if (beforeDash.startsWith('GOV')) return 'GOV1';
  if (beforeDash.startsWith('EDU')) return 'EDU1';
  if (beforeDash.startsWith('REL')) return 'REL1';
  if (beforeDash.startsWith('AGR')) return 'AGR1';

  return 'RES1'; // ultimate fallback
}


/**
 * Fetch and cache the trimmed NSI dataset. Safe to call multiple times —
 * subsequent calls return the same in-flight/resolved promise. Failures
 * degrade to an empty dataset (findNearestBuilding then always returns
 * null, and callers fall back to their existing mock/estimated behavior).
 * @returns {Promise<Array>}
 */
export function loadNSIData() {
  if (buildings) return Promise.resolve(buildings);
  if (loadPromise) return loadPromise;

  loadPromise = fetch(DATA_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      buildings = data;
      console.log(`[NSIService] Loaded ${buildings.length} buildings`);
      return buildings;
    })
    .catch((error) => {
      console.warn('[NSIService] Failed to load NSI dataset:', error.message);
      buildings = [];
      return buildings;
    });

  return loadPromise;
}

export function isNSIDataLoaded() {
  return buildings !== null;
}

/**
 * All loaded NSI building records (raw, untrimmed by distance). Empty array
 * if the dataset hasn't loaded yet or failed to load.
 * @returns {Array}
 */
export function getAllBuildings() {
  return buildings || [];
}

/**
 * Find the nearest NSI building record to a lat/lng, within 50m.
 * Linear scan — dataset is ~40k points, well under a millisecond per call.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {{
 *   occupancy: string,
 *   rawOcctype: string|null,
 *   foundationHeightFt: number|null,
 *   foundationType: string|null,
 *   buildingType: string|null,
 *   numStory: number|null,
 *   structuralValueUSD: number|null,
 *   contentValueUSD: number|null,
 *   sqft: number|null,
 *   distanceM: number,
 * }|null}
 */
export function findNearestBuilding(lat, lng) {
  if (!buildings || buildings.length === 0) return null;

  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best = null;
  let bestDistM = Infinity;

  for (const b of buildings) {
    const dLatM = (b.lat - lat) * 111320;
    const dLngM = (b.lng - lng) * 111320 * cosLat;
    const distM = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
    if (distM < bestDistM) {
      bestDistM = distM;
      best = b;
    }
  }

  if (!best || bestDistM > MAX_MATCH_DISTANCE_M) return null;

  return {
    occupancy: mapOccupancyClass(best.occtype),
    rawOcctype: best.occtype ?? null,
    foundationHeightFt: best.found_ht,
    foundationType: best.found_type ?? null,
    buildingType: best.bldgtype ?? null,
    numStory: best.num_story ?? null,
    structuralValueUSD: best.val_struct,
    contentValueUSD: best.val_cont,
    sqft: best.sqft,
    distanceM: bestDistM,
  };
}
