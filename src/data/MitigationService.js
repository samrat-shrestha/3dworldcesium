/**
 * MitigationService — loads mitigation options from mitigations.json and
 * provides lookup/cost-benefit analysis for a given building.
 *
 * Mitigation types:
 *   mid=1  Elevate Structure (area-based cost, design=2–8 ft)
 *   mid=11 Sandbagging       (linear-based cost, design=1–4 ft)
 *   mid=12 Levees/Floodwalls (linear-based cost, design=2–6 ft)
 */

const DATA_URL = `${import.meta.env.BASE_URL}data/mitigations.json`;

let mitigationData = null;
let loadPromise = null;

/**
 * Load the mitigations dataset. Safe to call repeatedly.
 * @returns {Promise<Array>}
 */
export function loadMitigationData() {
  if (mitigationData) return Promise.resolve(mitigationData);
  if (loadPromise) return loadPromise;

  loadPromise = fetch(DATA_URL)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      mitigationData = data.mitigation_options;
      console.log(`[MitigationService] Loaded ${mitigationData.length} mitigation entries`);
      return mitigationData;
    })
    .catch(err => {
      console.warn('[MitigationService] Failed to load mitigations:', err.message);
      mitigationData = [];
      return mitigationData;
    });

  return loadPromise;
}

// The three visually-representable mitigation types we support
const VISUAL_MIDS = new Set([1, 11, 12]);

/**
 * Given a flood depth and building properties, return applicable mitigation
 * options with cost-benefit analysis.
 *
 * @param {number} depthFt — Flood depth above ground (ft)
 * @param {Object} buildingInfo — From NSIService.findNearestBuilding()
 * @param {string} buildingInfo.occupancy
 * @param {number|null} buildingInfo.foundationHeightFt
 * @param {number|null} buildingInfo.structuralValueUSD
 * @param {number|null} buildingInfo.contentValueUSD
 * @param {number|null} buildingInfo.sqft
 * @param {Function} getDamageEstimate — The damage estimator function
 * @returns {Array<Object>} Sorted by benefit-cost ratio (best first)
 */
export function getApplicableMitigations(depthFt, buildingInfo, getDamageEstimate) {
  if (!mitigationData || mitigationData.length === 0) return [];
  if (!buildingInfo) return [];

  const sqft = buildingInfo.sqft || 1500; // fallback
  // Estimate perimeter: assume roughly square building
  const sideFt = Math.sqrt(sqft);
  const perimeterFt = sideFt * 4;

  const foundationHt = buildingInfo.foundationHeightFt ?? 0;
  const structVal = buildingInfo.structuralValueUSD ?? 200000;
  const contentVal = buildingInfo.contentValueUSD ?? 100000;
  const occupancy = buildingInfo.occupancy || 'RES1';

  // Current damage (baseline — no mitigation)
  const baselineEstimate = getDamageEstimate(occupancy, depthFt, {
    foundationHeightFt: foundationHt,
    replacementValueUSD: structVal,
    contentValueUSD: contentVal,
  });
  const baselineTotalLoss = baselineEstimate.structuralUSD + baselineEstimate.contentUSD;

  // Only consider visual mitigations
  const candidates = mitigationData.filter(m => VISUAL_MIDS.has(m.mid));

  // Infer foundation type from NSI foundation height:
  //   found_ht < 1 ft → likely Slab-on-Grade
  //   found_ht >= 1 ft → likely Basement or Crawlspace
  const inferredFoundation = foundationHt < 1 ? 'Slab-on-Grade' : 'Basement or Crawlspace';
  // NSI doesn't carry construction type — default to frame (most common residential)
  const inferredConstruction = 'frame';

  // For each mid+design, pick the entry that best matches the building's
  // inferred foundation and construction type. Fall back to any entry if
  // no exact match (e.g. sandbags/levees have no foundation_type field).
  const grouped = new Map();
  for (const m of candidates) {
    const key = `${m.mid}_${m.design}`;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, m);
      continue;
    }

    // Score: how well does this entry match the building?
    const scoreEntry = (entry) => {
      let s = 0;
      if (entry.foundation_type && entry.foundation_type === inferredFoundation) s += 2;
      if (entry['construction type'] && entry['construction type'] === inferredConstruction) s += 1;
      return s;
    };

    if (scoreEntry(m) > scoreEntry(existing)) {
      grouped.set(key, m);
    }
  }

  const results = [];

  for (const m of grouped.values()) {
    const designFt = m.design;
    if (designFt === '' || designFt == null) continue;

    // ── Cost calculation ──
    let totalCost;
    if (m.app_type === 'area') {
      // Cost per sqft of building area
      totalCost = (m.cost || 0) * sqft;
    } else {
      // Linear: cost per linear foot of perimeter
      totalCost = (m.cost || 0) * perimeterFt;
    }
    if (totalCost <= 0) continue;

    // ── Mitigated damage calculation ──
    let mitigatedFoundationHt;
    if (m.mid === 1) {
      // Elevate: raise foundation by design height
      mitigatedFoundationHt = foundationHt + designFt;
    } else {
      // Sandbags / Levees: act as a barrier at design height
      // If flood depth > barrier height, water overtops → damage from overflow
      // If flood depth <= barrier height, water is blocked → 0 damage
      if (depthFt <= designFt) {
        mitigatedFoundationHt = depthFt + 1; // effectively blocked
      } else {
        // Overtopped: only the depth above the barrier causes damage
        mitigatedFoundationHt = foundationHt + designFt;
      }
    }

    const mitigatedEstimate = getDamageEstimate(occupancy, depthFt, {
      foundationHeightFt: mitigatedFoundationHt,
      replacementValueUSD: structVal,
      contentValueUSD: contentVal,
    });
    const mitigatedTotalLoss = mitigatedEstimate.structuralUSD + mitigatedEstimate.contentUSD;

    const avoidedLoss = baselineTotalLoss - mitigatedTotalLoss;
    const bcr = avoidedLoss > 0 ? avoidedLoss / totalCost : 0;

    // Labels
    let label, icon;
    if (m.mid === 1) {
      label = `Elevate ${designFt} ft`;
      icon = '🏗️';
    } else if (m.mid === 11) {
      label = `Sandbags ${designFt} ft`;
      icon = '🧱';
    } else if (m.mid === 12) {
      label = `Floodwall ${designFt} ft`;
      icon = '🌊';
    }

    results.push({
      mid: m.mid,
      measure: m.measure,
      label,
      icon,
      designFt,
      totalCost,
      lifeSpan: m['life span (years)'] || null,
      baselineLoss: baselineTotalLoss,
      mitigatedLoss: mitigatedTotalLoss,
      avoidedLoss,
      bcr,
      structuralLossBefore: baselineEstimate.structuralUSD,
      contentLossBefore: baselineEstimate.contentUSD,
      structuralLossAfter: mitigatedEstimate.structuralUSD,
      contentLossAfter: mitigatedEstimate.contentUSD,
      description: m.description,
      restrictions: m.restrictions || '',
    });
  }

  // Sort: highest benefit-cost ratio first
  results.sort((a, b) => b.bcr - a.bcr);
  return results;
}
