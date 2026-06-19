import React, { useEffect, useState } from 'react';
import { PIE_COLORS } from './pie-geometry';

// Renders in the SEPARATE legend window (?legend=1), to the left of the popover,
// at the SAME size as the popover. A flat key — no titles — with the LITERAL
// tray-icon PNGs (top group) and the donut's own band colours as EQUAL swatches
// (bottom group). NOTE: the donut is drawn as concentric arcs, so equal-thickness
// rings can never LOOK equal (outer arc length > inner); equal swatches are the
// honest way to key them.
//
// Terminology: a "down" = one failed check; a "failure" = 4+ CONSECUTIVE downs.
// Donut bands (StatusPanel.js): green=healthy, orange=degraded (co.degraded),
// light-red=Total downs (co.down), deep-red=Total failures (co.criticalCount).
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
  const sw = (c) => <span className="legend-swatch" style={{ background: c }} />;

  return (
    <div className="legend-window">
      <div className="legend-row">{ico('green')}<span>Healthy</span></div>
      <div className="legend-row">{ico('yellow')}<span>Flaky — 4+ downs in 10 min, not in a row</span></div>
      <div className="legend-row">{ico('red')}<span>Failure — 4+ consecutive downs</span></div>
      <div className="legend-divider" />
      <div className="legend-row">{sw(PIE_COLORS.healthy)}<span>Healthy</span></div>
      <div className="legend-row">{sw(PIE_COLORS.degraded)}<span>Degraded — pass, but poor connection</span></div>
      <div className="legend-row">{sw(PIE_COLORS.down)}<span>Total downs</span></div>
      <div className="legend-row">{sw(PIE_COLORS.critical)}<span>Total failures</span></div>
    </div>
  );
}
