import React, { useEffect } from 'react';

// Renders in the SEPARATE legend window (opened to the left of the popover via
// ?legend=1). It fills its own little acrylic window — same material as the
// popover panel — so it reads as a sibling of the mini dashboard, not a child.
// Meanings come straight from the code (checkToPing + companyWorst in main.js):
//   red  = unreachable, and a circuit only goes red after 4 fails in a row
//   amber = reachable with packet loss / high latency (not yet a sustained outage)
//   green = reachable, no loss.
export default function LegendWindow() {
  useEffect(() => {
    if (window.electron?.platform === 'win32') document.body.classList.add('win-acrylic');
    document.body.classList.add('legend-body');
    const onKey = (e) => { if (e.key === 'Escape') window.electron?.closeLegend?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="legend-window">
      <div className="legend-row"><span className="legend-mark green">✓</span> Healthy</div>
      <div className="legend-row"><span className="legend-mark amber">!</span> Packet loss or high latency</div>
      <div className="legend-row"><span className="legend-mark red">✕</span> Down — 4 checks failed in a row</div>
      <div className="legend-foot">Donut: one slice per circuit, ringed green → amber → red.</div>
    </div>
  );
}
