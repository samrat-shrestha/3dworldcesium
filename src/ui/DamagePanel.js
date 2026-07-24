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
      <div class="info-grid">
        <div class="info-item full-width">
          <span class="info-label">Address</span>
          <span class="info-value" id="damageAddress" style="font-size: 0.8rem; font-weight: 500;">Loading...</span>
        </div>
        <div class="info-item full-width">
          <span class="info-label">Coordinates</span>
          <span class="info-value" id="damageCoords" style="font-family: monospace; font-size: 0.75rem; color: var(--text-muted);">—</span>
        </div>
        
        <div class="info-item">
          <span class="info-label">Flood Depth</span>
          <span class="info-value accent" id="damageFloodDepth">—</span>
        </div>
        <div class="info-item">
          <span class="info-label">Flow Velocity</span>
          <span class="info-value" id="damageVelocity">—</span>
        </div>

        <div class="info-item full-width" style="margin-top: 12px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 6px;">
          <span class="info-label" style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 1px;">Estimated Financial Impact</span>
          <span class="info-value" id="damageCost" style="font-size: 1.5rem; color: #ff6b6b; margin-top: 4px;">—</span>
        </div>

        <div class="info-item full-width" style="margin-top: 8px;">
          <span class="info-label">Safety Status</span>
          <span class="info-value" id="damageSeverity" style="font-size: 0.9rem; font-weight: 600; padding: 4px 8px; border-radius: 4px; display: inline-block; margin-top: 4px;">—</span>
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
    document.getElementById('damageAddress').innerHTML = '<span style="color:var(--text-muted)">Fetching...</span>';
  }

  setDamageInfo(lat, lng, depthFt) {
    document.getElementById('damageCoords').textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
    document.getElementById('damageFloodDepth').textContent = `${depthFt.toFixed(1)} ft`;

    // Calculate mock velocity based on depth (just for visualization purposes for now)
    const velocity = depthFt > 0.1 ? (Math.random() * 0.8 + 0.4).toFixed(1) : '0.0';
    document.getElementById('damageVelocity').textContent = `${velocity} ft/s`;

    // Calculate estimated financial impact
    let cost = 0;
    if (depthFt > 0) {
      // Baseline $10,000 + $1,500 per inch of water
      const inches = depthFt * 12;
      cost = 10000 + (inches * 1500);
    }
    
    const costFormatted = cost > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cost) : '$0';
    document.getElementById('damageCost').textContent = costFormatted;

    // Determine safety status
    const severityEl = document.getElementById('damageSeverity');
    severityEl.className = 'info-value'; // reset

    if (depthFt <= 0.1) {
      severityEl.textContent = "Safe (Monitor Alerts)";
      severityEl.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
      severityEl.style.color = '#81c784';
      severityEl.style.border = '1px solid rgba(76, 175, 80, 0.3)';
    } else if (depthFt <= 1.5) {
      severityEl.textContent = "Minor Hazard (Impassable)";
      severityEl.style.backgroundColor = 'rgba(255, 193, 7, 0.2)';
      severityEl.style.color = '#ffd54f';
      severityEl.style.border = '1px solid rgba(255, 193, 7, 0.3)';
    } else if (depthFt <= 4.0) {
      severityEl.textContent = "Evacuation Recommended";
      severityEl.style.backgroundColor = 'rgba(255, 152, 0, 0.2)';
      severityEl.style.color = '#ffb74d';
      severityEl.style.border = '1px solid rgba(255, 152, 0, 0.3)';
    } else {
      severityEl.textContent = "Critical Danger (Seek Shelter)";
      severityEl.style.backgroundColor = 'rgba(244, 67, 54, 0.2)';
      severityEl.style.color = '#e57373';
      severityEl.style.border = '1px solid rgba(244, 67, 54, 0.3)';
    }
  }
}
