/**
 * SWESolver — Shallow Water Equations solver for physically-based flood animation.
 *
 * Implements a 2D Lax-Friedrichs finite volume scheme on a DEM grid to simulate
 * dam-break scenarios with realistic water flow physics:
 *   - Gravity-driven flow along terrain slopes
 *   - Momentum-based wave propagation
 *   - Manning friction for energy dissipation
 *   - Wet/dry front tracking
 *   - CFL-adaptive timestep for numerical stability
 *
 * The shallow water equations solved:
 *   ∂h/∂t  + ∂(hu)/∂x + ∂(hv)/∂y = 0                              (mass)
 *   ∂(hu)/∂t + ∂(hu²+gh²/2)/∂x + ∂(huv)/∂y = -gh·∂B/∂x - friction (x-mom)
 *   ∂(hv)/∂t + ∂(huv)/∂x + ∂(hv²+gh²/2)/∂y = -gh·∂B/∂y - friction (y-mom)
 *
 * where h = water depth, u/v = velocities, B = bed elevation, g = gravity.
 */

const GRAVITY = 9.81;
const MIN_DEPTH = 0.001;   // m — below this a cell is treated as dry
const MANNING_N = 0.035;   // Manning roughness (urban / vegetated floodplain)

export class SWESolver {
  /**
   * @param {number[][]} demGrid - 2D array [row][col] of bed elevations (m MSL)
   * @param {Object} meta - Grid metadata from ElevationService
   *   { originLat, originLng, cellSizeLat, cellSizeLng, rows, cols }
   */
  constructor(demGrid, meta) {
    this.rows = meta.rows;
    this.cols = meta.cols;

    // Cell dimensions in metres
    const cosLat = Math.cos(meta.originLat * Math.PI / 180);
    this.dx = meta.cellSizeLng * 111319.5 * cosLat;
    this.dy = meta.cellSizeLat * 111319.5;

    // Bed elevation (read-only reference)
    this.B = [];
    for (let r = 0; r < this.rows; r++) {
      this.B.push(Float64Array.from(demGrid[r]));
    }

    // Primary state arrays
    this.h  = this._zeros();   // water depth      (m)
    this.hu = this._zeros();   // x-momentum       (m²/s)
    this.hv = this._zeros();   // y-momentum       (m²/s)

    // Work buffers (double-buffer swap target)
    this._h  = this._zeros();
    this._hu = this._zeros();
    this._hv = this._zeros();

    this.simTime = 0;  // accumulated physics time (s)
  }

  /** Allocate rows×cols grid of Float64Arrays filled with 0. */
  _zeros() {
    const g = [];
    for (let r = 0; r < this.rows; r++) g.push(new Float64Array(this.cols));
    return g;
  }

  /** Safe velocity (avoids ÷0 for dry cells). */
  _vel(momentum, depth) {
    return depth > MIN_DEPTH ? momentum / depth : 0;
  }

  // ─── CFL ────────────────────────────────────────────────────

  /**
   * Compute the largest CFL-stable timestep.
   * dt ≤ CFL · min(dx,dy) / max( |u|+√(gh), |v|+√(gh) )
   */
  computeDt(cfl = 0.40) {
    let maxSpeed = 0.1;  // floor prevents dt → ∞ when grid is dry
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const d = this.h[r][c];
        if (d <= MIN_DEPTH) continue;
        const wave = Math.sqrt(GRAVITY * d);
        const s = Math.max(
          Math.abs(this.hu[r][c] / d) + wave,
          Math.abs(this.hv[r][c] / d) + wave
        );
        if (s > maxSpeed) maxSpeed = s;
      }
    }
    return cfl * Math.min(this.dx, this.dy) / maxSpeed;
  }

  // ─── Single time-step (Lax-Friedrichs) ─────────────────────

  /**
   * Advance by one explicit Lax-Friedrichs step of size dt.
   *
   * U_new(i,j) = ¼[U(i±1,j) + U(i,j±1)]           ← Lax diffusion
   *            - dt/(2dx)[F_right − F_left]          ← x-flux
   *            - dt/(2dy)[G_down  − G_up  ]          ← y-flux
   *            + dt · S(i,j)                         ← source (slope + friction)
   */
  step(dt) {
    const { rows, cols, dx, dy, B } = this;
    const g = GRAVITY;

    // ─── Interior cells (r=1..rows-2, c=1..cols-2) ───
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        // Neighbour states
        const hL  = this.h[r][c - 1], huL = this.hu[r][c - 1], hvL = this.hv[r][c - 1];
        const hR  = this.h[r][c + 1], huR = this.hu[r][c + 1], hvR = this.hv[r][c + 1];
        const hUp = this.h[r - 1][c], huUp = this.hu[r - 1][c], hvUp = this.hv[r - 1][c];
        const hDn = this.h[r + 1][c], huDn = this.hu[r + 1][c], hvDn = this.hv[r + 1][c];

        // Lax-Friedrichs average
        const ha  = 0.25 * (hL + hR + hUp + hDn);
        const hua = 0.25 * (huL + huR + huUp + huDn);
        const hva = 0.25 * (hvL + hvR + hvUp + hvDn);

        // Velocities (safe)
        const uL  = this._vel(huL,  hL),  vL  = this._vel(hvL,  hL);
        const uR  = this._vel(huR,  hR),  vR  = this._vel(hvR,  hR);
        const uUp = this._vel(huUp, hUp), vUp = this._vel(hvUp, hUp);
        const uDn = this._vel(huDn, hDn), vDn = this._vel(hvDn, hDn);

        // ── X-flux derivative  ∂F/∂x ≈ (F_right − F_left) / 2dx ──
        //   F = [ hu,  hu·u + g·h²/2,  hu·v ]
        const dFx_h  = (huR - huL) / (2 * dx);
        const dFx_hu = ((huR * uR + 0.5 * g * hR * hR) -
                        (huL * uL + 0.5 * g * hL * hL)) / (2 * dx);
        const dFx_hv = ((huR * vR) - (huL * vL)) / (2 * dx);

        // ── Y-flux derivative  ∂G/∂y ≈ (G_down − G_up) / 2dy ──
        //   G = [ hv,  hv·u,  hv·v + g·h²/2 ]
        const dGy_h  = (hvDn - hvUp) / (2 * dy);
        const dGy_hu = ((hvDn * uDn) - (hvUp * uUp)) / (2 * dy);
        const dGy_hv = ((hvDn * vDn + 0.5 * g * hDn * hDn) -
                        (hvUp * vUp + 0.5 * g * hUp * hUp)) / (2 * dy);

        // ── Source: bed slope  S = −g·h · ∇B ──
        const dBdx = (B[r][c + 1] - B[r][c - 1]) / (2 * dx);
        const dBdy = (B[r + 1][c] - B[r - 1][c]) / (2 * dy);
        const hSrc = ha > MIN_DEPTH ? ha : 0;

        // Update
        let h_new  = ha  - dt * (dFx_h  + dGy_h);
        let hu_new = hua - dt * (dFx_hu + dGy_hu) - dt * g * hSrc * dBdx;
        let hv_new = hva - dt * (dFx_hv + dGy_hv) - dt * g * hSrc * dBdy;

        // ── Manning friction (semi-implicit) ──
        if (h_new > MIN_DEPTH) {
          const un = hu_new / h_new;
          const vn = hv_new / h_new;
          const spd = Math.sqrt(un * un + vn * vn);
          if (spd > 1e-8) {
            const Cf = g * MANNING_N * MANNING_N * spd / Math.pow(h_new, 1 / 3);
            const damp = 1 / (1 + dt * Cf);
            hu_new *= damp;
            hv_new *= damp;
          }
        }

        // Clamp negative depths
        if (h_new < 0) { h_new = 0; hu_new = 0; hv_new = 0; }

        this._h[r][c]  = h_new;
        this._hu[r][c] = hu_new;
        this._hv[r][c] = hv_new;
      }
    }

    // ─── Reflective boundary conditions ───
    for (let c = 0; c < cols; c++) {
      // Top wall (reflect y-momentum)
      this._h[0][c]  = this._h[1][c];
      this._hu[0][c] = this._hu[1][c];
      this._hv[0][c] = -this._hv[1][c];
      // Bottom wall
      this._h[rows - 1][c]  = this._h[rows - 2][c];
      this._hu[rows - 1][c] = this._hu[rows - 2][c];
      this._hv[rows - 1][c] = -this._hv[rows - 2][c];
    }
    for (let r = 0; r < rows; r++) {
      // Left wall (reflect x-momentum)
      this._h[r][0]  = this._h[r][1];
      this._hu[r][0] = -this._hu[r][1];
      this._hv[r][0] = this._hv[r][1];
      // Right wall
      this._h[r][cols - 1]  = this._h[r][cols - 2];
      this._hu[r][cols - 1] = -this._hu[r][cols - 2];
      this._hv[r][cols - 1] = this._hv[r][cols - 2];
    }

    // Swap primary ↔ work buffers
    [this.h,  this._h]  = [this._h,  this.h];
    [this.hu, this._hu] = [this._hu, this.hu];
    [this.hv, this._hv] = [this._hv, this.hv];

    this.simTime += dt;
  }

  // ─── Initialisation helpers ─────────────────────────────────

  /**
   * Dam-break initial condition: water column at (centerRow, centerCol)
   * with Gaussian fall-off over `radius` cells.
   */
  initDamBreak(centerRow, centerCol, peakDepth, radius = 3) {
    const sigma2 = (radius * radius) / 3;  // spread for bell curve
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const dr = r - centerRow;
        const dc = c - centerCol;
        const dist2 = dr * dr + dc * dc;
        if (dist2 <= radius * radius * 4) {  // cut-off at 2× radius
          this.h[r][c] = peakDepth * Math.exp(-dist2 / (2 * sigma2));
        }
      }
    }
  }

  /**
   * Inject water uniformly over a circular area around (row,col).
   * @param {number} row
   * @param {number} col
   * @param {number} totalVolume - m³ to add
   * @param {number} [injectRadius=2] - radius in cells
   */
  injectWater(row, col, totalVolume, injectRadius = 2) {
    const cellArea = this.dx * this.dy;
    const cells = [];
    for (let dr = -injectRadius; dr <= injectRadius; dr++) {
      for (let dc = -injectRadius; dc <= injectRadius; dc++) {
        if (dr * dr + dc * dc <= injectRadius * injectRadius) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr >= 1 && nr < this.rows - 1 && nc >= 1 && nc < this.cols - 1) {
            cells.push([nr, nc]);
          }
        }
      }
    }
    if (cells.length === 0) return;
    const depthPerCell = totalVolume / (cells.length * cellArea);
    for (const [r, c] of cells) {
      this.h[r][c] += depthPerCell;
    }
  }

  // ─── Query helpers ──────────────────────────────────────────

  /**
   * Set of "row,col" keys for cells with depth above threshold.
   */
  getFloodedCells(minDepth = 0.02) {
    const out = new Set();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.h[r][c] > minDepth) out.add(`${r},${c}`);
      }
    }
    return out;
  }

  /** Total water volume (m³). */
  getTotalVolume() {
    const area = this.dx * this.dy;
    let vol = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) vol += this.h[r][c];
    }
    return vol * area;
  }

  // ─── Multi-step advance ─────────────────────────────────────

  /**
   * Advance simulation by `targetSeconds` of physics time,
   * automatically choosing CFL-safe sub-steps.
   * @returns {number} sub-steps taken
   */
  advance(targetSeconds, maxSubsteps = 100) {
    let remaining = targetSeconds;
    let steps = 0;
    while (remaining > 1e-8 && steps < maxSubsteps) {
      const dt = Math.min(this.computeDt(), remaining);
      this.step(dt);
      remaining -= dt;
      steps++;
    }
    return steps;
  }
}
