import React, { useEffect, useMemo, useState } from 'react';
import { useStatusStore, useSettingsStore } from '../store';

// One ring, one word. The status condition is the content — everything else is
// a single supporting line. No repeated banners, cards, or stage chips.
const STATUS_CONFIG = {
  green:  { accent: 'green', mark: '✓', title: 'All good' },
  yellow: { accent: 'amber', mark: '!', title: 'Needs attention' },
  red:    { accent: 'red',   mark: '✕', title: 'Source issue' },
};

function formatRelative(isoString) {
  if (!isoString) return 'never';
  const diff = Date.now() - new Date(isoString).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 48) return `${Math.floor(hours / 24)} days ago`;
  if (hours > 0) return `${hours}h ${mins}m ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

// Resolve the single visual identity for the current state.
function resolve(connectionState, status, projectId) {
  if (connectionState === 'live' && status) {
    return STATUS_CONFIG[status] || STATUS_CONFIG.yellow;
  }
  if (connectionState === 'black') return { accent: 'neutral', mark: '⧖', title: 'No updates' };
  if (!projectId) return { accent: 'neutral', mark: 'ℹ', title: 'Not configured' };
  return { accent: 'neutral', mark: '⋯', title: 'Connecting' };
}

// ─── Fleet pie ───────────────────────────────────────────────────────────────
// One slice per monitored company, radially split into healthy (inner, green) /
// degraded (amber) / down (outer rim, red) shares of the past 24 hours — the
// same HP language as the dashboard's timeline bars. Clicking a slice opens
// the dashboard on that company's tab.

const PIE_COLORS = { healthy: '#6fc99a', degraded: '#d4ab63', down: '#e1857c' };
const PIE_EMPTY = 'rgba(148, 163, 184, 0.3)';

const polar = (cx, cy, r, deg) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
};

function ringSlicePath(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  const f = (n) => n.toFixed(2);
  return `M${f(x0)} ${f(y0)} A${f(r1)} ${f(r1)} 0 ${large} 1 ${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} A${f(r0)} ${f(r0)} 0 ${large} 0 ${f(x3)} ${f(y3)} Z`;
}

// Trim protocol/source noise from labels, like the dashboard tabs do.
const conciseLabel = (s) => String(s || '')
  .replace(/\s*\((?:ICMP|TCP|UDP|HTTP|HTTPS|from\b)[^)]*\)\s*/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim() || String(s || '');

function FleetPie({ query = '' }) {
  const [companies, setCompanies] = useState([]);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      window.electron?.getCompaniesPie?.().then((list) => {
        if (!cancelled && Array.isArray(list)) setCompanies(list);
      }).catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const n = companies.length;
  const CX = 110;
  const CY = 110;
  const R0 = 46; // donut hole large enough for the centre label
  const R1 = 104;
  const GAP = n > 1 ? Math.min(2.4, 120 / Math.max(n, 1)) : 0;
  const span = n ? 360 / n : 360;

  // Type-ahead: as letters are typed in the search box, progressively highlight
  // the first company whose name OR IP STARTS with them (Windows desktop style);
  // fall back to a substring match so mid-word typing still finds something.
  const q = query.trim().toLowerCase();
  const matchId = useMemo(() => {
    if (!q) return null;
    const named = companies.map((c) => ({
      id: c.id,
      name: conciseLabel(c.label).toLowerCase(),
      host: String(c.host || "").toLowerCase(),
    }));
    return (named.find((c) => c.name.startsWith(q) || c.host.startsWith(q))
      || named.find((c) => c.name.includes(q) || c.host.includes(q)) || {}).id || null;
  }, [q, companies]);

  // Hover wins for instant feedback; otherwise the search match drives the
  // highlight + centre name.
  const highlightId = hovered || matchId;
  const highlightCo = companies.find((c) => c.id === highlightId) || null;

  // The centre hole shows the highlighted circuit's name, a "no match" note while
  // searching with no hit, or the default prompt. Hover is cleared only when the
  // cursor leaves the WHOLE pie (see the wrapper's onMouseLeave), so crossing the
  // gap between two slices glides from one name straight to the next.
  const centerTitle = highlightCo ? conciseLabel(highlightCo.label) : (q ? 'No match' : 'Click any slice');
  const centerAccent = highlightCo
    ? (highlightCo.down ? 'red' : highlightCo.degraded ? 'amber' : highlightCo.total ? 'green' : 'neutral')
    : 'neutral';

  return (
    <div className="fleet-pie-wrap" onMouseLeave={() => setHovered(null)}>
      <svg className="fleet-pie" viewBox="0 0 220 220" role="img" aria-label="Client health, past 24 hours (derived consensus)">
        {companies.map((co, index) => {
          const a0 = index * span + GAP / 2;
          const a1 = (index + 1) * span - GAP / 2;
          if (a1 <= a0) return null;
          // Fixed thirds (not proportional): green fills the ring by default; a
          // 1/3-deep band is ADDED for degraded and/or down — inner green, then
          // amber, then red on the rim — so a single derived bad bucket reads as
          // a full legible band, never an invisible sliver. The count of derived
          // degraded / down buckets is printed INSIDE its band.
          const segments = [];
          if (!co.total) {
            segments.push({ key: 'empty', r0: R0, r1: R1, color: PIE_EMPTY });
          } else {
            const depth = R1 - R0;
            const third = depth / 3;
            const alerts = (co.degraded > 0 ? 1 : 0) + (co.down > 0 ? 1 : 0);
            const greenEnd = R0 + depth - alerts * third;
            segments.push({ key: 'healthy', r0: R0, r1: greenEnd, color: PIE_COLORS.healthy });
            let edge = greenEnd;
            if (co.degraded > 0) { segments.push({ key: 'degraded', r0: edge, r1: edge + third, color: PIE_COLORS.degraded, count: co.degraded }); edge += third; }
            if (co.down > 0) { segments.push({ key: 'down', r0: edge, r1: R1, color: PIE_COLORS.down, count: co.down }); }
          }
          const mid = (a0 + a1) / 2;
          return (
            <g
              key={co.id}
              className={`fleet-slice${co.online === false ? ' offline' : ''}${co.critical ? ' is-critical' : ''}${co.id === highlightId ? ' is-match' : ''}`}
              onMouseEnter={() => setHovered(co.id)}
              onClick={() => window.electron?.openCompany?.(co.id)}
            >
              {segments.map((seg) => (
                <path key={seg.key} d={ringSlicePath(CX, CY, seg.r0, seg.r1, a0, a1)} fill={seg.color} />
              ))}
              {segments.filter((seg) => seg.count != null).map((seg) => {
                const [tx, ty] = polar(CX, CY, (seg.r0 + seg.r1) / 2, mid);
                return (
                  <text key={`${seg.key}-n`} className="fleet-slice-count"
                    x={tx.toFixed(1)} y={ty.toFixed(1)} textAnchor="middle" dominantBaseline="central">
                    {seg.count}
                  </text>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className={`fleet-center ${centerAccent}`}>
        {centerTitle && <span className="fleet-center-title">{centerTitle}</span>}
      </div>
    </div>
  );
}

export default function StatusPanel({ mode = 'expanded', fleetQuery = '' }) {
  const { status, detail, checkedAt, connectionState } = useStatusStore();
  const { projectId } = useSettingsStore();

  // Re-render every 30s so the "Checked Xm ago" relative time keeps ticking
  // even when no new status arrives.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const live = connectionState === 'live' && !!status;
  const connecting = !live && connectionState !== 'black' && !!projectId;
  const { accent, mark, title } = resolve(connectionState, status, projectId);

  if (mode === 'peek') {
    const sub = live
      ? `Checked ${formatRelative(checkedAt)}`
      : connectionState === 'black'
        ? (checkedAt ? `Last seen ${formatRelative(checkedAt)}` : 'Broker unreachable')
        : projectId ? 'Waiting for status' : 'Open settings to begin';
    return (
      <div className={`peek ${accent}`}>
        <span className="peek-dot">
          {connecting ? <span className="spinner" aria-hidden="true" /> : mark}
        </span>
        <span className="peek-copy">
          <span className="peek-title" role="status" aria-live="polite">{title}</span>
          <span className="peek-sub">{sub}</span>
        </span>
      </div>
    );
  }

  if (connectionState !== 'live' && connectionState !== 'black') {
    // Not connected yet — keep the quiet connecting hero.
    return (
      <div className={`status-hero ${accent}`}>
        <div className="status-ring">
          {connecting
            ? <span className="spinner" aria-hidden="true" />
            : <span className="status-mark" key={mark}>{mark}</span>}
        </div>
        <div className="status-title" role="status" aria-live="polite">{title}</div>
        <div className="status-detail">
          {projectId ? 'Waiting for the first status update.' : 'Open settings and paste your share code.'}
        </div>
      </div>
    );
  }

  return (
    <div className="status-hero neutral">
      <FleetPie query={fleetQuery} />
    </div>
  );
}
