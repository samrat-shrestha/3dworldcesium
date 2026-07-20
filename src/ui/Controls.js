/**
 * New Orleans neighborhood/landmark locations.
 */
export const LOCATIONS = [
  { id: 'frenchquarter', name: 'French Quarter', lng: -90.0644, lat: 29.9584 },
  { id: 'tulane', name: 'Tulane University', lng: -90.1209, lat: 29.9401 },
  { id: 'downtown', name: 'Downtown / CBD', lng: -90.0715, lat: 29.9511 },
  { id: 'lower9th', name: 'Lower 9th Ward', lng: -89.9935, lat: 29.9649 },
  { id: 'levee_breach', name: 'Industrial Canal Breach', lng: -90.0267, lat: 29.9701 },
  { id: 'holy_cross', name: 'Holy Cross', lng: -90.0125, lat: 29.9570 },
  { id: 'fats_domino', name: 'Fats Domino House', lng: -90.0055, lat: 29.9631 },
  { id: 'garden', name: 'Garden District', lng: -90.0942, lat: 29.9282 },
  { id: 'lakeshore', name: 'Lake Pontchartrain Shore', lng: -90.0800, lat: 30.0250 },
  { id: 'canal', name: 'Canal Street', lng: -90.0690, lat: 29.9530 },
  { id: 'superdome', name: 'Superdome', lng: -90.0812, lat: 29.9511 },
];

/**
 * Controls — Main control panel.
 */
export class Controls {
  /**
   * @param {Object} options
   * @param {Function} options.onWaterLevelChange
   * @param {Function} options.onRadiusChange
   * @param {Function} options.onFlyTo
   * @param {Function} options.onViewChange
   * @param {Function} options.onAnimate
   * @param {Function} options.onClear
   * @param {Function} options.onWalkToggle
   * @param {Function} options.onProviderChange
   */
  constructor(options) {
    this.options = options;
    this.currentLocation = LOCATIONS[0];
    this.currentLevel = 0;
    this.currentRadius = (0.5 / 2 * 1.60934) / 111; // 0.5 mi diameter → 0.25 mi radius in degrees
    this.currentBoundary = 'circle';
    this.activeView = 'aerial';
    this.walkMode = false;
    this.panel = document.getElementById('controlPanel');

    this._build();
    this._bindEvents();
  }

  _build() {
    this.panel.innerHTML = `
      <div class="panel-header">
        <h2>HydroViz 3D — New Orleans</h2>
      </div>
      <div class="panel-body">

        <!-- Location -->
        <div class="control-section">
          <div class="section-label">Location</div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <select id="locationSelect" class="styled-select" style="flex: 1; margin: 0; min-width: 0;">
              ${LOCATIONS.map((loc) =>
      `<option value="${loc.id}">${loc.name}</option>`
    ).join('')}
            </select>
            <button id="btnFlyTo" class="btn btn-primary" style="display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 8px; height: 36px; margin: 0; width: auto; flex-shrink: 0; white-space: nowrap;">
              Go
            </button>
          </div>
        </div>

        <div class="panel-divider"></div>

        <!-- Elevation Provider -->
        <div class="control-section">
          <div class="section-label">Elevation Provider</div>
          <select id="providerSelect" class="styled-select">
            <option value="google" selected>Google Elevation</option>
            <option value="usgs">USGS 3DEP</option>
          </select>
        </div>

        <div class="panel-divider"></div>

        <!-- Camera & Navigation -->
        <div class="control-section">
          <div class="section-label">
            Camera & Navigation
            <div class="info-icon-container">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <div class="info-tooltip">
                <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 2px;">Orbit / Aerial</div>
                <div class="tooltip-hint">Left drag — Rotate</div>
                <div class="tooltip-hint">Right drag — Zoom</div>
                <div class="tooltip-hint">Middle drag — Tilt</div>
                <div class="tooltip-hint">Scroll — Zoom in/out</div>
              </div>
            </div>
          </div>
          <div class="view-presets">
            <button class="view-btn active" data-view="aerial">Aerial</button>
            <button class="view-btn" data-view="street">Street</button>
            <button class="view-btn" data-view="orbit">Overview</button>
          </div>
        </div>

        <div class="panel-divider"></div>

        <!-- Click Instruction -->
        <div class="control-section">
          <div class="section-label">
            Water Origin
            <div class="info-icon-container" id="originInfoIcon" style="display: none;">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <div class="info-tooltip" id="clickInstructionTooltip">
                Click elsewhere to move origin
              </div>
            </div>
          </div>
          <div class="click-instruction" id="clickInstructionMsg">
            Click on the map to place water origin
          </div>
          <div class="origin-display" id="originDisplay" style="display: none;">
            <div class="origin-row">
              <span class="origin-label">Origin:</span>
              <span class="origin-value" id="originCoords">—</span>
            </div>
            <div class="origin-row">
              <span class="origin-label">Ground:</span>
              <span class="origin-value" id="originElevation">—</span>
            </div>
          </div>
        </div>

        <div class="panel-divider"></div>

        <!-- Region Size (always visible) -->
        <div class="control-section">
          <div class="section-label">
            <span>Region Size</span>
            <span class="section-value" id="radiusDisplay">0.5 mi</span>
          </div>
          <input type="range" id="radiusSlider" min="0.1" max="10" step="0.1" value="0.5">
        </div>

        <div id="waterControlsContainer" class="water-controls-wrapper">
          <div class="water-controls-inner">
            <div class="panel-divider"></div>

            <!-- Water Level -->
            <div class="control-section">
              <div class="section-label">
                <span>Water Level Above Ground</span>
                <span class="section-value" id="waterLevelDisplay">0.0 ft</span>
              </div>
              <input type="range" id="waterLevelSlider" min="0" max="60" step="0.5" value="0">
            </div>

            <!-- Water Surface -->
            <div class="control-section">
              <div class="elevation-readout">
                <span class="readout-label">Water Surface: </span>
                <span class="readout-value" id="waterSurfaceValue">—</span>
                <span class="readout-unit">ft MSL</span>
              </div>
            </div>

            <div class="panel-divider"></div>

            <!-- Actions -->
            <div class="control-section">
              <button id="btnClear" class="btn btn-danger">
                Reset Simulation
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    // Water level
    const waterSlider = document.getElementById('waterLevelSlider');
    const waterDisplay = document.getElementById('waterLevelDisplay');

    // Update display while dragging
    waterSlider.addEventListener('input', () => {
      const levelFt = parseFloat(waterSlider.value);
      waterDisplay.textContent = `${levelFt.toFixed(1)} ft`;
    });

    // Trigger animation/logic on release
    waterSlider.addEventListener('change', () => {
      const levelFt = parseFloat(waterSlider.value);
      const levelMeters = levelFt * 0.3048;
      this.currentLevel = levelMeters;
      this.options.onWaterLevelChange(levelMeters);
    });

    // Radius
    const radiusSlider = document.getElementById('radiusSlider');
    const radiusDisplay = document.getElementById('radiusDisplay');
    radiusSlider.addEventListener('input', () => {
      const sizeMiles = parseFloat(radiusSlider.value);
      const radiusMiles = sizeMiles / 2;
      const radiusDegrees = (radiusMiles * 1.60934) / 111;
      this.currentRadius = radiusDegrees;
      radiusDisplay.textContent = `${sizeMiles.toFixed(1)} mi`;
      this.options.onRadiusChange(radiusDegrees);
    });

    // Location
    const locationSelect = document.getElementById('locationSelect');
    locationSelect.addEventListener('change', () => {
      const loc = LOCATIONS.find((l) => l.id === locationSelect.value);
      if (loc) {
        this.currentLocation = loc;
      }
    });

    // Elevation Provider
    const providerSelect = document.getElementById('providerSelect');
    if (providerSelect) {
      providerSelect.addEventListener('change', () => {
        if (this.options.onProviderChange) {
          this.options.onProviderChange(providerSelect.value);
        }
      });
    }

    // Fly To
    document.getElementById('btnFlyTo').addEventListener('click', () => {
      this.options.onFlyTo(this.currentLocation);
    });

    // Camera presets
    const viewBtns = this.panel.querySelectorAll('.view-btn');
    viewBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        viewBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeView = btn.dataset.view;
        if (this.options.onViewChange) this.options.onViewChange(btn.dataset.view);
      });
    });



    // Clear
    document.getElementById('btnClear').addEventListener('click', () => {
      waterSlider.value = 0;
      waterDisplay.textContent = '0.0 ft';
      this.currentLevel = 0;
      this.setWaterSurface(null);
      this.setOrigin(null);
      this.options.onClear();
    });
  }

  // ─── Public setters ────────────────────────────────

  setWaterLevelDisplay(levelMeters) {
    const d = document.getElementById('waterLevelDisplay');
    const s = document.getElementById('waterLevelSlider');
    const levelFt = levelMeters / 0.3048;
    if (d) d.textContent = `${levelFt.toFixed(1)} ft`;
    if (s) s.value = levelFt;
    this.currentLevel = levelMeters;
  }

  setGroundElevation(elevation) {
    const el = document.getElementById('originElevation');
    const elevFt = elevation !== null ? elevation / 0.3048 : null;
    if (el) el.textContent = elevFt !== null ? `${elevFt.toFixed(1)} ft MSL` : '—';
  }

  setWaterSurface(elevation) {
    const el = document.getElementById('waterSurfaceValue');
    const elevFt = elevation !== null ? elevation / 0.3048 : null;
    if (el) el.textContent = elevFt !== null ? elevFt.toFixed(1) : '—';
  }

  /**
   * Set and display the clicked water origin.
   * @param {{ lat: number, lng: number, elevation: number }|null} origin
   */
  setOrigin(origin) {
    const display = document.getElementById('originDisplay');
    const infoIcon = document.getElementById('originInfoIcon');
    const msg = document.getElementById('clickInstructionMsg');
    const coordsEl = document.getElementById('originCoords');
    const elevEl = document.getElementById('originElevation');
    const waterContainer = document.getElementById('waterControlsContainer');
    const radiusSlider = document.getElementById('radiusSlider');

    if (origin) {
      display.style.display = 'block';
      if (msg) msg.style.display = 'none';
      if (infoIcon) infoIcon.style.display = 'inline-flex';
      
      if (waterContainer) waterContainer.classList.add('visible');
      coordsEl.textContent = `${origin.lat.toFixed(5)}°, ${origin.lng.toFixed(5)}°`;
      const elevFt = origin.elevation / 0.3048;
      elevEl.textContent = `${elevFt.toFixed(1)} ft MSL`;
      // Lock region size — DEM grid is fetched for this radius
      if (radiusSlider) {
        radiusSlider.disabled = true;
        radiusSlider.closest('.control-section')?.classList.add('disabled');
      }
    } else {
      display.style.display = 'none';
      if (msg) msg.style.display = 'block';
      if (infoIcon) infoIcon.style.display = 'none';

      if (waterContainer) waterContainer.classList.remove('visible');
      coordsEl.textContent = '—';
      elevEl.textContent = '—';
      // Unlock region size for next placement
      if (radiusSlider) {
        radiusSlider.disabled = false;
        radiusSlider.closest('.control-section')?.classList.remove('disabled');
      }
    }
  }

  setElevationLoading(loading) {
    const display = document.getElementById('originDisplay');
    const msg = document.getElementById('clickInstructionMsg');
    const infoIcon = document.getElementById('originInfoIcon');
    
    if (loading) {
      if (display) display.style.display = 'none';
      if (infoIcon) infoIcon.style.display = 'none';
      if (msg) {
        msg.style.display = 'block';
        msg.innerHTML = '<span class="loading-dots">Measuring elevation</span>';
        msg.classList.add('loading');
      }
    } else {
      if (msg) {
        msg.classList.remove('loading');
      }
    }
  }

  show() {
    this.panel.style.display = 'block';
  }
}
