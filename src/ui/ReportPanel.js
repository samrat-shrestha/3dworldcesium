import * as Cesium from 'cesium';
import { hazardFromFlow } from '../water/HazardRating.js';
import { getDamageEstimate } from '../data/DepthDamageCurves.js';
import { getApplicableMitigations } from '../data/MitigationService.js';

const M_TO_FT = 3.28084;
const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * ReportPanel — Unified Tabbed Panel for:
 * 1. Simulation Data (live telemetry & camera tracking)
 * 2. Damage Estimation Report (building loss & hazard rating)
 * 3. Mitigation Analysis (cost-benefit & loss reduction)
 */
export class ReportPanel {
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.options = options;
    this.panel = document.getElementById('reportPanel');

    this._activeTab = 'simulation'; // 'simulation' | 'damage' | 'mitigation'
    this._hasBuildingData = false;
    this._mitigations = [];
    this._selectedMitigation = null;

    this._build();
    this._startCameraTracking();
  }

  _build() {
    this.panel.innerHTML = `
      <!-- Header with Title and Tabs -->
      <div class="report-header">
        <div class="report-title-row">
          <div class="report-main-title">
              <span>Analysis & Reports</span>
          </div>
          <button class="report-close-btn" id="reportCloseBtn" title="Close Panel">&times;</button>
        </div>

        <nav class="report-tabs">
          <button class="report-tab-btn active" data-tab="simulation" id="tabBtnSimulation">
            <span class="report-tab-text">Simulation</span>
          </button>
          <button class="report-tab-btn" data-tab="damage" id="tabBtnDamage">
            <span class="report-tab-text">Damage</span>
          </button>
          <button class="report-tab-btn" data-tab="mitigation" id="tabBtnMitigation">
            <span class="report-tab-text">Mitigation</span>
          </button>
        </nav>
      </div>

      <div class="report-body">
        <!-- ========================================================
             TAB 1: SIMULATION DATA
             ======================================================== -->
        <div class="report-tab-pane active" id="tabPaneSimulation">
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">Ground Elev.</span>
              <span class="info-value" id="infoGroundElev">—</span>
            </div>
            <div class="info-item">
              <span class="info-label">Water Level</span>
              <span class="info-value accent" id="infoWaterLevel">0.0 ft</span>
            </div>
            <div class="info-item">
              <span class="info-label">Flood Area</span>
              <span class="info-value" id="infoFloodArea">0.0 sq mi</span>
            </div>
            <div class="info-item full-width">
              <span class="info-label">Water Origin</span>
              <span class="info-value" id="infoOrigin" style="font-size: 0.7rem;">Click map to set</span>
            </div>
            <div class="info-item full-width">
              <span class="info-label">Location</span>
              <span class="info-value" id="infoLocation">French Quarter</span>
            </div>
            <div class="info-item full-width">
              <span class="info-label">Camera</span>
              <span class="info-value" id="infoCameraPos" style="font-size: 0.7rem;">—</span>
            </div>
          </div>
        </div>

        <!-- ========================================================
             TAB 2: DAMAGE ESTIMATION REPORT
             ======================================================== -->
        <div class="report-tab-pane" id="tabPaneDamage">
          <!-- Prompt when no building selected -->
          <div id="damagePromptMessage" class="report-empty-prompt">
            <div class="report-prompt-title">Building Damage Inspection</div>
            <div class="report-prompt-desc">Click on any building within the flooded area on the 3D map to inspect its depth-damage estimate and hazard classification.</div>
          </div>

          <!-- Message when no NSI data exists for selected point -->
          <div id="damageNoDataMessage" class="report-empty-prompt" style="display: none;">
            <div class="report-prompt-title">Information Not Available</div>
            <div class="report-prompt-desc">No building data was found in the National Structure Inventory for this location.</div>
            <div id="damageNoDataCoords" class="report-prompt-coords"></div>
          </div>

          <!-- Full Damage Content -->
          <div id="damageContent" style="display: none;">
            <div class="info-section">
              <h4 class="section-heading accordion-header" data-target="damageBuildingInfo">
                Building Information <span class="accordion-arrow"></span>
              </h4>
              <div class="accordion-content" id="damageBuildingInfo">
                <div class="info-row"><span class="info-label">Occupancy Type:</span> <span class="info-value" id="damageOccupancyType">GOV1</span></div>
                <div class="info-row" id="damageSqftRow" style="display: none;"><span class="info-label">Square Footage:</span> <span class="info-value" id="damageSqft">—</span></div>
              </div>
            </div>

            <div class="info-section">
              <h4 class="section-heading accordion-header" data-target="damageFloodCond">
                Flood Conditions <span class="accordion-arrow"></span>
              </h4>
              <div class="accordion-content" id="damageFloodCond">
                <div class="info-row"><span class="info-label">Flood Depth:</span> <span class="info-value" id="damageFloodDepth">—</span></div>
                <div class="info-row"><span class="info-label">Flow Velocity:</span> <span class="info-value" id="damageVelocity">—</span></div>
              </div>
            </div>

            <div class="info-section">
              <h4 class="section-heading accordion-header" data-target="damageSummaryPanel">
                Damage Summary <span class="accordion-arrow open"></span>
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
          </div>
        </div>

        <!-- ========================================================
             TAB 3: MITIGATION ANALYSIS
             ======================================================== -->
        <div class="report-tab-pane" id="tabPaneMitigation">
          <!-- Prompt when no building selected -->
          <div id="mitigationPrompt" class="report-empty-prompt">
            <div class="report-prompt-title">Mitigation Analysis</div>
            <div class="report-prompt-desc">Click on a flooded building on the map to evaluate structural mitigation options, avoided losses, and Benefit-Cost Ratios (BCR).</div>
          </div>

          <!-- Mitigation Form & Report -->
          <div id="mitigationBody" style="display: none;">
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
        </div>
      </div>
    `;

    // ─── Setup Tab Navigation ────────────────────────────────
    const tabButtons = this.panel.querySelectorAll('.report-tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        this.setActiveTab(tab);
      });
    });

    // Close button
    document.getElementById('reportCloseBtn').addEventListener('click', () => {
      this.hide();
      if (this.options.onClose) this.options.onClose();
    });

    // Mitigation Type change
    document.getElementById('mitTypeSelect').addEventListener('change', () => {
      this._onMitTypeChange();
    });

    // Mitigation Design change
    document.getElementById('mitDesignSelect').addEventListener('change', () => {
      const btn = document.getElementById('mitEstimateBtn');
      btn.disabled = !document.getElementById('mitDesignSelect').value;
    });

    // Mitigation Estimate button
    document.getElementById('mitEstimateBtn').addEventListener('click', () => {
      this._generateMitigationReport();
    });

    // Setup accordion toggles for static damage elements
    this._bindAccordions(this.panel);
  }

  _bindAccordions(container) {
    const headers = container.querySelectorAll('.accordion-header');
    headers.forEach(header => {
      // Remove any existing click listener by cloning or flag
      if (header._accordionBound) return;
      header._accordionBound = true;

      header.addEventListener('click', () => {
        const targetId = header.getAttribute('data-target');
        const content = document.getElementById(targetId);
        const arrow = header.querySelector('.accordion-arrow');
        if (!content) return;

        if (content.classList.contains('open')) {
          content.classList.remove('open');
          if (arrow) arrow.classList.remove('open');
        } else {
          content.classList.add('open');
          if (arrow) arrow.classList.add('open');
        }
      });
    });
  }

  // ─── Tab Management ─────────────────────────────────────────
  setActiveTab(tabName) {
    this._activeTab = tabName;
    const tabButtons = this.panel.querySelectorAll('.report-tab-btn');
    const panes = this.panel.querySelectorAll('.report-tab-pane');

    tabButtons.forEach(btn => {
      if (btn.getAttribute('data-tab') === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    panes.forEach(pane => {
      if (pane.id === `tabPane${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });
  }

  show() {
    this.panel.style.display = 'block';
  }

  hide() {
    this.panel.style.display = 'none';
  }

  isVisible() {
    return this.panel.style.display !== 'none';
  }

  // ─── Telemetry / Simulation Tab ─────────────────────────────
  _startCameraTracking() {
    this._cameraInterval = setInterval(() => {
      try {
        const c = Cesium.Cartographic.fromCartesian(this.viewer.camera.position);
        if (c) {
          const el = document.getElementById('infoCameraPos');
          if (el) {
            el.textContent = `${Cesium.Math.toDegrees(c.latitude).toFixed(4)}°, ${Cesium.Math.toDegrees(c.longitude).toFixed(4)}° · ${c.height.toFixed(0)}m`;
          }
        }
      } catch { }
    }, 500);
  }

  setWaterLevel(level) {
    const el = document.getElementById('infoWaterLevel');
    const levelFt = level / 0.3048;
    if (el) el.textContent = `${levelFt.toFixed(1)} ft`;
  }

  setGroundElevation(elevation) {
    const el = document.getElementById('infoGroundElev');
    const elevFt = elevation !== null ? elevation / 0.3048 : null;
    if (el) el.textContent = elevFt !== null ? `${elevFt.toFixed(1)} ft` : '—';
  }

  setWaterSurface(elevation) {
    // Water surface MSL indicator if needed
  }

  setFloodArea(area) {
    const el = document.getElementById('infoFloodArea');
    const areaSqMiles = area * 0.386102;
    if (el) el.textContent = `${areaSqMiles.toFixed(1)} sq mi`;
  }

  setLocation(name) {
    const el = document.getElementById('infoLocation');
    if (el) el.textContent = name;
  }

  setOrigin(origin) {
    const el = document.getElementById('infoOrigin');
    if (el) {
      if (origin) {
        const elevFt = origin.elevation / 0.3048;
        el.textContent = `${origin.lat.toFixed(5)}°, ${origin.lng.toFixed(5)}° · ${elevFt.toFixed(1)}ft`;
      } else {
        el.textContent = 'Click map to set';
      }
    }
  }

  // ─── Damage Tab ─────────────────────────────────────────────
  showDamagePrompt() {
    document.getElementById('damagePromptMessage').style.display = 'block';
    document.getElementById('damageNoDataMessage').style.display = 'none';
    document.getElementById('damageContent').style.display = 'none';
    this.show();
  }

  showDamageNoData(lat, lng) {
    document.getElementById('damagePromptMessage').style.display = 'none';
    document.getElementById('damageNoDataMessage').style.display = 'block';
    document.getElementById('damageContent').style.display = 'none';
    document.getElementById('damageNoDataCoords').textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
    this.setActiveTab('damage');
    this.show();
  }

  setDamageInfo(lat, lng, depthFt, flowState = null, nsiMatch = null) {
    this._hasBuildingData = true;
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

    // Velocity
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

    // Damage estimate
    const estimateOpts = {};
    if (nsiMatch) {
      if (nsiMatch.foundationHeightFt != null) estimateOpts.foundationHeightFt = nsiMatch.foundationHeightFt;
      if (nsiMatch.structuralValueUSD != null) estimateOpts.replacementValueUSD = nsiMatch.structuralValueUSD;
      if (nsiMatch.contentValueUSD != null) estimateOpts.contentValueUSD = nsiMatch.contentValueUSD;
    }
    const estimate = getDamageEstimate(occupancy, depthFt, estimateOpts);

    document.getElementById('damageStructuralLoss').textContent = depthFt > 0
      ? `${fmt.format(estimate.structuralUSD)} (${estimate.structuralPercent.toFixed(0)}%)`
      : fmt.format(0);
    document.getElementById('damageContentLoss').textContent = depthFt > 0
      ? `${fmt.format(estimate.contentUSD)} (${estimate.contentPercent.toFixed(0)}%)`
      : fmt.format(0);

    const totalLoss = estimate.structuralUSD + estimate.contentUSD;
    document.getElementById('damageTotalLoss').textContent = fmt.format(totalLoss);

    // Hazard classification
    const hazard = hazardFromFlow(depthFt / M_TO_FT, flowState);
    const severityEl = document.getElementById('damageSeverity');
    const descEl = document.getElementById('damageSeverityDesc');

    severityEl.textContent = `${hazard.code} — ${hazard.label}`;
    severityEl.style.backgroundColor = hazard.color;
    severityEl.style.color = '#fff';
    severityEl.style.border = `1px solid ${hazard.color}`;
    severityEl.style.textShadow = '0 1px 2px rgba(0,0,0,0.3)';
    descEl.textContent = hazard.description;
    descEl.style.color = 'var(--text-primary, #ccc)';

    // Assumptions footnote
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

    // Switch to damage tab & ensure panel is visible
    this.setActiveTab('damage');
    this.show();
  }

  // ─── Mitigation Tab ─────────────────────────────────────────
  showMitigationPrompt() {
    document.getElementById('mitigationPrompt').style.display = 'block';
    document.getElementById('mitigationBody').style.display = 'none';
  }

  setMitigationBuilding(depthFt, nsiMatch, lat, lng) {
    if (!nsiMatch) {
      this.showMitigationPrompt();
      return;
    }

    document.getElementById('mitigationPrompt').style.display = 'none';
    document.getElementById('mitigationBody').style.display = 'block';
    document.getElementById('mitigationReport').style.display = 'none';
    this._selectedMitigation = null;

    this._mitigations = getApplicableMitigations(depthFt, nsiMatch, getDamageEstimate);

    const typeSelect = document.getElementById('mitTypeSelect');
    const designSelect = document.getElementById('mitDesignSelect');
    const estimateBtn = document.getElementById('mitEstimateBtn');

    typeSelect.innerHTML = '<option value="">— Select type —</option>';
    designSelect.innerHTML = '<option value="">— Select design —</option>';
    designSelect.disabled = true;
    estimateBtn.disabled = true;

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

  _onMitTypeChange() {
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

  _generateMitigationReport() {
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
        <!-- Impact Comparison (Accordion) -->
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

    this._bindAccordions(report);
  }

  // ─── Reset / Clear ──────────────────────────────────────────
  clearBuilding() {
    this._hasBuildingData = false;
    this._selectedMitigation = null;
    this.showDamagePrompt();
    this.showMitigationPrompt();
    this.setActiveTab('simulation');
  }

  destroy() {
    if (this._cameraInterval) clearInterval(this._cameraInterval);
  }
}
