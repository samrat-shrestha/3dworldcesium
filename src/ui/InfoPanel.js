import * as Cesium from 'cesium';

/**
 * InfoPanel — Shows simulation data including clicked origin and elevation.
 */
export class InfoPanel {
  constructor(viewer) {
    this.viewer = viewer;
    this.panel = document.getElementById('infoPanel');
    this._build();
    this._startCameraTracking();
  }

  _build() {
    this.panel.innerHTML = `
      <div class="info-title">Simulation Data</div>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Ground Elev.</span>
          <span class="info-value" id="infoGroundElev">—</span>
        </div>
        <div class="info-item">
          <span class="info-label">Water Level</span>
          <span class="info-value accent" id="infoWaterLevel">0.0 m</span>
        </div>
        <div class="info-item">
          <span class="info-label">Flood Area</span>
          <span class="info-value" id="infoFloodArea">0.0 km²</span>
        </div>
        <div class="info-item full-width">
          <span class="info-label">Water Origin</span>
          <span class="info-value" id="infoOrigin" style="font-size: 0.65rem;">Click map to set</span>
        </div>
        <div class="info-item full-width">
          <span class="info-label">Location</span>
          <span class="info-value" id="infoLocation">French Quarter</span>
        </div>
        <div class="info-item full-width">
          <span class="info-label">Camera</span>
          <span class="info-value" id="infoCameraPos" style="font-size: 0.65rem;">—</span>
        </div>
      </div>
    `;
  }

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
    if (el) el.textContent = `${level.toFixed(1)} m`;
  }

  setGroundElevation(elevation) {
    const el = document.getElementById('infoGroundElev');
    if (el) el.textContent = elevation !== null ? `${elevation.toFixed(1)} m` : '—';
  }

  setWaterSurface(elevation) {
    const el = document.getElementById('infoWaterSurface');
    if (el) el.textContent = elevation !== null ? `${elevation.toFixed(1)} m MSL` : '—';
  }

  setFloodArea(area) {
    const el = document.getElementById('infoFloodArea');
    if (el) el.textContent = `${area.toFixed(1)} km²`;
  }

  setLocation(name) {
    const el = document.getElementById('infoLocation');
    if (el) el.textContent = name;
  }

  setOrigin(origin) {
    const el = document.getElementById('infoOrigin');
    if (el) {
      if (origin) {
        el.textContent = `${origin.lat.toFixed(5)}°, ${origin.lng.toFixed(5)}° · ${origin.elevation.toFixed(1)}m`;
      } else {
        el.textContent = 'Click map to set';
      }
    }
  }

  show() { this.panel.style.display = 'block'; }

  destroy() {
    if (this._cameraInterval) clearInterval(this._cameraInterval);
  }
}
