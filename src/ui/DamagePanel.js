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
        <div class="info-row"><span class="info-label">Address:</span> <span class="info-value" id="damageAddress">Loading...</span></div>
        <div class="info-row"><span class="info-label">Coordinates:</span> <span class="info-value" id="damageCoords" style="font-family: monospace; font-size: 0.75rem;">—</span></div>
      </div>

      <div class="info-section">
        <h4 class="section-heading">Damage Summary</h4>
        <div class="info-row"><span class="info-label">Flood Depth:</span> <span class="info-value" id="damageFloodDepth">—</span></div>
        <div class="info-row"><span class="info-label">Flow Velocity:</span> <span class="info-value" id="damageVelocity">—</span></div>
        <div class="info-row"><span class="info-label">Structural Loss:</span> <span class="info-value" id="damageStructuralLoss">—</span></div>
        <div class="info-row"><span class="info-label">Content Loss:</span> <span class="info-value" id="damageContentLoss">—</span></div>
      </div>

      <div class="info-section">
        <h4 class="section-heading">Projected Loss (2021-2050)</h4>
        <div class="info-row"><span class="info-label">Low Emission:</span> <span class="info-value" id="damageLowEmission">—</span></div>
        <div class="info-row"><span class="info-label">High Emission:</span> <span class="info-value" id="damageHighEmission">—</span></div>
      </div>

      <div class="info-section" style="margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; margin-bottom: 0px;">
        <div class="info-row" style="align-items: center;">
          <span class="info-label">Safety Status:</span> 
          <span class="info-value" id="damageSeverity" style="font-weight: 600; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem; text-align: center; width: auto; min-width: 120px;">—</span>
        </div>
      </div>
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

  setDamageInfo(lat, lng, depthFt) {
    document.getElementById('damageCoords').textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
    document.getElementById('damageFloodDepth').textContent = `${depthFt.toFixed(1)} ft`;

    // Mock Building ID and Type
    const bId = Math.floor(Math.abs(lat * lng * 10000)) % 10000;
    document.getElementById('damageBuildingId').textContent = bId;
    document.getElementById('damageOccupancyType').textContent = (bId % 3 === 0) ? 'RES1' : ((bId % 2 === 0) ? 'COM1' : 'GOV1');

    // Calculate mock velocity
    const velocity = depthFt > 0.1 ? (Math.random() * 0.8 + 0.4).toFixed(1) : '0.0';
    document.getElementById('damageVelocity').textContent = `${velocity} ft/s`;

    // Calculate losses
    let structural = 0;
    let content = 0;
    if (depthFt > 0) {
      const inches = depthFt * 12;
      structural = 10000 + (inches * 1500);
      content = 5000 + (inches * 800);
    }

    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

    document.getElementById('damageStructuralLoss').textContent = fmt.format(structural);
    document.getElementById('damageContentLoss').textContent = fmt.format(content);

    // Projections
    document.getElementById('damageLowEmission').textContent = fmt.format(structural * 2.5);
    document.getElementById('damageHighEmission').textContent = fmt.format(structural * 4.2);

    // Determine safety status
    const severityEl = document.getElementById('damageSeverity');
    severityEl.className = 'info-value'; // reset

    if (depthFt <= 0.1) {
      severityEl.textContent = "Safe (Monitor Alerts)";
      severityEl.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
      severityEl.style.color = '#81c784';
      severityEl.style.border = '1px solid rgba(76, 175, 80, 0.3)';
    } else if (depthFt <= 1.5) {
      severityEl.textContent = "Minor Hazard";
      severityEl.style.backgroundColor = 'rgba(255, 193, 7, 0.2)';
      severityEl.style.color = '#ffd54f';
      severityEl.style.border = '1px solid rgba(255, 193, 7, 0.3)';
    } else if (depthFt <= 4.0) {
      severityEl.textContent = "Evacuation Recommended";
      severityEl.style.backgroundColor = 'rgba(255, 152, 0, 0.2)';
      severityEl.style.color = '#ffb74d';
      severityEl.style.border = '1px solid rgba(255, 152, 0, 0.3)';
    } else {
      severityEl.textContent = "Critical Danger";
      severityEl.style.backgroundColor = 'rgba(244, 67, 54, 0.2)';
      severityEl.style.color = '#e57373';
      severityEl.style.border = '1px solid rgba(244, 67, 54, 0.3)';
    }
  }
}
