import { getApplicableMitigations } from '../data/MitigationService.js';
import { getDamageEstimate } from '../data/DepthDamageCurves.js';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * MitigationPanel — form-based mitigation estimator.
 * User selects a mitigation type + design level, clicks "Estimate",
 * and gets a detailed cost-benefit report.
 */
export class MitigationPanel {
  constructor(options = {}) {
    this.panel = document.getElementById('mitigationPanel');
    this.options = options;
    this._mitigations = [];  // current applicable mitigations
    this._selectedMitigation = null;
    this._build();
  }

  _build() {
    this.panel.innerHTML = `
      <div class="info-title">
        <span>Mitigation Analysis</span>
        <button class="damage-close-btn" id="mitigationCloseBtn">&times;</button>
      </div>

      <div id="mitigationPrompt" class="mitigation-prompt">
        <div class="mitigation-prompt-text">Click on a flooded building to analyze mitigation options.</div>
      </div>

      <div id="mitigationBody" style="display: none;">
        <!-- Selector Form -->
        <div class="mit-form">
          <div class="mit-form-group">
            <label class="mit-form-label">Mitigation Type</label>
            <select id="mitTypeSelect" class="mit-select">
              <option value="">— Select type —</option>
            </select>
          </div>
          <div class="mit-form-group">
            <label class="mit-form-label">Design Level</label>
            <div class="mit-design-row">
              <select id="mitDesignSelect" class="mit-select" disabled>
                <option value="">— Select design —</option>
              </select>
              <button id="mitEstimateBtn" class="mit-estimate-btn" disabled>
                Estimate
              </button>
            </div>
          </div>
        </div>

        <!-- Report (hidden until estimated) -->
        <div id="mitigationReport" style="display: none;"></div>
      </div>
    `;

    // Close button
    document.getElementById('mitigationCloseBtn').addEventListener('click', () => {
      this.hide();
      if (this.options.onClose) this.options.onClose();
    });

    // Type selector change
    document.getElementById('mitTypeSelect').addEventListener('change', () => {
      this._onTypeChange();
    });

    // Design selector change
    document.getElementById('mitDesignSelect').addEventListener('change', () => {
      const btn = document.getElementById('mitEstimateBtn');
      btn.disabled = !document.getElementById('mitDesignSelect').value;
    });

    // Estimate button
    document.getElementById('mitEstimateBtn').addEventListener('click', () => {
      this._generateReport();
    });
  }

  show() {
    this._visible = true;
    this.panel.style.display = 'block'; // Ensure it's block for the transition
    // small delay to allow display:block to apply before adding class for transition
    requestAnimationFrame(() => {
      this.panel.classList.add('mit-panel-visible');
    });
  }

  hide() {
    this._visible = false;
    this.panel.classList.remove('mit-panel-visible');
    // Wait for transition to finish before display none
    setTimeout(() => {
      if (!this.isVisible()) this.panel.style.display = 'none';
    }, 300);
    this._selectedMitigation = null;
  }

  isVisible() { return this._visible; }

  showPrompt() {
    document.getElementById('mitigationPrompt').style.display = 'block';
    document.getElementById('mitigationBody').style.display = 'none';
    this.show();
  }

  /**
   * Populate the panel for a clicked building.
   */
  setBuilding(depthFt, nsiMatch, lat, lng) {
    if (!nsiMatch) {
      this.showPrompt();
      return;
    }

    document.getElementById('mitigationPrompt').style.display = 'none';
    document.getElementById('mitigationBody').style.display = 'block';
    document.getElementById('mitigationReport').style.display = 'none';
    this._selectedMitigation = null;

    // Get all applicable mitigations
    this._mitigations = getApplicableMitigations(depthFt, nsiMatch, getDamageEstimate);
    this._depthFt = depthFt;
    this._nsiMatch = nsiMatch;

    // Populate type dropdown with unique mitigation types
    const typeSelect = document.getElementById('mitTypeSelect');
    const designSelect = document.getElementById('mitDesignSelect');
    const estimateBtn = document.getElementById('mitEstimateBtn');

    typeSelect.innerHTML = '<option value="">— Select type —</option>';
    designSelect.innerHTML = '<option value="">— Select design —</option>';
    designSelect.disabled = true;
    estimateBtn.disabled = true;

    // Group by mid to get unique types
    const types = new Map();
    for (const m of this._mitigations) {
      if (!types.has(m.mid)) {
        types.set(m.mid, { mid: m.mid, label: m.measure });
      }
    }

    for (const t of types.values()) {
      const opt = document.createElement('option');
      opt.value = t.mid;
      opt.textContent = t.label;
      typeSelect.appendChild(opt);
    }

    if (types.size === 0) {
      typeSelect.innerHTML = '<option value="">No mitigations available</option>';
    }
  }

  _onTypeChange() {
    const typeSelect = document.getElementById('mitTypeSelect');
    const designSelect = document.getElementById('mitDesignSelect');
    const estimateBtn = document.getElementById('mitEstimateBtn');
    const report = document.getElementById('mitigationReport');

    const selectedMid = parseInt(typeSelect.value);
    report.style.display = 'none';
    this._selectedMitigation = null;

    if (!selectedMid) {
      designSelect.innerHTML = '<option value="">— Select design —</option>';
      designSelect.disabled = true;
      estimateBtn.disabled = true;
      return;
    }

    // Get available design levels for this type
    const options = this._mitigations.filter(m => m.mid === selectedMid)
      .sort((a, b) => a.designFt - b.designFt);
    designSelect.innerHTML = '<option value="">— Select level —</option>';

    for (const m of options) {
      const opt = document.createElement('option');
      opt.value = m.designFt;
      opt.textContent = `${m.designFt} ft`;
      designSelect.appendChild(opt);
    }

    designSelect.disabled = false;
    estimateBtn.disabled = true;
  }

  _generateReport() {
    const mid = parseInt(document.getElementById('mitTypeSelect').value);
    const designFt = parseFloat(document.getElementById('mitDesignSelect').value);

    if (!mid || !designFt) return;

    const m = this._mitigations.find(x => x.mid === mid && x.designFt === designFt);
    if (!m) return;

    this._selectedMitigation = m;
    const effectiveness = m.baselineLoss > 0 ? (m.avoidedLoss / m.baselineLoss * 100) : 0;
    const bcrClass = m.bcr >= 1 ? 'mit-bcr-good' : m.bcr >= 0.5 ? 'mit-bcr-ok' : 'mit-bcr-poor';

    const report = document.getElementById('mitigationReport');
    report.style.display = 'block';
    report.innerHTML = `
      <div class="mit-report">
        <!-- Before / After Comparison (Accordion) -->
        <h4 class="section-heading accordion-header" data-target="mitComparison" style="margin-top: 16px;">
          Impact Comparison <span class="accordion-arrow open"></span>
        </h4>
        <div class="accordion-content open" id="mitComparison">
          <div class="mit-comparison" style="margin-top: 4px;">
            <div class="mit-compare-side mit-compare-before">
              <div class="mit-compare-heading">Without Mitigation</div>
              <div class="mit-compare-amount">${fmt.format(m.baselineLoss)}</div>
              <div class="mit-compare-bar-track">
                <div class="mit-compare-bar-fill" style="width: 100%; background: #ff6b6b;"></div>
              </div>
            </div>
            <div class="mit-compare-divider">→</div>
            <div class="mit-compare-side mit-compare-after">
              <div class="mit-compare-heading">With Mitigation</div>
              <div class="mit-compare-amount" style="color: var(--text-primary, #ddd);">${fmt.format(m.mitigatedLoss)}</div>
              <div class="mit-compare-bar-track">
                <div class="mit-compare-bar-fill" style="width: ${m.baselineLoss > 0 ? (m.mitigatedLoss / m.baselineLoss * 100) : 0}%; background: #63b3ed;"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Stats (Accordion) -->
        <h4 class="section-heading accordion-header" data-target="mitStats" style="margin-top: 16px;">
          Financial Breakdown <span class="accordion-arrow"></span>
        </h4>
        <div class="accordion-content" id="mitStats">
          <div class="mit-report-stats" style="margin-top: 4px;">
            <div class="mit-stat-row">
              <span class="mit-stat-label">Mitigation Cost</span>
              <span class="mit-stat-value">${fmt.format(m.totalCost)}</span>
            </div>
            <div class="mit-stat-row">
              <span class="mit-stat-label">Damage Avoided</span>
              <span class="mit-stat-value" style="color: #5cb85c;">${fmt.format(m.avoidedLoss)}</span>
            </div>
            <div class="mit-stat-row">
              <span class="mit-stat-label">Damage Reduction</span>
              <span class="mit-stat-value" style="color: #5cb85c;">${effectiveness.toFixed(0)}%</span>
            </div>
            <div class="mit-stat-row mit-stat-highlight">
              <span class="mit-stat-label">Benefit-Cost Ratio</span>
              <span class="mit-stat-value ${bcrClass}">${m.bcr.toFixed(2)}x</span>
            </div>
            ${m.lifeSpan ? `
            <div class="mit-stat-row">
              <span class="mit-stat-label">Life Span</span>
              <span class="mit-stat-value">${m.lifeSpan} years</span>
            </div>
            ` : ''}
          </div>
        </div>

        <!-- Loss Breakdown (Accordion) -->
        <h4 class="section-heading accordion-header" data-target="mitLossBreakdown" style="margin-top: 16px;">
          Loss Breakdown <span class="accordion-arrow"></span>
        </h4>
        <div class="accordion-content" id="mitLossBreakdown">
          <div class="mit-breakdown" style="margin-top: 4px;">
            <div class="mit-breakdown-grid">
              <div class="mit-breakdown-cell"></div>
              <div class="mit-breakdown-cell mit-breakdown-head">Before</div>
              <div class="mit-breakdown-cell mit-breakdown-head">After</div>

              <div class="mit-breakdown-cell mit-breakdown-label">Structural</div>
              <div class="mit-breakdown-cell">${fmt.format(m.structuralLossBefore)}</div>
              <div class="mit-breakdown-cell">${fmt.format(m.structuralLossAfter)}</div>

              <div class="mit-breakdown-cell mit-breakdown-label">Content</div>
              <div class="mit-breakdown-cell">${fmt.format(m.contentLossBefore)}</div>
              <div class="mit-breakdown-cell">${fmt.format(m.contentLossAfter)}</div>

              <div class="mit-breakdown-cell mit-breakdown-label" style="font-weight: 700;">Total</div>
              <div class="mit-breakdown-cell" style="font-weight: 700;">${fmt.format(m.baselineLoss)}</div>
              <div class="mit-breakdown-cell" style="font-weight: 700;">${fmt.format(m.mitigatedLoss)}</div>
            </div>
          </div>
        </div>

        ${m.restrictions ? `
        <div class="mit-restrictions" style="margin-top: 16px;">
          <div class="mit-restrictions-label">⚠ Restrictions</div>
          <div class="mit-restrictions-text">${m.restrictions}</div>
        </div>` : ''}
      </div>
    `;

    // Add accordion click listeners for the dynamically generated report
    const headers = report.querySelectorAll('.accordion-header');
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

    // Fire callback (no 3D rendering anymore, just report)
    if (this.options.onMitigationSelect) {
      this.options.onMitigationSelect(m);
    }
  }

  clear() {
    this._selectedMitigation = null;
    const report = document.getElementById('mitigationReport');
    if (report) report.style.display = 'none';
  }
}
