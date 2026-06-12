// Status feed — bridges the tray app's live monitor data (window.dashboard,
// exposed by dashboard-preload.js) into the dashboard widget data runtime.
//
// Loaded as a module script after app.js: the widget registry exists at module
// evaluation time, so the "status" widget type registers before the layout
// hydrates at DOMContentLoaded. The data runtime is created during boot, so
// ingestion waits for window.dashboardWidgetDataRuntime to appear.

import { applyPanelColor } from "./modules/panel-appearance-runtime.js";

// Canonical status palette — kept identical to the tray popover (src/App.css)
// so green / amber / red read the same on both surfaces.
const STATUS_COLORS = {
  green: "#32d74b",
  yellow: "#ffd60a",
  red: "#ff453a",
  grey: "#8e8e93",
  black: "#3a3a3c",
};

const STATUS_LABELS = {
  green: "All good",
  yellow: "Needs attention",
  red: "Source issue",
  grey: "Connecting…",
  black: "No updates",
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const formatTimestamp = (iso) => {
  if (!iso) return "";
  const time = new Date(iso);
  return Number.isFinite(time.getTime()) ? time.toLocaleString() : "";
};

// ─── Top-right status indicator + hover detail popover ─────────────────────────
// Replaces the in-grid status widget: a colored glass icon pinned to the
// top-right corner that expands on hover into a liquid-glass detail panel. The
// panel (.status-detail-popover) is registered as a WebGL glass target in
// liquid-glass-webgl.js so it shares the dashboard's real glass material.

function statusVisual() {
  const connection = state.connection || "grey";
  const visual = connection === "live" ? (state.status?.status || "grey") : connection;
  return {
    connection,
    visual,
    color: STATUS_COLORS[visual] || STATUS_COLORS.grey,
    label: STATUS_LABELS[visual] || "Unknown",
  };
}

// CSS :hover reveals the popover, but a pseudo-state change does not trip the
// WebGL mutation observer — poke it across a few frames so the glass refraction
// paints (and clears) as the panel fades in and out.
function pokeGlass() {
  const glass = window.LiquidGlassWebGL;
  if (!glass?.markDirty) return;
  let n = 0;
  const tick = () => { glass.markDirty(); if (++n < 8) requestAnimationFrame(tick); };
  tick();
}

let indicatorEls = null;

// The top-right status dot was retired — the stat cards, chart, and table
// carry the condition now. The indicator is never created; the update path
// below no-ops without elements.
function ensureStatusIndicator() {
  return null;
}

function updateStatusIndicator() {
  const els = ensureStatusIndicator();
  if (!els) return;
  const { color, label, connection, visual } = statusVisual();
  const current = state.status || {};
  els.cluster.style.setProperty("--status-color", color);
  els.cluster.classList.toggle("is-red", visual === "red");
  els.cluster.classList.toggle("is-connecting", visual === "grey");
  els.button.setAttribute("aria-label", `Monitor status: ${label}`);

  const detail = current.detail || (connection === "grey"
    ? "Waiting for the monitor connection…"
    : "No status details available yet.");
  const checkedAt = formatTimestamp(current.checkedAt);
  const lastSuccess = formatTimestamp(current.lastSuccess);
  const metaParts = [
    checkedAt ? `Checked ${checkedAt}` : "",
    lastSuccess ? `Last success ${lastSuccess}` : "",
  ].filter(Boolean);
  // Live MQTT but the REST history endpoint is unreachable — surface it.
  if (state.historyError && connection === "live") metaParts.push("History unavailable");

  // Recent-status timeline (one bar per check) + a one-line tally.
  const recent = state.history.slice(-24);
  const bars = recent.map((row) => {
    const barColor = STATUS_COLORS[row.status] || STATUS_COLORS.grey;
    return `<span class="status-detail-bar" style="--bar-color: ${barColor}"></span>`;
  }).join("");
  const counts = state.history.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  const total = state.history.length;
  const warnN = counts.yellow || 0;
  const incN = counts.red || 0;
  const summary = total
    ? `${counts.green || 0} healthy · ${warnN} warning${warnN === 1 ? "" : "s"} · ${incN} incident${incN === 1 ? "" : "s"}`
    : "";

  els.popover.innerHTML = `
    <span class="status-detail-title">
      <span class="status-detail-dot" aria-hidden="true"></span>
      ${escapeHtml(label)}
    </span>
    <span class="status-detail-body">${escapeHtml(detail)}</span>
    ${bars ? `<div class="status-detail-timeline" aria-hidden="true">${bars}</div>` : ""}
    ${summary ? `<span class="status-detail-meta">${escapeHtml(summary)}</span>` : ""}
    ${metaParts.length ? `<span class="status-detail-meta">${escapeHtml(metaParts.join(" · "))}</span>` : ""}
  `;
}

// Strip any in-grid status widget — from the default markup or a restored saved
// layout — so only the top-right indicator presents status.
function removeStatusWidgets() {
  document.querySelectorAll(
    '.widget-card[data-widget-key="widget-status"],' +
    '.widget-card[data-widget-type="status"],' +
    '.widget-card[data-widget-definition="status"],' +
    '.widget-card[data-dashboard-object-kind="status"]'
  ).forEach((el) => el.remove());
}

function watchForStatusWidgets() {
  removeStatusWidgets();
  // Saved layouts hydrate slightly after load; sweep for a short window then stop.
  const observer = new MutationObserver(() => removeStatusWidgets());
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 8000);
}

// Seed the chart widget's default axes so a freshly added graph renders the
// status timeline (avg status level over check date) with zero setup. Widgets
// merge their saved config OVER these defaults on every render, so any field
// the user sets explicitly in chart settings always wins; only unconfigured
// fields fall back to these values.
function seedChartDefaults() {
  const registry = window.dashboardWidgetRuntime;
  const definition = registry?.getWidgetDefinition?.("chart");
  if (!definition || definition.type !== "chart" || typeof registry.registerWidgetDefinition !== "function") return;
  const baseDefaults = definition.getDefaultConfig;
  registry.registerWidgetDefinition({
    ...definition,
    getDefaultConfig: () => ({
      ...(typeof baseDefaults === "function" ? baseDefaults() : {}),
      xField: "date",
      yField: "value",
      aggregation: "avg",
    }),
  });
}

function injectStatusIndicatorStyles() {
  if (document.getElementById("status-indicator-styles")) return;
  const style = document.createElement("style");
  style.id = "status-indicator-styles";
  style.textContent = `
    /* Top-right cluster, mirroring the top-left window-control-cluster. */
    .status-indicator-cluster {
      position: fixed;
      inset: 12px 14px auto auto;
      z-index: calc(var(--z-menu-overlay, 2600) + 20);
      -webkit-app-region: no-drag;
    }
    /* Reuse the glass control shell; the ::before becomes a colored status dot
     * instead of a masked icon. */
    .status-indicator-control::before {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--status-color, #8e8e93);
      box-shadow:
        0 0 7px var(--status-color, transparent),
        inset 0 1px 1px rgba(255, 255, 255, 0.45);
      mask: none;
      -webkit-mask: none;
      transition: background 0.4s ease, box-shadow 0.4s ease;
    }
    .status-detail-popover {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: 264px;
      padding: 12px 13px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      border-radius: 14px;
      color: #ffffff;
      opacity: 0;
      transform: translateY(-6px);
      pointer-events: none;
      transition: opacity 0.16s ease, transform 0.16s ease;
      /* Fallback frosted glass when the WebGL material is unavailable. */
      background: rgba(22, 24, 30, 0.86);
      -webkit-backdrop-filter: blur(30px) saturate(140%);
      backdrop-filter: blur(30px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.16);
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    }
    .status-indicator-cluster:hover .status-detail-popover,
    .status-indicator-cluster:focus-within .status-detail-popover {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    /* When the WebGL glass is active, drop the CSS fill so the shader-refracted
     * backdrop is the surface — matching panels and the window controls. */
    body.webgl-glass-on .status-detail-popover {
      background: transparent !important;
      -webkit-backdrop-filter: none !important;
      backdrop-filter: none !important;
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42);
      text-shadow: var(--dashboard-custom-text-shadow);
    }
    .status-detail-title {
      display: inline-flex;
      align-items: center;
      gap: 0.45em;
      font-size: var(--workspace-object-title-size, 22px);
      font-weight: var(--ui-text-weight);
      line-height: var(--workspace-object-title-line-height, 1);
      color: #ffffff;
      text-shadow: var(--dashboard-custom-text-shadow);
    }
    .status-detail-dot {
      width: 0.5em;
      height: 0.5em;
      border-radius: 50%;
      flex: none;
      background: var(--status-color, #8e8e93);
      box-shadow: 0 0 0.4em var(--status-color, transparent);
      transition: background 0.4s ease, box-shadow 0.4s ease;
    }
    /* Red draws the eye with a slow, low-amplitude glow breathe. */
    .status-indicator-cluster.is-red .status-indicator-control::before {
      animation: statusDotPulse 2.6s ease-in-out infinite;
    }
    @keyframes statusDotPulse {
      0%, 100% { box-shadow: 0 0 7px var(--status-color, transparent), inset 0 1px 1px rgba(255, 255, 255, 0.45); }
      50%      { box-shadow: 0 0 13px 1px var(--status-color, transparent), inset 0 1px 1px rgba(255, 255, 255, 0.45); }
    }
    /* Connecting: the dot becomes a quiet rotating arc (parity with the tray). */
    .status-indicator-cluster.is-connecting .status-indicator-control::before {
      background: transparent;
      border: 2px solid rgba(255, 255, 255, 0.25);
      border-top-color: rgba(255, 255, 255, 0.85);
      box-shadow: none;
      animation: statusSpin 0.9s linear infinite;
    }
    @keyframes statusSpin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .status-indicator-control::before,
      .status-detail-dot,
      .status-detail-popover { transition: none; }
      .status-indicator-cluster.is-red .status-indicator-control::before,
      .status-indicator-cluster.is-connecting .status-indicator-control::before { animation: none; }
    }
    .status-detail-body {
      font-size: 0.78rem;
      line-height: 1.35;
      color: #ffffff;
      text-shadow: var(--dashboard-custom-text-shadow);
    }
    .status-detail-meta {
      font-size: 0.68rem;
      opacity: 0.85;
      color: #ffffff;
      text-shadow: var(--dashboard-custom-text-shadow);
    }
    /* Recent-status timeline inside the hover panel: one bar per check. */
    .status-detail-timeline {
      display: flex;
      gap: 2px;
      height: 16px;
      margin-top: 2px;
    }
    .status-detail-bar {
      flex: 1 1 0;
      min-width: 2px;
      border-radius: 2px;
      background: var(--bar-color, #8e8e93);
      opacity: 0.92;
    }
    /* All widget text is always pure white (numbers + labels), regardless of
       status, theme ink, or per-tab accent. */
    .widget-card .stat-val,
    .widget-card .stat-lbl,
    .stat-card .stat-val,
    .stat-card .stat-lbl {
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
    }
  `;
  document.head.appendChild(style);
}

// ─── Data feed ────────────────────────────────────────────────────────────────

const state = {
  status: null,        // latest MQTT payload { status, stage, detail, lastSuccess, checkedAt }
  connection: "grey",  // 'grey' | 'live' | 'black'
  history: [],         // [{ id, checkedAt, status, stage, detail, lastSuccess }]
  historyError: false, // true when the most recent REST history fetch failed
};

// Readable check time for table display (the raw ISO checkedAt stays for
// sorting and any chart that needs a real timestamp).
const formatChecked = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  // "MM-DD HH:MM": readable yet sorts chronologically as a string, so a chart
  // using this field for its x-axis stays in time order.
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const formatDay = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  // "MM-DD": one bucket per day, sorts chronologically as a string.
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const historyRow = (entry) => ({
  date: entry.checkedAt,
  checkedAt: entry.checkedAt,
  // Epoch ms so "max(checkedAtMs)" finds the most recent event numerically
  // (drives the "Since down" card via the stat widget's `since` format).
  checkedAtMs: Number.isFinite(Date.parse(entry.checkedAt)) ? Date.parse(entry.checkedAt) : null,
  checked: formatChecked(entry.checkedAt),
  day: formatDay(entry.checkedAt),
  status: entry.status,
  // A ping is binary: it passed (healthy) or it did not.
  result: entry.status === "green" ? "Pass" : "Fail",
  machine: entry.machine || "",
  // Display columns for the history table: host IP, latency, and packet loss
  // broken out of the old combined "detail" string.
  ip: entry.host || "",
  ping: entry.latencyMs != null && entry.status !== "red" ? `${entry.latencyMs} ms` : "—",
  loss: entry.packetLossPct != null && entry.status !== "red" ? `${entry.packetLossPct}%` : "—",
  // Numeric latency (ms) for the stat cards; null/undefined for down pings.
  latencyMs: entry.latencyMs ?? null,
  packetLossPct: entry.packetLossPct ?? null,
  up: entry.up != null ? entry.up : (entry.status === "red" ? 0 : 1),
  stage: entry.stage || "",
  detail: entry.detail || "",
  lastSuccess: entry.lastSuccess || "",
  // Health score 0–100 (green healthy / yellow degraded / red down) so a chart
  // of avg(health) over time reads as an uptime/health trend.
  health: entry.status === "green" ? 100 : entry.status === "yellow" ? 50 : 0,
  // Kept for back-compat with any chart that referenced the old field.
  value: entry.status === "green" ? 100 : entry.status === "yellow" ? 50 : 0,
});

function currentStatusRow() {
  const payload = state.status || {};
  return {
    ...historyRow({ ...payload, checkedAt: payload.checkedAt || "" }),
    connection: state.connection,
    historyError: state.historyError,
  };
}

// ─── Per-company feed + tabs ──────────────────────────────────────────────────

const companyState = {
  companies: [],         // [{ id, label, status, checks }]
  active: null,          // active company id
  pingsById: new Map(),  // id -> [ping]
};

// Trim protocol/source noise from a tab title — "(ICMP)", "(TCP 23)",
// "(from … NOC)" — while keeping meaningful parentheticals like a location
// "(H St.)". The full name stays available via the tab's title tooltip.
const conciseLabel = (s) => {
  const trimmed = String(s || "")
    .replace(/\s*\((?:ICMP|TCP|UDP|HTTP|HTTPS|from\b)[^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed || String(s || "");
};

// One company's pings → widget rows (the shape the widgets already read).
function rowsForActive() {
  return (companyState.pingsById.get(companyState.active) || []).map(historyRow);
}

// ─── Adaptive card status colors ────────────────────────────────────────────
// Stat cards tint green/yellow/red through the existing per-object recolor
// system (applyPanelColor + the preset palette colors), with thresholds derived
// from the link's own baseline rather than fixed numbers: a circuit that always
// runs 80ms stays green at 90ms, while a 5ms link spiking to 90ms reads red.
// Cards the user explicitly recolored (panelColorUser) are left alone.

const ADAPTIVE_STATUS_COLORS = { green: "#16a34a", yellow: "#ca8a04", red: "#dc2626" };

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const average = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);

// Mirror the widget runtime's timeframe scoping so a card's color judges the
// same rows its number aggregates.
const timeframeScopedRows = (rows) => {
  const range = window.dashboardTimeframeRuntime?.activeRange?.("builder");
  if (!range?.start && !range?.end) return rows;
  const bound = (value, dayEnd) => {
    if (!value) return dayEnd ? Infinity : -Infinity;
    return String(value).includes("T")
      ? Date.parse(value)
      : Date.parse(`${value}T${dayEnd ? "23:59:59.999" : "00:00:00"}`);
  };
  const start = bound(range.start, false);
  const end = bound(range.end, true);
  if (!Number.isFinite(start) && !Number.isFinite(end)) return rows;
  return rows.filter((row) => row.checkedAtMs == null || (row.checkedAtMs >= start && row.checkedAtMs <= end));
};

function applyAdaptiveCardColors(allRows = rowsForActive()) {
  const broader = allRows || [];
  const rows = timeframeScopedRows(broader);
  const lastRow = rows[rows.length - 1] || null;
  const downNow = lastRow?.status === "red";

  // Each card's own aggregate over the SELECTED window is judged against the
  // broader trend (every buffered ping for this company), so "high for this
  // link" is relative — a steady 80ms link reads green at 90ms while a 5ms
  // link spiking to 90ms reads red, and a max far above the average goes
  // yellow even when the average itself looks fine.
  const windowLat = rows.map((r) => r.latencyMs).filter((v) => v != null);
  const broadLat = broader.map((r) => r.latencyMs).filter((v) => v != null);
  const windowLoss = rows.map((r) => r.packetLossPct).filter((v) => v != null);
  const broadLoss = broader.map((r) => r.packetLossPct).filter((v) => v != null);
  const fails = rows.filter((r) => r.status === "red");
  const total = rows.length;

  const wAvg = average(windowLat);
  const bAvg = average(broadLat) ?? wAvg;
  const wMin = windowLat.length ? Math.min(...windowLat) : null;
  const bMin = broadLat.length ? Math.min(...broadLat) : wMin;
  const wMax = windowLat.length ? Math.max(...windowLat) : null;
  const wLossAvg = average(windowLoss);
  const bLossAvg = average(broadLoss) ?? 0;
  const wLossMin = windowLoss.length ? Math.min(...windowLoss) : null;
  const wLossMax = windowLoss.length ? Math.max(...windowLoss) : null;
  const lastFailMs = fails.length ? fails[fails.length - 1].checkedAtMs : null;
  const sinceFailMs = lastFailMs != null ? Date.now() - lastFailMs : null;
  const uptimePct = total ? (rows.filter((r) => r.up).length / total) * 100 : null;
  const failRate = total ? (fails.length / total) * 100 : null;

  const latencyAvgStatus = wAvg == null || bAvg == null ? null
    : wAvg <= bAvg * 1.35 + 8 ? "green"
      : wAvg <= bAvg * 2.2 + 25 ? "yellow"
        : "red";
  const lossAvgStatus = wLossAvg == null ? null
    : wLossAvg <= Math.max(0.5, bLossAvg * 1.5 + 0.5) ? "green"
      : wLossAvg <= Math.max(5, bLossAvg * 3 + 2) ? "yellow"
        : "red";

  const statuses = {
    // Window average vs the broader average trend.
    "latency-avg": latencyAvgStatus,
    // Window floor vs the broader floor: the whole link got slower if even the
    // best-case ping rises well above the usual minimum.
    "latency-min": wMin == null || bMin == null ? null
      : wMin <= bMin * 1.6 + 8 ? "green"
        : wMin <= bMin * 3 + 30 ? "yellow"
          : "red",
    // Window peak vs the window's own average (with broader-average slack):
    // a max far above the typical ping reads yellow, extreme spikes red.
    "latency-max": wMax == null || wAvg == null ? null
      : wMax <= Math.max(wAvg * 1.8 + 15, bAvg * 2 + 20) ? "green"
        : wMax <= Math.max(wAvg * 6 + 60, bAvg * 8 + 80) ? "yellow"
          : "red",
    "loss-avg": lossAvgStatus,
    // Any persistent floor of packet loss is trouble.
    "loss-min": wLossMin == null ? null
      : wLossMin <= 0.5 ? "green" : wLossMin <= 2 ? "yellow" : "red",
    "loss-max": wLossMax == null ? null
      : wLossMax <= Math.max(1, bLossAvg * 2 + 1) ? "green"
        : wLossMax <= 10 ? "yellow"
          : "red",
    uptime: uptimePct == null ? null
      : uptimePct >= 99.5 ? "green" : uptimePct >= 97 ? "yellow" : "red",
    // Any fail in the window is a red card — failures are never "a little bad".
    fails: failRate == null ? null
      : (downNow || fails.length > 0) ? "red" : "green",
    sincedown: total === 0 ? null
      : downNow ? "red"
        : sinceFailMs == null || sinceFailMs >= 4 * 3600000 ? "green"
          : sinceFailMs >= 30 * 60000 ? "yellow"
            : "red",
  };
  // Back-compat for configs saved before the per-card modes existed.
  statuses.latency = latencyAvgStatus;
  statuses.loss = lossAvgStatus;

  document.querySelectorAll('.widget-card[data-widget-type="tracker"], .widget-card[data-widget-definition="stat"]').forEach((card) => {
    let mode = "";
    let metric = "";
    try {
      const cfg = JSON.parse(card.dataset.widgetConfig || "{}") || {};
      mode = cfg.statusMode || "";
      metric = cfg.metric || "";
    } catch {}
    // Generic legacy modes ("latency"/"loss" from configs saved before the
    // per-card modes existed) resolve to the card's own metric, so a max card
    // is judged as a max, not as an average.
    if ((mode === "latency" || mode === "loss") && ["avg", "min", "max"].includes(metric)) {
      mode = `${mode}-${metric}`;
    }
    if (!mode || !(mode in statuses)) return;
    if (card.dataset.panelColorUser === "true") return; // user picked a color — keep it
    const status = statuses[mode];
    if (!status) {
      if (card.dataset.adaptiveStatus) {
        delete card.dataset.adaptiveStatus;
        applyPanelColor(card, null);
      }
      return;
    }
    if (card.dataset.adaptiveStatus === status) return;
    card.dataset.adaptiveStatus = status;
    applyPanelColor(card, ADAPTIVE_STATUS_COLORS[status]);
  });
}

// Feed the active company's pings to the metric cards (configured in the markup)
// + the standalone timeline/table. The runtime aggregates over the
// timeframe-filtered rows, so every number tracks the selected time range.
function publish() {
  const dataRuntime = window.dashboardWidgetDataRuntime;
  if (!dataRuntime?.ingest) return;
  const rows = rowsForActive();
  // Latency/loss cards only see pings that actually responded; down pings have
  // no latency and would otherwise skew avg/min toward 0.
  const latencyRows = rows.filter((r) => r.latencyMs != null);
  const failRows = rows.filter((r) => r.status === "red");
  // Stamp each ping with a three-level condition for the timeline chart:
  // red strictly for downtime, yellow for degraded (packet loss, or latency
  // far above this link's broader average), green otherwise. Each row also
  // carries its delta vs the broader averages for the table's Δ columns.
  const baselineAvg = average(latencyRows.map((r) => r.latencyMs));
  const baselineLossAvg = average(latencyRows.map((r) => r.packetLossPct).filter((v) => v != null));
  const signed = (value) => (value > 0 ? `+${value}` : `${value}`);
  rows.forEach((r) => {
    r.level = r.status === "red" ? "red"
      : (r.status === "yellow"
        || Number(r.packetLossPct) > 0
        || (baselineAvg != null && r.latencyMs != null && r.latencyMs > Math.max(baselineAvg * 2.2 + 25, 40))) ? "yellow"
        : "green";
    r["Δ ping"] = r.latencyMs != null && baselineAvg != null
      ? signed(Math.round(r.latencyMs - baselineAvg)) : "—";
    r["Δ loss"] = r.packetLossPct != null && baselineLossAvg != null
      ? signed(Math.round((r.packetLossPct - baselineLossAvg) * 10) / 10) : "—";
  });
  // Broader-trend baselines for the avg stat cards' muted "+13"-style deltas.
  const baselineMeta = { baselines: { latencyMs: baselineAvg, packetLossPct: baselineLossAvg } };
  dataRuntime.ingest({
    default: { rows }, // standalone timeline + table
    types: { status: { rows: rows.length ? [rows[rows.length - 1]] : [currentStatusRow()] } },
    widgets: {
      "widget-uptime": { rows },                // Uptime %   = avg(up)
      "widget-avgms": { rows: latencyRows, meta: baselineMeta },  // Avg ms = avg(latencyMs) + Δ vs broader
      "widget-minms": { rows: latencyRows },    // Min ms     = min(latencyMs)
      "widget-maxms": { rows: latencyRows },    // Max ms     = max(latencyMs)
      "widget-loss": { rows: latencyRows, meta: baselineMeta },   // Avg loss % = avg(packetLossPct) + Δ vs broader
      "widget-lossmin": { rows: latencyRows },  // Min loss % = min(packetLossPct)
      "widget-lossmax": { rows: latencyRows },  // Max loss % = max(packetLossPct)
      "widget-fails": { rows: failRows },       // Fails      = count(down)
      "widget-sincedown": { rows: failRows },   // Since down = max(checkedAtMs) of fails
    },
  });
  applyAdaptiveCardColors(rows);
}

let publishTimer = null;
function publishSoon() {
  if (publishTimer) return;
  publishTimer = setTimeout(() => { publishTimer = null; publish(); }, 250);
}

async function loadCompanyHistory(id) {
  try {
    const res = await window.dashboard.getCompanyHistory(id, 2000);
    if (res?.ok && Array.isArray(res.results)) companyState.pingsById.set(id, res.results);
  } catch {}
}

// Slide the dashboard content in from the direction of travel (1 = next/right,
// -1 = prev/left) for a little swipe between companies. Rapid stepping (held
// arrow key) skips the slide — restarting a full-grid animation every key
// repeat is what tanked the frame rate.
let lastSwitchAnimAt = 0;
function animateCompanySwitch(dir) {
  const grid = document.querySelector(".dashboard-layout-grid");
  if (!grid || !dir) return;
  const now = performance.now();
  if (now - lastSwitchAnimAt < 320) return;
  lastSwitchAnimAt = now;
  const cls = dir < 0 ? "company-switch-prev" : "company-switch-next";
  grid.classList.remove("company-switch-prev", "company-switch-next");
  void grid.offsetWidth; // restart the animation
  grid.classList.add(cls);
  setTimeout(() => grid.classList.remove(cls), 300);
}

async function setActiveCompany(id) {
  if (!id || id === companyState.active) return;
  const all = companyState.companies;
  const from = all.findIndex((c) => c.id === companyState.active);
  const to = all.findIndex((c) => c.id === id);
  const dir = (from < 0 || to < 0) ? 1 : Math.sign(to - from);
  companyState.active = id;
  renderCompanyTabs();
  if (!(companyState.pingsById.get(id) || []).length) await loadCompanyHistory(id);
  // Debounced: stepping quickly through companies coalesces into one final
  // data publish instead of re-rendering every widget per key repeat.
  publishSoon();
  animateCompanySwitch(dir);
}

// ── Company tab bar (scrollable, with "…" overflow menus on each end) ──────────

let companyCssInjected = false;
function injectCompanyCss() {
  if (companyCssInjected) return;
  companyCssInjected = true;
  const style = document.createElement("style");
  // Company tabs are pure text in a stepped hierarchy — the active company is
  // the largest, highest, and white with its full name; its neighbours step
  // down in size, position, and brightness (grey, truncated) on each side,
  // exactly the unselected-grey / selected-white language the timeframe
  // controls use. No underline, no accent hue. The "…" overflow stays as a
  // text control opening a glass menu.
  style.textContent = `
  .company-tab-bar{ display:flex; align-items:flex-start; justify-content:center; gap:14px; width:min(100%, 1100px); max-width:100%; margin:6px auto 0; box-sizing:border-box; padding:0 6px; overflow:hidden; }
  .company-tab-scroller{ display:inline-flex; align-items:flex-start; min-width:0; transform:translateX(0); transition:transform .3s cubic-bezier(.25,.8,.3,1); will-change:transform; }
  .company-tab{
    flex:0 0 auto;
    appearance:none !important; -webkit-appearance:none !important;
    display:inline-block !important;
    border:0 !important; background:transparent !important; background-color:transparent !important;
    box-shadow:none !important; outline:0 !important; filter:none !important;
    min-height:0 !important; padding:0 2px !important; border-radius:0 !important;
    margin:0 clamp(8px,1.2vw,14px);
    font:inherit; font-weight:650; line-height:1.15; letter-spacing:.01em;
    color:rgba(255,255,255,0.46);
    text-shadow:var(--dashboard-custom-text-shadow);
    text-decoration:none !important;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    cursor:pointer;
    /* Only composited properties animate (position, colour, opacity) — sizes
       and widths snap instantly, so rapid switching never thrashes layout.
       The smooth motion comes from each tab gliding to its tier height while
       the whole row glides horizontally to centre the selection. */
    transition:
      color .26s ease,
      transform .26s cubic-bezier(.25,.8,.3,1),
      opacity .22s ease;
  }
  .company-tab.tier-0{ font-size:24px; color:#ffffff; transform:translateY(0); max-width:320px; }
  .company-tab.tier-1{ font-size:16px; color:rgba(255,255,255,0.52); transform:translateY(6px); max-width:130px; }
  .company-tab.tier-2{ font-size:13px; color:rgba(255,255,255,0.36); transform:translateY(10px); max-width:95px; }
  .company-tab.tier-off{ font-size:13px; color:rgba(255,255,255,0); transform:translateY(10px); max-width:0; margin:0; padding:0 !important; opacity:0; pointer-events:none; }
  .company-tab:hover, .company-tab:focus-visible{ color:rgba(255,255,255,0.9); }
  .company-tab.tier-0:hover{ color:#ffffff; }
  .company-tab.is-offline{ opacity:.4; }
  .company-tab.tier-off.is-offline{ opacity:0; }
  .company-overflow-item.is-offline{ color:rgba(255,255,255,0.4); }
  .company-overflow{
    flex:0 0 auto; align-self:flex-start;
    appearance:none !important; -webkit-appearance:none !important;
    border:0 !important; background:transparent !important; box-shadow:none !important;
    filter:none !important; min-height:0 !important; padding:0 4px !important;
    color:rgba(255,255,255,0.36); font:inherit; font-size:14px; font-weight:650; line-height:1.15;
    transform:translateY(10px);
    text-shadow:var(--dashboard-custom-text-shadow);
    cursor:pointer; transition:color .18s ease;
  }
  .company-overflow:hover{ color:rgba(255,255,255,0.9); background:transparent !important; }
  .company-overflow[hidden]{ display:none !important; }
  .company-overflow-menu{
    position:fixed; z-index:9999; max-height:62vh; overflow-y:auto;
    background:linear-gradient(180deg, rgba(22,26,36,0.62), rgba(12,16,24,0.55));
    -webkit-backdrop-filter:blur(26px) saturate(140%); backdrop-filter:blur(26px) saturate(140%);
    border:1px solid rgba(255,255,255,0.22); border-radius:14px; padding:8px 6px;
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.24), 0 18px 42px rgba(0,0,0,0.4);
    display:flex; flex-direction:column; gap:2px; min-width:210px;
  }
  .company-overflow-item{
    display:block; appearance:none !important; -webkit-appearance:none !important;
    padding:7px 12px !important; border:0 !important; background:transparent !important;
    box-shadow:none !important; filter:none !important; min-height:0 !important;
    color:rgba(255,255,255,0.6); font:inherit; font-size:0.95rem; font-weight:600;
    text-shadow:var(--dashboard-custom-text-shadow);
    text-align:left; border-radius:8px; cursor:pointer; white-space:nowrap;
    transition:color .14s ease;
  }
  .company-overflow-item:hover{ background:transparent !important; color:#ffffff; }
  @keyframes company-slide-next{ from{ transform:translateX(30px); opacity:.25; } to{ transform:translateX(0); opacity:1; } }
  @keyframes company-slide-prev{ from{ transform:translateX(-30px); opacity:.25; } to{ transform:translateX(0); opacity:1; } }
  .dashboard-layout-grid.company-switch-next{ animation:company-slide-next 260ms cubic-bezier(.22,1,.36,1); }
  .dashboard-layout-grid.company-switch-prev{ animation:company-slide-prev 260ms cubic-bezier(.22,1,.36,1); }
  @media (prefers-reduced-motion: reduce){ .dashboard-layout-grid.company-switch-next, .dashboard-layout-grid.company-switch-prev{ animation:none !important; } }`;
  document.head.appendChild(style);
}

let companyMenuOpen = null;
function closeOverflowMenu() {
  companyMenuOpen?.remove();
  companyMenuOpen = null;
  document.removeEventListener("click", onDocClickForMenu, true);
}
function onDocClickForMenu(e) {
  if (companyMenuOpen && !companyMenuOpen.contains(e.target) && !e.target.closest(".company-overflow")) closeOverflowMenu();
}
function offscreenCompanies(side) {
  const bar = document.querySelector(".company-tab-bar"); if (!bar) return [];
  return (side === "left" ? bar._leftHidden : bar._rightHidden) || [];
}
function openOverflowMenu(side, anchor) {
  if (companyMenuOpen) { closeOverflowMenu(); return; }
  const ids = offscreenCompanies(side);
  if (!ids.length) return;
  const menu = document.createElement("div");
  menu.className = "company-overflow-menu";
  for (const id of ids) {
    const co = companyState.companies.find((c) => c.id === id); if (!co) continue;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "company-overflow-item" + (co.online === false ? " is-offline" : "");
    item.textContent = conciseLabel(co.label);
    item.title = co.online === false ? `${co.label} — offline` : co.label;
    item.addEventListener("click", () => { closeOverflowMenu(); setActiveCompany(id); });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 4)}px`;
  if (side === "left") menu.style.left = `${Math.round(r.left)}px`;
  else menu.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  companyMenuOpen = menu;
  setTimeout(() => document.addEventListener("click", onDocClickForMenu, true), 0);
}
// Only a window of tabs is shown at once; the rest live behind the "…" menus.
// Five visible = the active company centred with two stepped tiers per side.
const VISIBLE_COMPANY_TABS = 5;

function renderCompanyTabs() {
  injectCompanyCss();
  const wsBar = document.querySelector(".workspace-tab-bar");
  if (wsBar) wsBar.style.display = "none"; // company tabs take over the tab strip
  let bar = document.querySelector(".company-tab-bar");
  if (!bar) {
    bar = document.createElement("nav");
    bar.className = "company-tab-bar";
    bar.setAttribute("aria-label", "Companies");
    bar.innerHTML = '<button class="company-overflow company-overflow-left" type="button" aria-label="More companies (left)" hidden>…</button>'
      + '<div class="company-tab-scroller"></div>'
      + '<button class="company-overflow company-overflow-right" type="button" aria-label="More companies (right)" hidden>…</button>';
    (wsBar?.parentElement || document.querySelector(".page") || document.body).insertBefore(bar, wsBar || null);
    bar.querySelector(".company-overflow-left").addEventListener("click", (e) => openOverflowMenu("left", e.currentTarget));
    bar.querySelector(".company-overflow-right").addEventListener("click", (e) => openOverflowMenu("right", e.currentTarget));
  }
  const all = companyState.companies;
  const n = all.length;
  let active = all.findIndex((c) => c.id === companyState.active);
  if (active < 0) active = 0;
  // Window of VISIBLE tabs centred on the active company where possible.
  const start = Math.min(Math.max(0, active - 2), Math.max(0, n - VISIBLE_COMPANY_TABS));
  const end = Math.min(n, start + VISIBLE_COMPANY_TABS);
  bar._leftHidden = all.slice(0, start).map((c) => c.id);
  bar._rightHidden = all.slice(end).map((c) => c.id);
  bar.querySelector(".company-overflow-left").hidden = start <= 0;
  bar.querySelector(".company-overflow-right").hidden = end >= n;
  // Reconcile persistent buttons instead of rebuilding: every company keeps
  // its element (off-window ones collapse to zero width), so tier changes
  // ANIMATE — the hierarchy rolls across the row like a wave instead of
  // snapping, even when flipping through companies quickly.
  const scroller = bar.querySelector(".company-tab-scroller");
  if (!scroller._tabsById) scroller._tabsById = new Map();
  const tabsById = scroller._tabsById;
  for (const [id, el] of [...tabsById]) {
    if (!all.some((c) => c.id === id)) { el.remove(); tabsById.delete(id); }
  }
  all.forEach((co, index) => {
    let b = tabsById.get(co.id);
    if (!b) {
      b = document.createElement("button");
      b.type = "button";
      b.dataset.companyId = co.id;
      b.addEventListener("click", () => setActiveCompany(co.id));
      tabsById.set(co.id, b);
    }
    const isActive = co.id === companyState.active;
    const inWindow = index >= start && index < end;
    // Visual hierarchy: tier 0 = active (largest, highest, white, full name);
    // tiers 1 and 2 step down in size, position, and brightness, truncated;
    // off-window tabs collapse away entirely.
    const tier = inWindow ? Math.min(Math.abs(index - active), 2) : "off";
    b.className = `company-tab tier-${tier}` + (co.online === false ? " is-offline" : "");
    b.setAttribute("aria-pressed", String(isActive));
    b.setAttribute("aria-hidden", String(!inWindow));
    b.setAttribute("tabindex", isActive ? "0" : "-1");
    b.title = co.online === false ? `${co.label} — offline` : co.label; // full name on hover
    b.textContent = conciseLabel(co.label);
    if (scroller.children[index] !== b) scroller.insertBefore(b, scroller.children[index] || null);
  });
  while (scroller.children.length > all.length) scroller.lastChild.remove();
  // True centring: sizes snap instantly, so the active tab's final geometry is
  // measurable right away — glide the whole row (one composited translateX)
  // until the selected tab's centre sits exactly on the bar's centre. The
  // shift is clamped so the row never detaches from the bar at the periphery.
  requestAnimationFrame(() => {
    if (!scroller.isConnected) return;
    const activeEl = tabsById.get(companyState.active);
    if (!activeEl || activeEl.classList.contains("tier-off")) return;
    // Compensate with the LIVE transform (the row may be mid-glide when
    // stepping quickly), so the measured natural geometry is always exact.
    let liveShift = 0;
    try { liveShift = new DOMMatrixReadOnly(getComputedStyle(scroller).transform).m41 || 0; } catch {}
    const barRect = bar.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const tabRect = activeEl.getBoundingClientRect();
    const naturalTabCenter = (tabRect.left + tabRect.width / 2) - liveShift;
    let shift = (barRect.left + barRect.width / 2) - naturalTabCenter;
    const naturalLeft = scrollerRect.left - liveShift;
    const naturalRight = scrollerRect.right - liveShift;
    if (naturalRight - naturalLeft < barRect.width - 12) {
      const minShift = (barRect.left + 6) - naturalLeft;
      const maxShift = (barRect.right - 6) - naturalRight;
      shift = Math.min(Math.max(shift, Math.min(minShift, maxShift)), Math.max(minShift, maxShift));
    }
    scroller.style.transform = `translateX(${Math.round(shift)}px)`;
  });
}

async function startFeed() {
  const bridge = window.dashboard;
  if (!bridge) { console.warn("[status-feed] window.dashboard bridge unavailable — no live data."); return; }

  try {
    const snapshot = await bridge.getStatus();
    if (snapshot?.status) state.status = snapshot.status;
    if (snapshot?.connectionState) state.connection = snapshot.connectionState;
  } catch {}
  updateStatusIndicator();

  try {
    const list = await bridge.getCompanies?.();
    if (Array.isArray(list)) companyState.companies = list;
  } catch {}
  if (companyState.companies.length) {
    // Default to a live company so the dashboard opens on real data, not an offline tab.
    companyState.active = companyState.active
      || (companyState.companies.find((c) => c.online !== false) || companyState.companies[0]).id;
    await loadCompanyHistory(companyState.active);
  }
  renderCompanyTabs();
  publish();

  // ← / → flip between companies (skip while typing or with a menu/modifier).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable
      || (t.closest && t.closest('[contenteditable="true"], [data-inline-text-editing="true"]')))) return;
    if (companyMenuOpen) return;
    const all = companyState.companies;
    if (!all.length) return;
    let i = all.findIndex((c) => c.id === companyState.active);
    if (i < 0) i = 0;
    const n = all.length;
    const next = e.key === "ArrowLeft" ? (i - 1 + n) % n : (i + 1) % n;
    e.preventDefault();
    setActiveCompany(all[next].id);
  });

  // Re-judge the adaptive card colors whenever the timeframe selection changes
  // (the widget numbers re-render through the runtime; colors follow here).
  window.dashboardTimeframeRuntime?.subscribe?.(() => applyAdaptiveCardColors());

  bridge.onConnection((cs) => { state.connection = cs; updateStatusIndicator(); });
  bridge.onStatus((payload) => { state.status = payload; updateStatusIndicator(); });
  bridge.onCheck?.(({ companyId, ping }) => {
    if (companyId !== companyState.active || !ping) return;
    let buf = companyState.pingsById.get(companyId);
    if (!buf) { buf = []; companyState.pingsById.set(companyId, buf); }
    buf.push(ping);
    if (buf.length > 3000) buf.splice(0, buf.length - 3000);
    publishSoon();
  });

  // Refresh the company list + per-tab statuses every 30s.
  setInterval(async () => {
    try {
      const list = await bridge.getCompanies?.();
      if (Array.isArray(list) && list.length) { companyState.companies = list; renderCompanyTabs(); }
    } catch {}
  }, 30000);
}

function whenDataRuntimeReady(callback, timeoutMs = 15000) {
  const startedAt = Date.now();
  const poll = () => {
    if (window.dashboardWidgetDataRuntime?.ingest) {
      callback();
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      console.warn("[status-feed] dashboard widget data runtime never appeared.");
      return;
    }
    setTimeout(poll, 50);
  };
  poll();
}

// Mirror the dashboard's background choice (kept in this window's
// localStorage by background-controller.js) into the file-backed layout
// store, where the main process reads it to build the tray popover's
// liquid-glass backdrop. Event-driven via the data-background attribute the
// controller sets on <html> whenever the background changes.
function mirrorBackgroundPreference() {
  const store = window.dashboardPersistence;
  if (!store?.setItem) return;
  const mirror = () => {
    try {
      const value = localStorage.getItem("dashboard-background");
      if (value && store.getItem("dashboard-background") !== value) {
        store.setItem("dashboard-background", value);
      }
    } catch {}
  };
  mirror();
  new MutationObserver(mirror).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-background"],
  });
}

seedChartDefaults();
injectStatusIndicatorStyles();
ensureStatusIndicator();
updateStatusIndicator();
watchForStatusWidgets();
mirrorBackgroundPreference();
whenDataRuntimeReady(() => { startFeed(); });
