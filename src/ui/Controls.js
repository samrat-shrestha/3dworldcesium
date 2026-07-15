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
    this.currentRadius = (0.5 * 1.60934) / 111;
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
          <select id="locationSelect" class="styled-select">
            ${LOCATIONS.map((loc) =>
      `<option value="${loc.id}">${loc.name}</option>`
    ).join('')}
          </select>
          <button id="btnFlyTo" class="btn btn-primary" style="margin-top: 6px;">
            Go To Location
          </button>
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

        <!-- Camera -->
        <div class="control-section">
          <div class="section-label">Camera View</div>
          <div class="view-presets">
            <button class="view-btn active" data-view="aerial">Aerial</button>
            <button class="view-btn" data-view="street">Street</button>
            <button class="view-btn" data-view="orbit">Overview</button>
          </div>
        </div>

        <!-- Walk Mode -->
        <div class="control-section" style="margin-top: 6px;">
          <button id="btnWalk" class="btn btn-walk">
            <span id="walkIcon">⊙</span> Walk Mode
          </button>
          <div id="walkHints" class="walk-hints" style="display: none;">
            <div class="walk-hint">W/S — Forward / Back</div>
            <div class="walk-hint">A/D — Strafe left / right</div>
            <div class="walk-hint">Q/E — Up / Down</div>
            <div class="walk-hint">Arrow keys — Look around</div>
            <div class="walk-hint">Right drag — Look (mouse)</div>
            <div class="walk-hint">Shift — Sprint</div>
          </div>
        </div>

        <div class="panel-divider"></div>

        <!-- Click Instruction -->
        <div class="control-section">
          <div class="click-instruction" id="clickInstruction">
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

        <!-- Radius -->
        <div class="control-section">
          <div class="section-label">
            <span>Region Size</span>
            <span class="section-value" id="radiusDisplay">0.5 mi</span>
          </div>
          <input type="range" id="radiusSlider" min="0.1" max="10" step="0.1" value="0.5">
        </div>

        <div class="panel-divider"></div>

        <!-- Actions -->
        <div class="control-section">
          <button id="btnClear" class="btn btn-danger">
            Clear Water
          </button>
        </div>

        <div class="panel-divider"></div>

        <!-- Nav Help (orbit mode) -->
        <div id="orbitHints" class="nav-help">
          <div class="nav-hint">Left drag — Rotate</div>
          <div class="nav-hint">Right drag — Zoom</div>
          <div class="nav-hint">Middle drag — Tilt</div>
          <div class="nav-hint">Scroll — Zoom in/out</div>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    // Water level
    const waterSlider = document.getElementById('waterLevelSlider');
    const waterDisplay = document.getElementById('waterLevelDisplay');
    waterSlider.addEventListener('input', () => {
      const levelFt = parseFloat(waterSlider.value);
      const levelMeters = levelFt * 0.3048;
      this.currentLevel = levelMeters;
      waterDisplay.textContent = `${levelFt.toFixed(1)} ft`;
      this.options.onWaterLevelChange(levelMeters);
    });

    // Radius
    const radiusSlider = document.getElementById('radiusSlider');
    const radiusDisplay = document.getElementById('radiusDisplay');
    radiusSlider.addEventListener('input', () => {
      const radiusMiles = parseFloat(radiusSlider.value);
      const radiusDegrees = (radiusMiles * 1.60934) / 111;
      this.currentRadius = radiusDegrees;
      radiusDisplay.textContent = `${radiusMiles.toFixed(1)} mi`;
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

    // Walk mode toggle
    document.getElementById('btnWalk').addEventListener('click', () => {
      this.walkMode = !this.walkMode;
      const btn = document.getElementById('btnWalk');
      const hints = document.getElementById('walkHints');
      const orbitHints = document.getElementById('orbitHints');
      const icon = document.getElementById('walkIcon');

      if (this.walkMode) {
        btn.classList.add('active');
        hints.style.display = 'block';
        orbitHints.style.display = 'none';
        icon.textContent = '●';
      } else {
        btn.classList.remove('active');
        hints.style.display = 'none';
        orbitHints.style.display = 'block';
        icon.textContent = '⊙';
      }

      if (this.options.onWalkToggle) this.options.onWalkToggle(this.walkMode);
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
    const instruction = document.getElementById('clickInstruction');
    const coordsEl = document.getElementById('originCoords');
    const elevEl = document.getElementById('originElevation');

    if (origin) {
      display.style.display = 'block';
      instruction.textContent = 'Click elsewhere to move origin';
      coordsEl.textContent = `${origin.lat.toFixed(5)}°, ${origin.lng.toFixed(5)}°`;
      const elevFt = origin.elevation / 0.3048;
      elevEl.textContent = `${elevFt.toFixed(1)} ft MSL`;
    } else {
      display.style.display = 'none';
      instruction.textContent = 'Click on the map to place water origin';
      coordsEl.textContent = '—';
      elevEl.textContent = '—';
    }
  }

  /**
   * Show/hide loading indicator during USGS elevation fetch.
   * @param {boolean} loading
   */
  setElevationLoading(loading) {
    const instruction = document.getElementById('clickInstruction');
    if (instruction) {
      if (loading) {
        instruction.innerHTML = '<span class="loading-dots">Measuring elevation</span>';
        instruction.classList.add('loading');
      } else {
        instruction.textContent = 'Click elsewhere to move origin';
        instruction.classList.remove('loading');
      }
    }
  }

  show() {
    this.panel.style.display = 'block';
  }
}
