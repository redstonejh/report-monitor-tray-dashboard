import React, { useEffect, useState } from 'react';
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

function FleetPie() {
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

  const hoveredCo = companies.find((c) => c.id === hovered) || null;
  const troubled = companies.filter((c) => c.down > 0).length;
  const watch = companies.filter((c) => c.down === 0 && c.degraded > 0).length;
  const summaryTitle = !n ? 'Connecting'
    : troubled ? `${troubled} down`
      : watch ? `${watch} to watch`
        : 'All good';
  const summarySub = n ? `${n} clients · 24h` : '';

  const centerTitle = hoveredCo ? conciseLabel(hoveredCo.label) : summaryTitle;
  const centerSub = hoveredCo
    ? (hoveredCo.total
      ? `${Math.round((hoveredCo.healthy / hoveredCo.total) * 100)}% healthy · 24h`
      : 'no data · 24h')
    : summarySub;
  const centerAccent = hoveredCo
    ? (hoveredCo.down ? 'red' : hoveredCo.degraded ? 'amber' : hoveredCo.total ? 'green' : 'neutral')
    : (troubled ? 'red' : watch ? 'amber' : n ? 'green' : 'neutral');

  return (
    <div className="fleet-pie-wrap">
      <svg className="fleet-pie" viewBox="0 0 220 220" role="img" aria-label="Client health, past 24 hours">
        {companies.map((co, index) => {
          const a0 = index * span + GAP / 2;
          const a1 = (index + 1) * span - GAP / 2;
          if (a1 <= a0) return null;
          const segments = [];
          if (!co.total) {
            segments.push({ key: 'empty', r0: R0, r1: R1, color: PIE_EMPTY });
          } else {
            const depth = R1 - R0;
            const hEnd = R0 + depth * (co.healthy / co.total);
            const dEnd = hEnd + depth * (co.degraded / co.total);
            if (co.healthy) segments.push({ key: 'healthy', r0: R0, r1: hEnd, color: PIE_COLORS.healthy });
            if (co.degraded) segments.push({ key: 'degraded', r0: hEnd, r1: dEnd, color: PIE_COLORS.degraded });
            if (co.down) segments.push({ key: 'down', r0: dEnd, r1: R1, color: PIE_COLORS.down });
          }
          return (
            <g
              key={co.id}
              className={`fleet-slice${hovered && hovered !== co.id ? ' dimmed' : ''}${co.online === false ? ' offline' : ''}`}
              onMouseEnter={() => setHovered(co.id)}
              onMouseLeave={() => setHovered((h) => (h === co.id ? null : h))}
              onClick={() => window.electron?.openCompany?.(co.id)}
            >
              <title>{`${co.label} — ${co.total ? `${co.healthy} healthy · ${co.degraded} degraded · ${co.down} down` : 'no data'} (24h)`}</title>
              {segments.map((seg) => (
                <path key={seg.key} d={ringSlicePath(CX, CY, seg.r0, seg.r1, a0, a1)} fill={seg.color} />
              ))}
            </g>
          );
        })}
      </svg>
      <div className={`fleet-center ${centerAccent}`}>
        <span className="fleet-center-title">{centerTitle}</span>
        {centerSub && <span className="fleet-center-sub">{centerSub}</span>}
      </div>
    </div>
  );
}

export default function StatusPanel({ mode = 'expanded' }) {
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
      <FleetPie />
    </div>
  );
}
