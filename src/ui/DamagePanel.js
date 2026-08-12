import { hazardFromFlow } from '../water/HazardRating.js';
import { getDamageEstimate } from '../data/DepthDamageCurves.js';

const M_TO_FT = 3.28084;

export class DamagePanel {
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.panel = document.getElementById('damagePanel');
    this.options = options;
    this._mitigationPanel = null;
    this._build();
  }

  _build() {
    this.panel.innerHTML = `
      <div class="info-title">
        <span>Damage Estimation Report</span>
        <button class="damage-close-btn" id="damageCloseBtn">&times;</button>
      </div>

      <div id="damagePromptMessage" style="display: none; padding: 20px 8px; text-align: center;">
        <div style="font-size: 0.9rem; color: var(--text-primary, #fff); font-weight: 500; margin-bottom: 8px;">Flood simulation complete</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary, #aaa); line-height: 1.5;">Click on any building to view its damage estimation report.</div>
      </div>

      <div id="damageNoDataMessage" style="display: none; padding: 20px 8px; text-align: center;">
        <div style="font-size: 1.6rem; margin-bottom: 12px;">📋</div>
        <div style="font-size: 0.9rem; color: var(--text-primary, #fff); font-weight: 500; margin-bottom: 8px;">Information Not Available</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary, #aaa); line-height: 1.5;">No building data was found in the National Structure Inventory for this location.</div>
        <div id="damageNoDataCoords" style="font-size: 0.72rem; color: var(--text-secondary, #777); margin-top: 12px; font-family: monospace;"></div>
      </div>

      <div id="damageContent">
        <div class="info-section">
          <h4 class="section-heading accordion-header" data-target="damageBuildingInfo">
            Building Information <span class="accordion-arrow">&#9654;</span>
          </h4>
          <div class="accordion-content" id="damageBuildingInfo">
            <div class="info-row"><span class="info-label">Occupancy Type:</span> <span class="info-value" id="damageOccupancyType">GOV1</span></div>
            <div class="info-row" id="damageSqftRow" style="display: none;"><span class="info-label">Square Footage:</span> <span class="info-value" id="damageSqft">—</span></div>
          </div>
        </div>

        <div class="info-section">
          <h4 class="section-heading accordion-header" data-target="damageFloodCond">
            Flood Conditions <span class="accordion-arrow">&#9654;</span>
          </h4>
          <div class="accordion-content" id="damageFloodCond">
            <div class="info-row"><span class="info-label">Flood Depth:</span> <span class="info-value" id="damageFloodDepth">—</span></div>
            <div class="info-row"><span class="info-label">Flow Velocity:</span> <span class="info-value" id="damageVelocity">—</span></div>
          </div>
        </div>

        <div class="info-section">
          <h4 class="section-heading accordion-header" data-target="damageSummaryPanel">
            Damage Summary <span class="accordion-arrow open">&#9654;</span>
          </h4>
          <div class="accordion-content open" id="damageSummaryPanel">
            <div class="info-row"><span class="info-label">Structural Loss:</span> <span class="info-value" id="damageStructuralLoss">—</span></div>
            <div class="info-row"><span class="info-label">Content Loss:</span> <span class="info-value" id="damageContentLoss">—</span></div>
            <div class="info-row" style="margin-top: 4px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 4px;">
              <span class="info-label" style="font-weight: 700;">Total Loss:</span>
              <span class="info-value" id="damageTotalLoss" style="font-weight: 700; color: #ff6b6b;">—</span>
            </div>
          </div>
        </div>

        <div class="info-section" style="margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; margin-bottom: 0px;">
          <div class="info-row" style="align-items: center; gap: 8px;">
            <span class="info-label" style="width: auto; flex: 1 1 auto;">Hazard Class:</span>
            <span class="info-value" id="damageSeverity" style="font-weight: 600; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; text-align: center; width: auto; white-space: nowrap; word-break: normal; flex: 0 0 auto;">—</span>
          </div>
          <div class="info-row" id="damageSeverityDesc" style="font-size: 0.72rem; color: var(--text-secondary, #999); margin-top: 4px;"></div>
        </div>

        <div class="info-section" id="damageAssumptions" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 0.68rem; color: var(--text-secondary, #888); line-height: 1.5;"></div>

        <button id="damageMitToggle" class="damage-mit-toggle">
          <span id="damageMitToggleText">Show Mitigation Analysis</span>
          <span class="damage-mit-toggle-arrow" id="damageMitToggleArrow">&#9654;</span>
        </button>
      </div>
    `;

    document.getElementById('damageCloseBtn').addEventListener('click', () => {
      this.hide();
      if (this._mitigationPanel) this._mitigationPanel.hide();
      this._updateMitToggle();
      if (this.options.onClose) this.options.onClose();
    });

    document.getElementById('damageMitToggle').addEventListener('click', () => {
      if (!this._mitigationPanel) return;
      if (this._mitigationPanel.isVisible()) {
        this._mitigationPanel.hide();
      } else {
        this._mitigationPanel.show();
      }
      this._updateMitToggle();
    });

    // Accordion functionality
    const headers = this.panel.querySelectorAll('.accordion-header');
    headers.forEach(header => {
      header.addEventListener('click', () => {
        const targetId = header.getAttribute('data-target');
        const content = document.getElementById(targetId);
        const arrow = header.querySelector('.accordion-arrow');
        
        if (content.classList.contains('open')) {
          content.classList.remove('open');
          arrow.classList.remove('open');
        } else {
          content.classList.add('open');
          arrow.classList.add('open');
        }
      });
    });
  }

  show() {
    this.panel.style.display = 'block';
  }

  hide() {
    this.panel.style.display = 'none';
  }

  setMitigationPanel(mp) {
    this._mitigationPanel = mp;
  }

  _updateMitToggle() {
    const text = document.getElementById('damageMitToggleText');
    const arrow = document.getElementById('damageMitToggleArrow');
    if (!text || !arrow) return;
    const visible = this._mitigationPanel && this._mitigationPanel.isVisible();
    text.textContent = visible ? 'Hide Mitigation Analysis' : 'Show Mitigation Analysis';
    arrow.innerHTML = visible ? '&#9664;' : '&#9654;';
  }

  showPrompt() {
    document.getElementById('damagePromptMessage').style.display = 'block';
    document.getElementById('damageNoDataMessage').style.display = 'none';
    document.getElementById('damageContent').style.display = 'none';
    this.show();
  }

  showNoData(lat, lng) {
    document.getElementById('damagePromptMessage').style.display = 'none';
    document.getElementById('damageNoDataMessage').style.display = 'block';
    document.getElementById('damageContent').style.display = 'none';
    document.getElementById('damageNoDataCoords').textContent =
      `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
    this.show();
  }



  /**
   * @param {number} lat
   * @param {number} lng
   * @param {number} depthFt
   * @param {Object|null} flowState
   * @param {Object|null} nsiMatch
   */
  setDamageInfo(lat, lng, depthFt, flowState = null, nsiMatch = null) {
    // Switch to full content mode
    document.getElementById('damagePromptMessage').style.display = 'none';
    document.getElementById('damageNoDataMessage').style.display = 'none';
    document.getElementById('damageContent').style.display = 'block';

    document.getElementById('damageFloodDepth').textContent = `${depthFt.toFixed(1)} ft`;

    const bId = Math.floor(Math.abs(lat * lng * 10000)) % 10000;

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

    // ─── Flow velocity ───
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

    // ─── Damage estimate ───
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

    const totalLoss = estimate.structuralUSD + estimate.contentUSD;
    document.getElementById('damageTotalLoss').textContent = fmt.format(totalLoss);

    // ─── Hazard classification ───
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
        `Matched to a USACE NSI record ${nsiMatch.distanceM.toFixed(0)}m away — ` +
        `foundation height: ${estimate.foundationHeightFt.toFixed(1)} ft, ` +
        `replacement value: ${fmt.format(estimate.replacementValueUSD)}. `;
    } else {
      assumptionsEl.innerHTML =
        `No NSI record within 50m — values are estimated. ` +
        `Foundation: ${estimate.foundationHeightFt.toFixed(1)} ft, ` +
        `replacement: ${fmt.format(estimate.replacementValueUSD)}. `;
    }
  }
}
