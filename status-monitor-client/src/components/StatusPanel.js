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

// Pie geometry + palette live in a shared module so the legend window can draw
// the REAL donut slices (same paths + colours), not a recreation.
import { PIE_COLORS, polar, roundedRingSlicePath } from './pie-geometry';
const PIE_EMPTY = 'rgba(148, 163, 184, 0.3)';

// Donut time-filter windows (clickable text under the pie, like the dashboard's
// time filter). The selected window is passed to the pie IPC so main derives the
// health mix over that span. 1w is bounded by how much history is retained.
const WINDOW_MS = { '1hr': 3600000, '1d': 86400000, '1w': 604800000 };

// Trim protocol/source noise from labels, like the dashboard tabs do.
const conciseLabel = (s) => String(s || '')
  .replace(/\s*\((?:ICMP|TCP|UDP|HTTP|HTTPS|from\b)[^)]*\)\s*/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim() || String(s || '');

function FleetPie({ query = '' }) {
  const [companies, setCompanies] = useState([]);
  const [hovered, setHovered] = useState(null);
  const [windowKey, setWindowKey] = useState('1d'); // donut time filter

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      window.electron?.getCompaniesPie?.(WINDOW_MS[windowKey]).then((list) => {
        if (!cancelled && Array.isArray(list)) setCompanies(list);
      }).catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [windowKey]);

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
    <>
    <div className="fleet-pie-wrap" onMouseLeave={() => setHovered(null)}>
      <svg className="fleet-pie" viewBox="0 0 220 220" role="img" aria-label="Client health, past 24 hours (derived consensus)">
        {companies.map((co, index) => {
          const a0 = index * span + GAP / 2;
          const a1 = (index + 1) * span - GAP / 2;
          if (a1 <= a0) return null;
          // Fixed thirds (not proportional): up to THREE alert tiers stack outward
          // from the green core, each taking exactly 1/3 of the ring depth — amber
          // (degraded) → light red (down) → deep red (critical). Green fills only
          // what's left, so with all three present there is NO green (3 × 1/3 =
          // full depth). Each band prints its count: degraded/down derived buckets,
          // and for the deep-red tier the number of "went critical" episodes (4
          // derived fails in a row). A tier only appears when it applies (count>0).
          const segments = [];
          if (!co.total) {
            segments.push({ key: 'empty', r0: R0, r1: R1, color: PIE_EMPTY });
          } else {
            const depth = R1 - R0;
            const third = depth / 3;
            const tiers = [];
            if (co.degraded > 0) tiers.push({ key: 'degraded', color: PIE_COLORS.degraded, count: co.degraded });
            if (co.down > 0) tiers.push({ key: 'down', color: PIE_COLORS.down, count: co.down });
            if (co.criticalCount > 0) tiers.push({ key: 'critical', color: PIE_COLORS.critical, count: co.criticalCount });
            const greenEnd = R0 + depth - tiers.length * third;
            if (greenEnd > R0 + 0.5) segments.push({ key: 'healthy', r0: R0, r1: greenEnd, color: PIE_COLORS.healthy });
            let edge = greenEnd;
            tiers.forEach((t, i) => {
              const outerR = i === tiers.length - 1 ? R1 : edge + third;
              segments.push({ key: t.key, r0: edge, r1: outerR, color: t.color, count: t.count });
              edge += third;
            });
          }
          const mid = (a0 + a1) / 2;
          return (
            <g
              key={co.id}
              className={`fleet-slice${co.online === false && !co.flaky && !co.critical ? ' offline' : ''}${co.critical ? ' is-critical' : ''}${co.flaky ? ' is-warn' : ''}${co.id === highlightId ? ' is-match' : ''}`}
              onMouseEnter={() => setHovered(co.id)}
              onClick={() => window.electron?.openCompany?.(co.id, windowKey === '1w' ? 'day' : 'hour')}
            >
              {segments.map((seg, si) => (
                <path
                  key={seg.key}
                  d={roundedRingSlicePath(CX, CY, seg.r0, seg.r1, a0, a1, si === segments.length - 1)}
                  fill={seg.color}
                />
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
              {/* ONE highlight around the whole slice perimeter (hover / match /
                  critical) — a single outline path spanning R0→R1, NOT a separate
                  box per coloured band. */}
              <path className="fleet-slice-outline" d={roundedRingSlicePath(CX, CY, R0, R1, a0, a1, true)} fill="none" />
            </g>
          );
        })}
      </svg>
      <div className={`fleet-center ${centerAccent}`}>
        {centerTitle && <span className="fleet-center-title">{centerTitle}</span>}
      </div>
    </div>
    {/* Time filters under the donut — clickable text (1hr / 1d / 1w) that refilter
        the pie over that window, mirroring the dashboard's time filter. */}
    <div className="fleet-filters" role="group" aria-label="Donut time range">
      {Object.keys(WINDOW_MS).map((k) => (
        <button
          key={k}
          type="button"
          className={`fleet-filter${k === windowKey ? ' is-active' : ''}`}
          onClick={() => setWindowKey(k)}
        >
          {k}
        </button>
      ))}
    </div>
    </>
  );
}

// Bottom-right dropdown of connections once tracked but now TAKEN OFF the network
// (the agent is alive but no longer publishing that connection's checks). They're
// hidden from the donut + main dashboard; their full history is preserved. Clicking
// one opens the main dashboard on that connection. Renders nothing while empty.
function HistoricalMenu() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => window.electron?.getHistoricalCompanies?.().then((list) => {
      if (!cancelled && Array.isArray(list)) setItems(list);
    }).catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  // The shovel is always present in the bottom-right; an empty dropdown just says so.
  return (
    <div className="historical-menu" onMouseLeave={() => setOpen(false)}>
      {open && (
        <div className="historical-list">
          {items.length === 0 ? (
            <div className="historical-empty">No historical connections</div>
          ) : (
            items.map((c) => (
              <button
                key={c.id}
                type="button"
                className="historical-item"
                title={`${c.label}${c.host ? ' · ' + c.host : ''} — no longer on the network`}
                onClick={() => { setOpen(false); window.electron?.openCompany?.(c.id, 'hour'); }}
              >
                <span className="historical-name">{conciseLabel(c.label)}</span>
                {c.host && <span className="historical-ip">{c.host}</span>}
              </button>
            ))
          )}
        </div>
      )}
      <button
        type="button"
        className={`icon-btn historical-fab${open ? ' is-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`Inactive connections (${items.length}) — no longer on the network`}
        aria-label="Inactive connections"
      >
        {/* Little shovel — "dig up" the historical record. Stroke icon, same family
            as the other popover .icon-btn glyphs. */}
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
             strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {/* Garden spade, tilted ~22° to dig lower-left: triangular D-handle grip +
              shaft + a square-mouth blade with a FLAT digging edge (the flat bottom &
              the foot-tread top edge are what stop it reading as a spoon). */}
          <g transform="rotate(-18 12 12)">
            <path d="M8.5 4h7" />
            <path d="M12 4v9" />
            <path d="M7 13h10l-.6 5.4a3 3 0 0 1-2.9 2.6h-3a3 3 0 0 1-2.9-2.6z" />
          </g>
        </svg>
      </button>
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

  // NOTE: the legacy single-status "peek" glance (the green ✓ "All good" pop-up)
  // is deleted on purpose — the fleet donut is the only status surface now, so
  // that window must NEVER render, in any mode. Do not reintroduce it.

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
      <HistoricalMenu />
    </div>
  );
}
