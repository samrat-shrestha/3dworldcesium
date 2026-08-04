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
 * Map an NSI occupancy code (e.g. "RES1-1SNB", "COM4", "GOV2") onto the
 * three occupancy buckets DepthDamageCurves has curves for.
 */
export function mapOccupancyClass(occtype) {
  if (!occtype) return 'RES1';
  const prefix = occtype.split('-')[0];
  if (prefix.startsWith('RES')) return 'RES1';
  if (prefix.startsWith('GOV') || prefix.startsWith('EDU') || prefix.startsWith('REL')) return 'GOV1';
  return 'COM1'; // COM*, IND*, AGR*, etc.
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
    structuralValueUSD: best.val_struct,
    contentValueUSD: best.val_cont,
    sqft: best.sqft,
    distanceM: bestDistM,
  };
}
