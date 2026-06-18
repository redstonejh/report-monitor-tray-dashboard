// Shared fleet-pie geometry + palette. Used by StatusPanel's FleetPie AND the
// legend window, so the legend draws REAL donut slices (same paths + colours),
// not a recreation.

export const PIE_COLORS = { healthy: '#6fc99a', degraded: '#d4ab63', down: '#e1857c', critical: '#9b1c1c' };

export const polar = (cx, cy, r, deg) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
};

export function ringSlicePath(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  const f = (n) => n.toFixed(2);
  return `M${f(x0)} ${f(y0)} A${f(r1)} ${f(r1)} 0 ${large} 1 ${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} A${f(r0)} ${f(r0)} 0 ${large} 0 ${f(x3)} ${f(y3)} Z`;
}

// A ring slice whose OUTER corners are rounded (premium rounded-bar tips). Only
// the slice's outer edge is rounded — its inner edge stays flat against the donut
// hole and internal band boundaries are untouched, so multi-band slices never get
// stray notches. `ro` = round the outer corners (set true only for the outermost
// band of each slice). Falls back to the square path when too thin to round.
export function roundedRingSlicePath(cx, cy, r0, r1, a0, a1, ro) {
  const span = a1 - a0;
  if (span <= 0) return ringSlicePath(cx, cy, r0, r1, a0, a1);
  const arcLen = (span * Math.PI / 180) * r1;
  const rad = Math.min(4, (r1 - r0) * 0.4, arcLen * 0.45);
  if (!ro || rad < 0.5) return ringSlicePath(cx, cy, r0, r1, a0, a1);
  const dO = (rad / r1) * 180 / Math.PI; // angular inset on the outer arc
  const large = span > 180 ? 1 : 0;
  const f = (n) => n.toFixed(2);
  const P = (r, a) => { const [x, y] = polar(cx, cy, r, a); return `${f(x)} ${f(y)}`; };
  const R = (r) => `${f(r)} ${f(r)}`;
  return [
    `M ${P(r1, a0 + dO)}`,
    `A ${R(r1)} 0 ${large} 1 ${P(r1, a1 - dO)}`,  // outer arc (inset for the corners)
    `A ${R(rad)} 0 0 1 ${P(r1 - rad, a1)}`,        // round the outer-end corner
    `L ${P(r0, a1)}`,                              // radial edge inward
    `A ${R(r0)} 0 ${large} 0 ${P(r0, a0)}`,        // inner arc back (square inner)
    `L ${P(r1 - rad, a0)}`,                        // radial edge outward
    `A ${R(rad)} 0 0 1 ${P(r1, a0 + dO)}`,         // round the outer-start corner
    'Z',
  ].join(' ');
}
