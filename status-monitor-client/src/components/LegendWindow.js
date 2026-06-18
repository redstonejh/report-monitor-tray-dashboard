import React, { useEffect, useState } from 'react';
import { PIE_COLORS, polar, roundedRingSlicePath } from './pie-geometry';

// Renders in the SEPARATE legend window (?legend=1), to the left of the popover,
// at the SAME width as the popover. The key uses LITERAL artwork — the actual
// tray-icon PNGs (from main) and a REAL donut slice (FleetPie's own path code +
// palette) — nothing is a recreation/guess.
//
// Donut bands (StatusPanel.js segment logic — read it, don't guess):
//   green core  = healthy (fills the remainder)
//   orange 1/3  = degraded   → count = co.degraded   (passing, but poor connection)
//   light-red 1/3 = down     → count = co.down       (TOTAL down minutes)
//   deep-red 1/3 = critical  → count = co.criticalCount (ESCALATED failures: times
//                                                         it went 4-down-in-a-row)
// Each alert tier is a fixed 1/3 of the ring depth. The legend draws them as
// separated, equal thirds out from the green core.

function DonutDiagram() {
  const cx = 44, cy = 150, a0 = -13, a1 = 13, r0 = 12, T = 20, G = 14;
  // 4 EQUAL-thickness rings + EQUAL gaps → their anchors land at evenly-spaced
  // heights, so every callout arrow is perfectly HORIZONTAL (label Y === band Y).
  // Narrow wedge so the rings read as uniform stacked bands.
  const bands = [PIE_COLORS.healthy, PIE_COLORS.degraded, PIE_COLORS.down, PIE_COLORS.critical]
    .map((c, i) => { const lo = r0 + i * (T + G); return { r0: lo, r1: lo + T, c }; });
  const LX = 92;
  // labels top→bottom = outer band (critical) → inner band (healthy)
  const labels = [
    { i: 3, lines: ['Escalated —', '4 in a row'] },
    { i: 2, lines: ['Down — total downs'] },
    { i: 1, lines: ['Degraded — pass,', 'but poor connection'] },
    { i: 0, lines: ['Healthy'] },
  ];
  return (
    <svg className="legend-donut" viewBox="0 14 224 128" aria-label="Donut slice key">
      <defs>
        <marker id="legArrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L7,4 L0,8 z" fill="rgba(255,255,255,.62)" />
        </marker>
      </defs>
      {bands.map((b, i) => (
        <path key={i} d={roundedRingSlicePath(cx, cy, b.r0, b.r1, a0, a1, true)} fill={b.c} />
      ))}
      {labels.map((L) => {
        const b = bands[L.i];
        const [ax, ay] = polar(cx, cy, (b.r0 + b.r1) / 2, a1);
        const y0 = ay - (L.lines.length - 1) * 6.5;
        return (
          <g key={L.i}>
            {/* y1 === y2 === ay → the arrow is perfectly horizontal */}
            <line x1={ax.toFixed(1)} y1={ay.toFixed(1)} x2={LX - 5} y2={ay.toFixed(1)}
              stroke="rgba(255,255,255,.5)" strokeWidth="1.1" markerEnd="url(#legArrow)" />
            <text x={LX} y={y0.toFixed(1)} dominantBaseline="middle" fill="#fff" fontSize="11" fontWeight="600">
              {L.lines.map((t, j) => (j === 0 ? t : <tspan key={j} x={LX} dy="13">{t}</tspan>))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function LegendWindow() {
  const [icons, setIcons] = useState(null);
  useEffect(() => {
    if (window.electron?.platform === 'win32') document.body.classList.add('win-acrylic');
    document.body.classList.add('legend-body');
    window.electron?.getTrayIcons?.().then(setIcons).catch(() => {});
    const onKey = (e) => { if (e.key === 'Escape') window.electron?.closeLegend?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ico = (k) => (icons && icons[k]
    ? <img className="legend-ico" src={icons[k]} alt="" />
    : <span className="legend-ico legend-ico-ph" />);

  return (
    <div className="legend-window">
      <div className="legend-sec">Tray icon</div>
      <div className="legend-row">{ico('green')} Healthy</div>
      <div className="legend-row">{ico('yellow')} Flaky — 4+ fails in 10 min, not in a row</div>
      <div className="legend-row">{ico('red')} Down — 4 fails in a row</div>
      <div className="legend-sec">Donut slice</div>
      <DonutDiagram />
    </div>
  );
}
