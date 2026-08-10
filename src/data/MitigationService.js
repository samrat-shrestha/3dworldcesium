/**
 * MitigationService â€” loads mitigation options from mitigations.json and
 * provides lookup/cost-benefit analysis for a given building.
 *
 * Mitigation types:
 *   mid=1  Elevate Structure (area-based cost, design=2â€“8 ft)
 *   mid=11 Sandbagging       (linear-based cost, design=1â€“4 ft)
 *   mid=12 Levees/Floodwalls (linear-based cost, design=2â€“6 ft)
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

// All supported mitigation IDs from mitigations.json.
// mid=2 (Relocate Structure) is excluded because it has no design levels
// and represents physically moving the building â€” not a damage reduction measure.
const SUPPORTED_MIDS = new Set([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

// Mitigation categories for damage calculation:
//   ELEVATE  â€” raises the effective foundation height (mid=1 Elevate, mid=3 Reconstruction)
//   BARRIER  â€” blocks water up to design height (mid=11 Sandbags, mid=12 Levees/Floodwalls)
//   SHIELD   â€” prevents water entry at openings (mid=9 Wood Shield, mid=10 Metal Shield)
//   DRY_COAT â€” waterproof coating on walls (mid=5 Cement, mid=6 Membrane, mid=7 Asphalt)
//   DRY_DRAIN â€” interior drainage + sump pump (mid=8 Drainage Line)
//   WET_PROOF â€” allows water in but protects contents (mid=4 Wet Floodproofing)
const MITIGATION_CATEGORY = {
  1:  'ELEVATE',
  3:  'ELEVATE',
  4:  'WET_PROOF',
  5:  'DRY_COAT',
  6:  'DRY_COAT',
  7:  'DRY_COAT',
  8:  'DRY_DRAIN',
  9:  'SHIELD',
  10: 'SHIELD',
  11: 'BARRIER',
  12: 'BARRIER',
};

/**
 * Given a flood depth and building properties, return applicable mitigation
 * options with cost-benefit analysis.
 *
 * @param {number} depthFt â€” Flood depth above ground (ft)
 * @param {Object} buildingInfo â€” From NSIService.findNearestBuilding()
 * @param {string} buildingInfo.occupancy
 * @param {number|null} buildingInfo.foundationHeightFt
 * @param {number|null} buildingInfo.structuralValueUSD
 * @param {number|null} buildingInfo.contentValueUSD
 * @param {number|null} buildingInfo.sqft
 * @param {Function} getDamageEstimate â€” The damage estimator function
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

  // Current damage (baseline â€” no mitigation)
  const baselineEstimate = getDamageEstimate(occupancy, depthFt, {
    foundationHeightFt: foundationHt,
    replacementValueUSD: structVal,
    contentValueUSD: contentVal,
  });
  const baselineTotalLoss = baselineEstimate.structuralUSD + baselineEstimate.contentUSD;

  // Include all supported mitigations
  const candidates = mitigationData.filter(m => SUPPORTED_MIDS.has(m.mid));

  // Map NSI foundation type to mitigation options
  let inferredFoundation = 'Slab-on-Grade';
  if (buildingInfo.foundationType) {
    switch (buildingInfo.foundationType) {
      case 'C':
      case 'B':
        inferredFoundation = 'Basement or Crawlspace';
        break;
      case 'P':
        inferredFoundation = 'Open Foundation'; // Fallbacks to closest match if not found
        break;
      case 'S':
      default:
        inferredFoundation = 'Slab-on-Grade';
        break;
    }
  } else {
    // Fallback inference from NSI foundation height
    inferredFoundation = foundationHt < 1 ? 'Slab-on-Grade' : 'Basement or Crawlspace';
  }

  // Map NSI building type to mitigation options
  let inferredConstruction = 'frame';
  if (buildingInfo.buildingType) {
    switch (buildingInfo.buildingType) {
      case 'M':
      case 'C': // Concrete acts like masonry for these mitigations
        inferredConstruction = 'masonry';
        break;
      case 'W':
      case 'S': // Steel acts like frame
      default:
        inferredConstruction = 'frame';
        break;
    }
  }

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

    // â”€â”€ Cost calculation â”€â”€
    let totalCost;
    if (m.app_type === 'area') {
      // Cost per sqft of building area
      totalCost = (m.cost || 0) * sqft;
    } else {
      // Linear: cost per linear foot of perimeter
      totalCost = (m.cost || 0) * perimeterFt;
    }
    if (totalCost <= 0) continue;

    // â”€â”€ Mitigated damage calculation â”€â”€
    // Each category has a different damage-reduction mechanism
    const category = MITIGATION_CATEGORY[m.mid] || 'BARRIER';
    let mitigatedStructUSD, mitigatedContUSD;

    if (category === 'ELEVATE') {
      // Elevate / Reconstruct: raise effective foundation by design height
      const mitigatedFoundationHt = foundationHt + designFt;
      const est = getDamageEstimate(occupancy, depthFt, {
        foundationHeightFt: mitigatedFoundationHt,
        replacementValueUSD: structVal,
        contentValueUSD: contentVal,
      });
      mitigatedStructUSD = est.structuralUSD;
      mitigatedContUSD = est.contentUSD;

    } else if (category === 'BARRIER') {
      // Sandbags / Levees / Floodwalls: blocks water up to design height
      // If flood depth > barrier â†’ water overtops, reduced damage
      // If flood depth <= barrier â†’ water blocked, ~zero damage
      let effectiveFoundationHt;
      if (depthFt <= designFt) {
        effectiveFoundationHt = depthFt + 1; // effectively blocked
      } else {
        effectiveFoundationHt = foundationHt + designFt;
      }
      const est = getDamageEstimate(occupancy, depthFt, {
        foundationHeightFt: effectiveFoundationHt,
        replacementValueUSD: structVal,
        contentValueUSD: contentVal,
      });
      mitigatedStructUSD = est.structuralUSD;
      mitigatedContUSD = est.contentUSD;

    } else if (category === 'SHIELD') {
      // Flood Shields (wood/metal): block water entry at openings
      // Effective up to design height; if overtopped, damage from overflow
      let effectiveFoundationHt;
      if (depthFt <= designFt) {
        effectiveFoundationHt = depthFt + 1; // blocked
      } else {
        effectiveFoundationHt = foundationHt + designFt;
      }
      const est = getDamageEstimate(occupancy, depthFt, {
        foundationHeightFt: effectiveFoundationHt,
        replacementValueUSD: structVal,
        contentValueUSD: contentVal,
      });
      mitigatedStructUSD = est.structuralUSD;
      mitigatedContUSD = est.contentUSD;

    } else if (category === 'DRY_COAT' || category === 'DRY_DRAIN') {
      // Dry Coatings / Drainage: prevents water penetration through walls/floor.
      // FEMA BCA methodology: treat as raising the effective protection elevation.
      // Below design height → water kept out, minimal/no damage (same as barrier).
      // Above design height → protection overtopped, DDF applies from overflow depth.
      let effectiveFoundationHt;
      if (depthFt <= designFt) {
        effectiveFoundationHt = depthFt + 1; // water kept out
      } else {
        effectiveFoundationHt = foundationHt + designFt;
      }
      const est = getDamageEstimate(occupancy, depthFt, {
        foundationHeightFt: effectiveFoundationHt,
        replacementValueUSD: structVal,
        contentValueUSD: contentVal,
      });
      mitigatedStructUSD = est.structuralUSD;
      mitigatedContUSD = est.contentUSD;

    } else if (category === 'WET_PROOF') {
      // Wet Floodproofing: water is allowed in, but flood-resistant materials
      // are used and contents are elevated/relocated above design height.
      // FEMA BCA methodology: structural damage uses DDF at full depth (water
      // enters, but resistant materials reduce finish/wall damage by raising
      // effective foundation). Content damage uses DDF with contents elevated
      // to design height.
      const structEst = getDamageEstimate(occupancy, depthFt, {
        foundationHeightFt: foundationHt + Math.min(designFt, 1), // modest structural benefit from resistant materials
        replacementValueUSD: structVal,
        contentValueUSD: contentVal,
      });
      const contentEst = getDamageEstimate(occupancy, depthFt, {
        foundationHeightFt: foundationHt + designFt, // contents elevated to design height
        replacementValueUSD: structVal,
        contentValueUSD: contentVal,
      });
      mitigatedStructUSD = structEst.structuralUSD;
      mitigatedContUSD = contentEst.contentUSD;
    }

    const mitigatedTotalLoss = mitigatedStructUSD + mitigatedContUSD;
    const avoidedLoss = baselineTotalLoss - mitigatedTotalLoss;
    const bcr = avoidedLoss > 0 ? avoidedLoss / totalCost : 0;

    // Use the measure name from JSON directly
    const label = m.measure;

    results.push({
      mid: m.mid,
      measure: m.measure,
      label,
      designFt,
      totalCost,
      lifeSpan: m['life span (years)'] || null,
      baselineLoss: baselineTotalLoss,
      mitigatedLoss: mitigatedTotalLoss,
      avoidedLoss,
      bcr,
      structuralLossBefore: baselineEstimate.structuralUSD,
      contentLossBefore: baselineEstimate.contentUSD,
      structuralLossAfter: mitigatedStructUSD,
      contentLossAfter: mitigatedContUSD,
      description: m.description,
      restrictions: m.restrictions || '',
    });
  }

  // Sort: highest benefit-cost ratio first
  results.sort((a, b) => b.bcr - a.bcr);
  return results;
}


