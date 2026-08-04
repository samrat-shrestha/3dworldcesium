import { hazardFromFlow } from '../water/HazardRating.js';
import { getDamageEstimate } from '../data/DepthDamageCurves.js';

const M_TO_FT = 3.28084;

export class DamagePanel {
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.panel = document.getElementById('damagePanel');
    this.options = options;
    this._build();
  }

  _build() {
    this.panel.innerHTML = `
      <div class="info-title">
        <span>Damage Estimation Report</span>
        <button class="damage-close-btn" id="damageCloseBtn">&times;</button>
      </div>

      <div class="info-section">
        <h4 class="section-heading">Building Information</h4>
        <div class="info-row"><span class="info-label">Building ID:</span> <span class="info-value" id="damageBuildingId">Loading...</span></div>
        <div class="info-row"><span class="info-label">Occupancy Type:</span> <span class="info-value" id="damageOccupancyType">GOV1</span></div>
        <div class="info-row" id="damageSqftRow" style="display: none;"><span class="info-label">Square Footage:</span> <span class="info-value" id="damageSqft">—</span></div>
        <div class="info-row"><span class="info-label">Address:</span> <span class="info-value" id="damageAddress">Loading...</span></div>
        <div class="info-row"><span class="info-label">Coordinates:</span> <span class="info-value" id="damageCoords" style="font-family: monospace; font-size: 0.75rem;">—</span></div>
      </div>

      <div class="info-section">
        <h4 class="section-heading">Flood Conditions</h4>
        <div class="info-row"><span class="info-label">Flood Depth:</span> <span class="info-value" id="damageFloodDepth">—</span></div>
        <div class="info-row"><span class="info-label">Flow Velocity:</span> <span class="info-value" id="damageVelocity">—</span></div>
      </div>

      <div class="info-section">
        <h4 class="section-heading">Damage Summary</h4>
        <div class="info-row"><span class="info-label">Structural Loss:</span> <span class="info-value" id="damageStructuralLoss">—</span></div>
        <div class="info-row"><span class="info-label">Content Loss:</span> <span class="info-value" id="damageContentLoss">—</span></div>
      </div>

      <div class="info-section" style="margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; margin-bottom: 0px;">
        <div class="info-row" style="align-items: center; gap: 8px;">
          <span class="info-label" style="width: auto; flex: 1 1 auto;">Hazard Class:</span>
          <span class="info-value" id="damageSeverity" style="font-weight: 600; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; text-align: center; width: auto; white-space: nowrap; word-break: normal; flex: 0 0 auto;">—</span>
        </div>
        <div class="info-row" id="damageSeverityDesc" style="font-size: 0.72rem; color: var(--text-secondary, #999); margin-top: 4px;"></div>
      </div>

      <div class="info-section" id="damageAssumptions" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 0.68rem; color: var(--text-secondary, #888); line-height: 1.5;"></div>
    `;

    document.getElementById('damageCloseBtn').addEventListener('click', () => {
      this.hide();
      if (this.options.onClose) this.options.onClose();
    });
  }

  show() {
    this.panel.style.display = 'block';
  }

  hide() {
    this.panel.style.display = 'none';
  }

  setAddress(address) {
    document.getElementById('damageAddress').textContent = address || "Unknown Address";
  }

  setLoadingAddress() {
    document.getElementById('damageAddress').innerHTML = 'Fetching...';
  }

  /**
   * @param {number} lat
   * @param {number} lng
   * @param {number} depthFt - Water depth above ground, in feet
   * @param {{depth: number, peakDepth: number, peakSpeed: number, stale: boolean}|null} [flowState]
   *   Solver-derived flow state at this location, from WaterRenderer.getFlowStateAt().
   *   Null when no SWE simulation has run for the current origin.
   * @param {{occupancy: string, rawOcctype: string|null, foundationHeightFt: number|null,
   *   structuralValueUSD: number|null, contentValueUSD: number|null, sqft: number|null,
   *   distanceM: number}|null} [nsiMatch]
   *   Real building record from NSIService.findNearestBuilding(). Null when no NSI
   *   building was found within match distance — falls back to an inferred estimate.
   */
  setDamageInfo(lat, lng, depthFt, flowState = null, nsiMatch = null) {
    document.getElementById('damageCoords').textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
    document.getElementById('damageFloodDepth').textContent = `${depthFt.toFixed(1)} ft`;

    // Building ID is always synthetic — NSI doesn't ship a stable ID in the
    // trimmed dataset. Occupancy and sqft use the real match when available.
    const bId = Math.floor(Math.abs(lat * lng * 10000)) % 10000;
    document.getElementById('damageBuildingId').textContent = bId;

    const occupancy = nsiMatch
      ? nsiMatch.occupancy
      : ((bId % 3 === 0) ? 'RES1' : ((bId % 2 === 0) ? 'COM1' : 'GOV1'));
    document.getElementById('damageOccupancyType').textContent = nsiMatch
      ? `${occupancy} (${nsiMatch.rawOcctype})`
      : `${occupancy} (estimated)`;

    const sqftRow = document.getElementById('damageSqftRow');
    if (nsiMatch && nsiMatch.sqft) {
      sqftRow.style.display = 'flex';
      document.getElementById('damageSqft').textContent = `${nsiMatch.sqft.toLocaleString()} sq ft`;
    } else {
      sqftRow.style.display = 'none';
    }

    // ─── Flow velocity (from SWE solver peak fields) ───
    const velocityEl = document.getElementById('damageVelocity');

    if (flowState) {
      const speedFtPerSec = flowState.peakSpeed * M_TO_FT;
      velocityEl.style.opacity = flowState.stale ? '0.55' : '1';
      velocityEl.title = flowState.stale
        ? 'Water level has changed since this flow was simulated — velocity reflects the earlier simulated event.'
        : '';
      velocityEl.textContent = `${speedFtPerSec.toFixed(1)} ft/s${flowState.stale ? ' (stale)' : ''}`;
    } else {
      velocityEl.style.opacity = '1';
      velocityEl.title = '';
      velocityEl.textContent = depthFt > 0.1 ? 'No flow data' : '0.0 ft/s';
    }

    // ─── Damage estimate (depth-damage curves, with real NSI values when matched) ───
    const estimateOpts = {};
    if (nsiMatch) {
      if (nsiMatch.foundationHeightFt != null) estimateOpts.foundationHeightFt = nsiMatch.foundationHeightFt;
      if (nsiMatch.structuralValueUSD != null) estimateOpts.replacementValueUSD = nsiMatch.structuralValueUSD;
      if (nsiMatch.contentValueUSD != null) estimateOpts.contentValueUSD = nsiMatch.contentValueUSD;
    }
    const estimate = getDamageEstimate(occupancy, depthFt, estimateOpts);
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

    document.getElementById('damageStructuralLoss').textContent = depthFt > 0
      ? `${fmt.format(estimate.structuralUSD)} (${estimate.structuralPercent.toFixed(0)}%)`
      : fmt.format(0);
    document.getElementById('damageContentLoss').textContent = depthFt > 0
      ? `${fmt.format(estimate.contentUSD)} (${estimate.contentPercent.toFixed(0)}%)`
      : fmt.format(0);

    // ─── Hazard classification (depth × velocity) ───
    const hazard = hazardFromFlow(depthFt / M_TO_FT, flowState);
    const severityEl = document.getElementById('damageSeverity');
    const descEl = document.getElementById('damageSeverityDesc');

    severityEl.textContent = `${hazard.code} — ${hazard.label}`;
    severityEl.style.backgroundColor = `${hazard.color}33`;
    severityEl.style.color = hazard.color;
    severityEl.style.border = `1px solid ${hazard.color}55`;
    descEl.textContent = hazard.description;

    // ─── Assumptions footnote ───
    const assumptionsEl = document.getElementById('damageAssumptions');
    if (nsiMatch) {
      assumptionsEl.innerHTML =
        `Matched to a USACE National Structure Inventory record ${nsiMatch.distanceM.toFixed(0)}m away — ` +
        `using its real foundation height (${estimate.foundationHeightFt.toFixed(1)} ft) and replacement value ` +
        `(${fmt.format(estimate.replacementValueUSD)}). Damage % from HAZUS-MH-style depth-damage curves. ` +
        (flowState ? '' : 'Flow velocity unavailable — no simulation has run for this location.');
    } else {
      assumptionsEl.innerHTML =
        `No NSI building record within 50m — occupancy is inferred and values are placeholder ` +
        `estimates. Damage % uses HAZUS-MH-style depth-damage curves relative to an assumed ` +
        `first-floor elevation of ${estimate.foundationHeightFt.toFixed(1)} ft above grade, against a ` +
        `placeholder replacement value of ${fmt.format(estimate.replacementValueUSD)}. ` +
        (flowState ? '' : 'Flow velocity unavailable — no simulation has run for this location.');
    }
  }
}
