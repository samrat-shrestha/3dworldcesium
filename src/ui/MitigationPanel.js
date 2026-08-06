import { getApplicableMitigations } from '../data/MitigationService.js';
import { getDamageEstimate } from '../data/DepthDamageCurves.js';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * MitigationPanel — standalone left-side panel that shows mitigation options
 * and before/after cost-benefit analysis for a selected building.
 */
export class MitigationPanel {
  constructor(options = {}) {
    this.panel = document.getElementById('mitigationPanel');
    this.options = options;
    this._activeMid = null;
    this._build();
  }

  _build() {
    this.panel.innerHTML = `
      <div class="mitigation-header">
        <div>
          <div class="mitigation-header-title">Mitigation Analysis</div>
          <div class="mitigation-header-sub">Select a protection measure</div>
        </div>
        <button class="mitigation-close-btn" id="mitigationCloseBtn">&times;</button>
      </div>

      <div id="mitigationPrompt" class="mitigation-prompt">
        <div class="mitigation-prompt-icon">📊</div>
        <div class="mitigation-prompt-text">Click on a building with flood damage to see available mitigation options and cost-benefit analysis.</div>
      </div>

      <div id="mitigationBody" style="display: none;">
        <div id="mitigationBuildingInfo" class="mitigation-building-info"></div>
        <div id="mitigationOptionsList" class="mitigation-options-list"></div>
        <div id="mitigationImpact" class="mitigation-impact" style="display: none;"></div>
      </div>
    `;

    document.getElementById('mitigationCloseBtn').addEventListener('click', () => {
      this.hide();
      if (this.options.onClose) this.options.onClose();
    });
  }

  show() {
    this.panel.style.display = 'block';
  }

  hide() {
    this.panel.style.display = 'none';
    this._activeMid = null;
  }

  showPrompt() {
    document.getElementById('mitigationPrompt').style.display = 'block';
    document.getElementById('mitigationBody').style.display = 'none';
    this.show();
  }

  /**
   * Populate the panel with mitigation options for a building.
   * @param {number} depthFt
   * @param {Object} nsiMatch
   * @param {number} lat
   * @param {number} lng
   */
  setBuilding(depthFt, nsiMatch, lat, lng) {
    if (!nsiMatch) {
      this.showPrompt();
      return;
    }

    document.getElementById('mitigationPrompt').style.display = 'none';
    document.getElementById('mitigationBody').style.display = 'block';
    document.getElementById('mitigationImpact').style.display = 'none';
    this._activeMid = null;

    // Building info header
    const infoEl = document.getElementById('mitigationBuildingInfo');
    const totalDamage = this._getBaselineDamage(depthFt, nsiMatch);
    infoEl.innerHTML = `
      <div class="mit-building-row">
        <span class="mit-building-label">Building</span>
        <span class="mit-building-value">${nsiMatch.occupancy} · ${(nsiMatch.sqft || 0).toLocaleString()} sqft</span>
      </div>
      <div class="mit-building-row">
        <span class="mit-building-label">Current Damage</span>
        <span class="mit-building-value mit-damage-value">${fmt.format(totalDamage)}</span>
      </div>
    `;

    // Options list
    const listEl = document.getElementById('mitigationOptionsList');
    listEl.innerHTML = '';

    const mitigations = getApplicableMitigations(depthFt, nsiMatch, getDamageEstimate);
    if (mitigations.length === 0) {
      listEl.innerHTML = '<div class="mitigation-empty">No applicable mitigations for current conditions.</div>';
      return;
    }

    // Show top 2 per type, max 6
    const shown = new Map();
    const filtered = mitigations.filter(m => {
      const count = shown.get(m.mid) || 0;
      if (count >= 2) return false;
      shown.set(m.mid, count + 1);
      return true;
    }).slice(0, 6);

    for (const m of filtered) {
      const card = this._createOptionCard(m, depthFt, nsiMatch);
      listEl.appendChild(card);
    }
  }

  _getBaselineDamage(depthFt, nsiMatch) {
    const estimate = getDamageEstimate(nsiMatch.occupancy, depthFt, {
      foundationHeightFt: nsiMatch.foundationHeightFt ?? 0,
      replacementValueUSD: nsiMatch.structuralValueUSD ?? 200000,
      contentValueUSD: nsiMatch.contentValueUSD ?? 100000,
    });
    return estimate.structuralUSD + estimate.contentUSD;
  }

  _createOptionCard(m, depthFt, nsiMatch) {
    const card = document.createElement('div');
    card.className = 'mit-option-card';
    card.dataset.mid = m.mid;
    card.dataset.designFt = m.designFt;

    // Effectiveness bar (what % of damage is avoided)
    const effectiveness = m.baselineLoss > 0 ? (m.avoidedLoss / m.baselineLoss * 100) : 0;
    const bcrClass = m.bcr >= 1 ? 'mit-bcr-good' : m.bcr >= 0.5 ? 'mit-bcr-ok' : 'mit-bcr-poor';

    // Color coding by mitigation type
    const typeColors = {
      1: { bg: '#d4a574', accent: '#c4884a' },   // Elevate - warm brown
      11: { bg: '#c4a55a', accent: '#b8943f' },   // Sandbags - sandy
      12: { bg: '#8899aa', accent: '#6b7d8f' },   // Floodwall - steel
    };
    const colors = typeColors[m.mid] || { bg: '#5b9bd5', accent: '#4a88c2' };

    card.innerHTML = `
      <div class="mit-card-header">
        <div class="mit-card-type" style="background: ${colors.bg}22; color: ${colors.bg}; border-color: ${colors.bg}44;">
          ${m.icon} ${m.label}
        </div>
        <div class="mit-card-bcr ${bcrClass}">
          ${m.bcr >= 1 ? '✓' : ''} BCR ${m.bcr.toFixed(1)}x
        </div>
      </div>

      <div class="mit-card-effectiveness">
        <div class="mit-eff-bar-track">
          <div class="mit-eff-bar-fill" style="width: ${Math.min(effectiveness, 100)}%; background: ${colors.bg};"></div>
        </div>
        <span class="mit-eff-label">${effectiveness.toFixed(0)}% damage reduction</span>
      </div>

      <div class="mit-card-costs">
        <div class="mit-cost-item">
          <span class="mit-cost-label">Cost</span>
          <span class="mit-cost-value">${fmt.format(m.totalCost)}</span>
        </div>
        <div class="mit-cost-item">
          <span class="mit-cost-label">Saves</span>
          <span class="mit-cost-value mit-saves">${fmt.format(m.avoidedLoss)}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      // Deselect all
      const all = document.querySelectorAll('.mit-option-card');
      all.forEach(c => c.classList.remove('mit-selected'));

      // Select this
      card.classList.add('mit-selected');
      this._activeMid = m.mid;

      // Show impact detail
      this._showImpact(m, colors);

      // Fire callback for 3D visual
      if (this.options.onMitigationSelect) {
        this.options.onMitigationSelect(m);
      }
    });

    return card;
  }

  _showImpact(m, colors) {
    const el = document.getElementById('mitigationImpact');
    el.style.display = 'block';

    const effectiveness = m.baselineLoss > 0 ? (m.avoidedLoss / m.baselineLoss * 100) : 0;

    el.innerHTML = `
      <div class="mit-impact-header">
        <span class="mit-impact-title">Impact Analysis</span>
        <button class="mit-remove-btn" id="mitigationRemoveBtn">✕ Remove</button>
      </div>

      <div class="mit-impact-comparison">
        <div class="mit-compare-col mit-compare-before">
          <div class="mit-compare-label">Without</div>
          <div class="mit-compare-amount">${fmt.format(m.baselineLoss)}</div>
          <div class="mit-compare-bar">
            <div class="mit-compare-bar-fill" style="width: 100%; background: #ff6b6b;"></div>
          </div>
        </div>
        <div class="mit-compare-arrow">→</div>
        <div class="mit-compare-col mit-compare-after">
          <div class="mit-compare-label">With ${m.label}</div>
          <div class="mit-compare-amount">${fmt.format(m.mitigatedLoss)}</div>
          <div class="mit-compare-bar">
            <div class="mit-compare-bar-fill" style="width: ${m.baselineLoss > 0 ? (m.mitigatedLoss / m.baselineLoss * 100) : 0}%; background: #5cb85c;"></div>
          </div>
        </div>
      </div>

      <div class="mit-impact-stats">
        <div class="mit-stat">
          <span class="mit-stat-label">Damage Avoided</span>
          <span class="mit-stat-value" style="color: #5cb85c;">${fmt.format(m.avoidedLoss)} (${effectiveness.toFixed(0)}%)</span>
        </div>
        <div class="mit-stat">
          <span class="mit-stat-label">Mitigation Cost</span>
          <span class="mit-stat-value">${fmt.format(m.totalCost)}</span>
        </div>
        <div class="mit-stat">
          <span class="mit-stat-label">Benefit-Cost Ratio</span>
          <span class="mit-stat-value ${m.bcr >= 1 ? 'mit-bcr-good' : m.bcr >= 0.5 ? 'mit-bcr-ok' : 'mit-bcr-poor'}">${m.bcr.toFixed(2)}x</span>
        </div>
        ${m.lifeSpan ? `<div class="mit-stat">
          <span class="mit-stat-label">Life Span</span>
          <span class="mit-stat-value">${m.lifeSpan} years</span>
        </div>` : ''}
      </div>
    `;

    document.getElementById('mitigationRemoveBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      el.style.display = 'none';
      this._activeMid = null;
      document.querySelectorAll('.mit-option-card').forEach(c => c.classList.remove('mit-selected'));
      if (this.options.onMitigationClear) this.options.onMitigationClear();
    });
  }

  clear() {
    this._activeMid = null;
    const impact = document.getElementById('mitigationImpact');
    if (impact) impact.style.display = 'none';
    document.querySelectorAll('.mit-option-card').forEach(c => c.classList.remove('mit-selected'));
  }
}
