/**
 * HazardRating — H1–H6 flood hazard classification from depth × velocity.
 *
 * Standard provisional classification (Australian Rainfall & Runoff, Book 6;
 * the same depth/velocity thresholds underpin USBR and UK FD2320 guidance).
 * Hazard to people and vehicles depends on both how deep the water is and
 * how fast it's moving — not depth alone.
 *
 * A cell is classified by the WORST class satisfied by either its depth or
 * its depth×velocity (DV) product.
 */

const CLASSES = [
  {
    code: 'H1',
    label: 'Safe',
    description: 'Generally safe for vehicles, people, and buildings.',
    color: '#4caf50',
    maxDepth: 0.3,
    maxDV: 0.3,
  },
  {
    code: 'H2',
    label: 'Low Risk',
    description: 'Rising water may float small or light vehicles.',
    color: '#8bc34a',
    maxDepth: 0.5,
    maxDV: 0.6,
  },
  {
    code: 'H3',
    label: 'Moderate Risk',
    description: 'Unsafe for vehicles, children, and the elderly.',
    color: '#ffd54f',
    maxDepth: 1.2,
    maxDV: 0.6,
  },
  {
    code: 'H4',
    label: 'High Risk',
    description: 'Unsafe for all people and all vehicles.',
    color: '#ff9800',
    maxDepth: 2.0,
    maxDV: 1.0,
  },
  {
    code: 'H5',
    label: 'Severe Risk',
    description: 'Buildings vulnerable to structural damage; unsafe for people/vehicles.',
    color: '#f4511e',
    maxDepth: 4.0,
    maxDV: 4.0,
  },
  {
    code: 'H6',
    label: 'Extreme Danger',
    description: 'All building types vulnerable to failure.',
    color: '#c62828',
    maxDepth: Infinity,
    maxDV: Infinity,
  },
];

/**
 * Classify flood hazard from depth and velocity.
 * @param {number} depthM - Water depth in meters
 * @param {number} speedMps - Flow speed in m/s
 * @returns {{code: string, label: string, description: string, color: string}}
 */
/**
 * Classify hazard from a WaterRenderer flow state, picking the right depth
 * basis automatically. Shared by the risk flags and the damage panel so the
 * two can never disagree about a building's hazard class.
 *
 * @param {number} currentDepthM - Depth at the currently displayed water level
 * @param {{peakDepth: number, peakSpeed: number, stale: boolean}|null} flowState
 * @returns {{code: string, label: string, description: string, color: string}}
 */
export function hazardFromFlow(currentDepthM, flowState) {
  if (!flowState) {
    // No simulation has run here — depth is all we know.
    return classifyHazard(currentDepthM, 0);
  }
  if (flowState.stale) {
    // Peak depth belongs to a different water level than the one displayed.
    // Use the current depth, but keep peak velocity as the best available
    // flow estimate.
    return classifyHazard(currentDepthM, flowState.peakSpeed);
  }
  // Solver state matches the displayed level — use true event peaks.
  return classifyHazard(flowState.peakDepth, flowState.peakSpeed);
}

/**
 * Classify flood hazard from depth and velocity.
 * @param {number} depthM - Water depth in meters
 * @param {number} speedMps - Flow speed in m/s
 * @returns {{code: string, label: string, description: string, color: string}}
 */
export function classifyHazard(depthM, speedMps) {
  const dv = depthM * speedMps;

  for (const cls of CLASSES) {
    if (depthM <= cls.maxDepth && dv <= cls.maxDV) {
      return { code: cls.code, label: cls.label, description: cls.description, color: cls.color };
    }
  }
  // Unreachable — H6 has Infinity bounds — but keep a safe fallback.
  const last = CLASSES[CLASSES.length - 1];
  return { code: last.code, label: last.label, description: last.description, color: last.color };
}
