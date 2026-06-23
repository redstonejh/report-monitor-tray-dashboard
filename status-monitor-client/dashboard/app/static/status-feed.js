// Status feed — bridges the tray app's live monitor data (window.dashboard,
// exposed by dashboard-preload.js) into the dashboard widget data runtime.
//
// Loaded as a module script after app.js: the widget registry exists at module
// evaluation time, so the "status" widget type registers before the layout
// hydrates at DOMContentLoaded. The data runtime is created during boot, so
// ingestion waits for window.dashboardWidgetDataRuntime to appear.

import { applyPanelColor } from "./modules/panel-appearance-runtime.js";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

// Strip any in-grid status widget — from the default markup or a restored saved
// layout — so status surfaces only through the stat cards, chart, and table.
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
  pingsById: new Map(),  // id -> [ping]  (full-resolution, last 7 days)
  rollupsById: new Map(), // id -> [{ h, g, y, d, latN, latSum, latMin, latMax, lossN, lossSum, lossMax }] hourly, > 7 days
};

// Hourly rollups for data older than the raw window, exposed for the chart so it
// can draw the full history. Each hour carries consensus green/yellow/down MINUTE
// counts (g/y/d) — the exact stacked-bar inputs — plus latency/loss stats.
window.dashboardRollups = {
  forActive: () => companyState.rollupsById.get(companyState.active) || [],
  forCompany: (id) => companyState.rollupsById.get(id) || [],
};

// Specific display-name shortenings (matched case-insensitively after trimming).
const LABEL_RENAMES = {
  "omv server": "OMV",
  "boiler opacity pc": "Boiler",
  "actfax server": "Actfax",
};
// Trim protocol/source noise from a tab title — "(ICMP)", "(TCP 23)",
// "(from … NOC)" — while keeping meaningful parentheticals like a location
// "(H St.)". The full name stays available via the tab's title tooltip.
const conciseLabel = (s) => {
  const trimmed = String(s || "")
    .replace(/\s*\((?:ICMP|TCP|UDP|HTTP|HTTPS|from\b)[^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return LABEL_RENAMES[trimmed.toLowerCase()] || trimmed || String(s || "");
};

// One company's pings → widget rows (the shape the widgets already read).
function rowsForActive() {
  return (companyState.pingsById.get(companyState.active) || []).map(historyRow);
}

// ─── Viewer redundancy / consensus ────────────────────────────────────────────
// A WAN circuit can be watched from several vantage points ("viewers"), encoded
// in the check label as "(from X)" — e.g. "Grayson Fiber (from STL)". When a
// target is watched by >1 viewer the GRAPHS (bar chart + donut) show a DERIVED
// consensus condition rather than any single viewer's pings, while each viewer
// keeps its own table panel.

// Each viewer's source IP is derived in the main process from that location's
// own tracked circuit (window.dashboard.getViewerIps → viewer name → IP), kept
// in `viewerIpMap`. VIEWER_IPS is an optional manual OVERRIDE (exact "(from X)"
// name → IP) for anything the derivation can't resolve.
const VIEWER_IPS = {};
let viewerIpMap = {};
// The active circuit's target host, shown above the selected company tab. Set by
// publish() (which knows the host once history loads) and read by renderCompanyTabs.
let activeCircuitHost = "";

// Pull the vantage-point name out of a check label; "(from Eureka NOC)" → "Eureka NOC".
function viewerOf(machine) {
  const m = String(machine || "").match(/\(from ([^)]*)\)/i);
  return (m && m[1].trim()) || "Primary";
}
function viewerSlug(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "primary";
}
// Distinct viewer names present in a row set, in first-seen order.
function viewersIn(rows) {
  const seen = [];
  for (const r of rows) { const v = viewerOf(r.machine); if (!seen.includes(v)) seen.push(v); }
  return seen;
}

// Combine every viewer's pings into one consensus row per minute bucket:
//   RED    if >=50% of the target's viewers report a failure (down),
//   YELLOW if (not red and) any viewer is down OR degraded — a minority outage
//          or any packet loss is a discrepancy worth surfacing, not green,
//   GREEN  otherwise.
// Returns rows in the same shape historyRow() produces (status + level) so the
// chart + donut consume them unchanged. Minute buckets match the chart's finest
// (ping) granularity, so consensus aligns with the bar chart one-to-one.
function deriveConsensusRows(rows, targetLabel) {
  const totalViewers = viewersIn(rows).length || 1;
  const worse = { green: 0, yellow: 1, red: 2 };
  const levelOf = (r) => r.level || (r.status === "red" ? "red" : r.status === "yellow" ? "yellow" : "green");
  // bucketMs -> Map<viewer, worstLevelThatMinute>
  const buckets = new Map();
  for (const r of rows) {
    const t = Date.parse(r.checkedAt);
    if (!Number.isFinite(t)) continue;
    const ms = Math.floor(t / 60000) * 60000;
    let votes = buckets.get(ms);
    if (!votes) { votes = new Map(); buckets.set(ms, votes); }
    const viewer = viewerOf(r.machine);
    const lvl = levelOf(r);
    const prev = votes.get(viewer);
    if (prev == null || worse[lvl] > worse[prev]) votes.set(viewer, lvl);
  }
  const out = [];
  for (const ms of [...buckets.keys()].sort((a, b) => a - b)) {
    const votes = [...buckets.get(ms).values()];
    const fails = votes.filter((v) => v === "red").length;
    const status = (fails / totalViewers) >= 0.5 ? "red"
      : (fails > 0 || votes.some((v) => v === "yellow")) ? "yellow"
        : "green";
    const row = historyRow({
      checkedAt: new Date(ms).toISOString(),
      status,
      machine: targetLabel || "",
      // Consensus has no single latency/loss — leave them null so nothing reads
      // a misleading number from one viewer.
      latencyMs: null,
      packetLossPct: null,
      up: status === "red" ? 0 : 1,
    });
    row.level = status;
    out.push(row);
  }
  return out;
}

// ─── Adaptive card status colors ────────────────────────────────────────────
// Stat cards tint green/yellow/red through the existing per-object recolor
// system (applyPanelColor + the preset palette colors), with thresholds derived
// from the link's own baseline rather than fixed numbers: a circuit that always
// runs 80ms stays green at 90ms, while a 5ms link spiking to 90ms reads red.
// Cards the user explicitly recolored (panelColorUser) are left alone.

const ADAPTIVE_STATUS_COLORS = { green: "#16a34a", yellow: "#ca8a04", red: "#dc2626" };

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

// ── Per-viewer panels (redundancy) ────────────────────────────────────────────
// For a multi-viewer target, each viewer gets its OWN real builder panel (drag /
// resize / collapse / rename / colour / delete) holding a real table widget,
// created through the dashboard's actual panel/widget pipeline
// (window.dashboardViewerPanels, defined in app.js). publish() feeds each table
// by its data-widget-key "vt-<companyId>-<slug>". Pass [] to tear them down.
function renderViewerTablePanels(companyId, viewers) {
  window.dashboardViewerPanels?.sync(companyId, viewers);
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

  // Redundancy: when this target is watched by >1 viewer, the GRAPHS (bar chart
  // + donut, fed via `default`) show a derived consensus condition, and each
  // viewer gets its own table panel. Single-viewer targets behave as before.
  const viewers = viewersIn(rows);
  const multi = viewers.length > 1;
  const activeCo = companyState.companies.find((c) => c.id === companyState.active);
  const targetLabel = activeCo ? conciseLabel(activeCo.label) : "";
  const defaultRows = multi ? deriveConsensusRows(rows, targetLabel) : rows;

  // The Metrics panel carries a fixed title on every tab.
  const metricsPanel = document.querySelector('.db-panel[data-panel-key="builder-metrics"]');
  const metricsTitle = metricsPanel?.querySelector(':scope > .db-panel-hd > .db-panel-title');
  if (metricsTitle && metricsTitle.textContent !== "Metrics & Controls") {
    metricsTitle.textContent = "Metrics & Controls";
  }
  // The Metrics panel launches on the white scheme like the viewer panels.
  window.dashboardViewerPanels?.forceWhite?.(metricsPanel);

  // Stat cards stay a per-company aggregate over every viewer's pings (unchanged).
  const widgets = {
    "widget-uptime": { rows },                // Uptime %   = avg(up)
    "widget-avgms": { rows: latencyRows, meta: baselineMeta },  // Avg ms = avg(latencyMs) + Δ vs broader
    "widget-minms": { rows: latencyRows },    // Min ms     = min(latencyMs)
    "widget-maxms": { rows: latencyRows },    // Max ms     = max(latencyMs)
    "widget-loss": { rows: latencyRows, meta: baselineMeta },   // Avg loss % = avg(packetLossPct) + Δ vs broader
    "widget-lossmin": { rows: latencyRows },  // Min loss % = min(packetLossPct)
    "widget-lossmax": { rows: latencyRows },  // Max loss % = max(packetLossPct)
    "widget-fails": { rows: failRows },       // Fails      = count(down)
    "widget-sincedown": { rows: failRows },   // Since down = max(checkedAtMs) of fails
  };

  // EVERY tab (1, 2, or 3+ viewers) shows its viewers as panels beneath the
  // chart — Grayson Fiber is the source of truth — so the single default table
  // is always hidden when there's at least one viewer.
  const hasViewers = viewers.length >= 1;
  const defaultTable = document.querySelector('.widget-layout[data-widget-layout-key="builder-table"]');
  if (defaultTable) defaultTable.style.display = hasViewers ? "none" : "";

  // Per-viewer table rows: value + signed delta vs THAT viewer's own average,
  // e.g. ping "31 (+1)" / "200 (+192)", loss "0 (+0)" — "ms"/"%" live in the
  // column headers ("ping (ms)" / "loss (%)"). The title carries the viewer's
  // own (source) IP (derived in main.js); VIEWER_IPS is a manual override.
  // The circuit's own target host (same across its viewers) — used as the IP for a
  // direct ("Primary") check that has no remote vantage point.
  const targetHost = rows.length ? (rows[rows.length - 1].ip || "") : "";
  // Surface the active circuit's IP above its tab — re-render tabs only when the
  // host actually changes (i.e. on a tab switch / first data), not every publish.
  if (activeCircuitHost !== targetHost) { activeCircuitHost = targetHost; renderCompanyTabs(); }
  const viewerInfos = viewers.map((name) => {
    // A "Primary" viewer is a direct check (no "(from X)"): there's no remote
    // vantage, so display the circuit's real identity + its target host instead of
    // the generic "Primary". `name` is kept verbatim so the panel/table slug+key
    // stay stable (the table data is fed under viewerSlug(name)).
    const isPrimary = name === "Primary";
    return {
      name,
      displayName: isPrimary ? (targetLabel || name) : name,
      ip: isPrimary ? targetHost : (VIEWER_IPS[name] || viewerIpMap[name] || ""),
    };
  });
  renderViewerTablePanels(companyState.active, hasViewers ? viewerInfos : []);
  if (hasViewers) {
    for (const viewer of viewers) {
      const vrows = rows.filter((r) => viewerOf(r.machine) === viewer);
      const vAvg = average(vrows.map((r) => r.latencyMs).filter((v) => v != null));
      const vLossAvg = average(vrows.map((r) => r.packetLossPct).filter((v) => v != null));
      const tableRows = vrows.map((r) => ({
        ...r,
        "ping (ms)": (r.latencyMs != null && r.status !== "red")
          ? `${r.latencyMs} (${signed(Math.round(r.latencyMs - (vAvg ?? r.latencyMs)))})` : "—",
        "loss (%)": (r.packetLossPct != null && r.status !== "red")
          ? `${r.packetLossPct} (${signed(Math.round((r.packetLossPct - (vLossAvg ?? r.packetLossPct)) * 10) / 10)})` : "—",
      }));
      widgets[`vt-${companyState.active}-${viewerSlug(viewer)}`] = { rows: tableRows };
    }
  }

  dataRuntime.ingest({
    default: { rows: defaultRows },   // bar chart + donut (consensus when redundant)
    types: { status: { rows: rows.length ? [rows[rows.length - 1]] : [currentStatusRow()] } },
    widgets,
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
    const res = await window.dashboard.getCompanyHistory(id, 20000);
    if (res?.ok && Array.isArray(res.results)) companyState.pingsById.set(id, res.results);
    if (res?.ok && Array.isArray(res.rollups)) companyState.rollupsById.set(id, res.rollups);
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
  // Clear the previous company's transient viewer panels immediately so they
  // never linger over the new tab while its history loads; publish() rebuilds.
  renderViewerTablePanels(id, []);
  renderCompanyTabs();
  if (!(companyState.pingsById.get(id) || []).length) await loadCompanyHistory(id);
  // Debounced: stepping quickly through companies coalesces into one final
  // data publish instead of re-rendering every widget per key repeat.
  publishSoon();
  animateCompanySwitch(dir);
}

// Open the active company's timeline chart at a given bar depth ("hour"/"day"),
// driven by the tray donut's time filter. The chart (re)renders asynchronously
// after a company switch, so poll briefly for its level strip, then pin that
// depth via the same level button the user would click (skip if already there).
function applyChartDepth(depth) {
  if (depth !== "hour" && depth !== "day") return;
  let tries = 0;
  const tryApply = () => {
    const card = [...document.querySelectorAll('.widget-card[data-widget-runtime-type="chart"]')]
      .find((c) => c.offsetParent !== null && c.querySelector(".chart-level-btn[data-level]"));
    if (card) {
      if (card.dataset.bucketLevel !== depth) {
        card.querySelector(`.chart-level-btn[data-level="${depth}"]`)?.click();
      }
      return;
    }
    if (++tries < 24) setTimeout(tryApply, 150);
  };
  setTimeout(tryApply, 200);
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
  .company-tab-bar{ display:flex; align-items:flex-start; justify-content:center; gap:8px; width:min(100%, 1100px); max-width:100%; margin:6px auto 0; box-sizing:border-box; padding:0 6px 4px; }
  /* The gliding tab row lives in its own clipped viewport BETWEEN the two "…"
     controls, so the centring translateX can never slide a tab over a trigger
     and steal its clicks (that overlap is what made the "…" need several
     tries). The buttons sit outside the viewport and stay fully hittable. */
  .company-tab-viewport{ flex:1 1 auto; min-width:0; display:flex; justify-content:center; overflow-x:clip; overflow-y:visible; }
  /* The active tab carries an IP line above its name. Pull the tab up by the IP's
     height (20px + 2px gap) so the name stays in place and the IP sits higher. */
  .company-tab:has(.company-tab-ip){ margin-top:-22px; }
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
    flex:0 0 auto; align-self:flex-start; position:relative; z-index:2;
    appearance:none !important; -webkit-appearance:none !important;
    border:0 !important; background:transparent !important; box-shadow:none !important;
    outline:0 !important;
    filter:none !important; min-height:0 !important; padding:8px 16px !important;
    color:rgba(255,255,255,0.55); font:inherit; font-size:22px; font-weight:700; line-height:1;
    transform:translateY(4px);
    text-shadow:var(--dashboard-custom-text-shadow);
    cursor:pointer; transition:color .18s ease;
  }
  .company-overflow:hover, .company-overflow:focus-visible{ color:#ffffff; background:transparent !important; }
  .company-overflow[hidden]{ display:none !important; }
  .company-overflow-menu{
    position:fixed; z-index:9999; max-height:62vh; overflow-y:auto;
    background:linear-gradient(180deg, rgba(22,26,36,0.62), rgba(12,16,24,0.55));
    -webkit-backdrop-filter:blur(26px) saturate(140%); backdrop-filter:blur(26px) saturate(140%);
    border:1px solid rgba(255,255,255,0.22); border-radius:14px; padding:8px 6px;
    box-shadow:inset 0 1px 0 rgba(255,255,255,0.24), 0 18px 42px rgba(0,0,0,0.4);
    display:flex; flex-direction:column; gap:9px; min-width:210px;
  }
  .company-overflow-item{
    display:block; appearance:none !important; -webkit-appearance:none !important;
    padding:0 12px !important; border:0 !important; background:transparent !important;
    box-shadow:none !important; outline:0 !important; filter:none !important; min-height:0 !important;
    /* CRITICAL: these items live in a max-height + overflow-y:auto flex column. With
       the flex default shrink:1 they get CRUSHED to fit (2-line search rows collapse
       to one line-height and the text overlaps). shrink:0 makes the list SCROLL. */
    flex-shrink:0 !important;
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

// The overflow menu keeps NO module state — the DOM is the single source of
// truth (there is at most one .company-overflow-menu on the body). The old
// design tracked open/side in module globals that could desync from the DOM
// (e.g. closed by a path that didn't reset them), after which the "same side"
// guard would silently swallow the next open and the "…" appeared dead — the
// "stops working after switching" symptom. Deriving everything from the DOM
// makes that impossible.
function currentOverflowMenu() {
  return document.querySelector(".company-overflow-menu");
}
function closeOverflowMenu() {
  document.querySelectorAll(".company-overflow-menu").forEach((m) => m.remove());
}
// Outside-dismiss is registered ONCE for the page lifetime; pointerdown fires
// before the click that opens a menu can reach it, so it never closes the menu
// it is about to open.
function onDocPointerForMenu(e) {
  const menu = currentOverflowMenu();
  if (!menu) return;
  if (menu.contains(e.target)) return;                 // inside the menu — let the item handle it
  if (e.target.closest?.(".company-overflow")) return; // the trigger toggles itself on click
  closeOverflowMenu();
}
document.addEventListener("pointerdown", onDocPointerForMenu, true);
function offscreenCompanies(side) {
  const bar = document.querySelector(".company-tab-bar"); if (!bar) return [];
  return (side === "left" ? bar._leftHidden : bar._rightHidden) || [];
}
function openOverflowMenu(side, anchor) {
  // Re-clicking the side that's already open closes it; otherwise open fresh.
  const existing = currentOverflowMenu();
  const sameSideOpen = existing && existing.dataset.side === side;
  closeOverflowMenu();
  if (sameSideOpen) return;
  const ids = offscreenCompanies(side);
  if (!ids.length) return;
  const menu = document.createElement("div");
  menu.className = "company-overflow-menu";
  menu.dataset.side = side;
  for (const id of ids) {
    const co = companyState.companies.find((c) => c.id === id); if (!co) continue;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "company-overflow-item" + (co.online === false ? " is-offline" : "");
    // Name + IP stacked, matching the dashboard search-menu entries.
    const lines = document.createElement("div");
    lines.className = "res-lines";
    const name = document.createElement("span");
    name.textContent = conciseLabel(co.label);
    lines.appendChild(name);
    const host = String(co.host || "");
    if (host) { const ip = document.createElement("span"); ip.className = "res-ip"; ip.textContent = host; lines.appendChild(ip); }
    item.appendChild(lines);
    item.title = co.online === false ? `${co.label} — offline` : co.label;
    item.addEventListener("click", () => { closeOverflowMenu(); setActiveCompany(id); });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 4)}px`;
  if (side === "left") menu.style.left = `${Math.round(r.left)}px`;
  else menu.style.right = `${Math.round(window.innerWidth - r.right)}px`;
}
// Only a window of tabs is shown at once; the rest live behind the "…" menus.
// Five visible = the active company centred with two stepped tiers per side.
const VISIBLE_COMPANY_TABS = 5;

// Historical (taken-off-the-network) connections are hidden from the dashboard's
// tabs / overflow / search — EXCEPT the one currently open, so opening one from the
// popover's shovel dropdown still shows it.
function visibleCompanies() {
  return companyState.companies.filter((c) => !c.historical || c.id === companyState.active);
}
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
      + '<div class="company-tab-viewport"><div class="company-tab-scroller"></div></div>'
      + '<button class="company-overflow company-overflow-right" type="button" aria-label="More companies (right)" hidden>…</button>';
    (wsBar?.parentElement || document.querySelector(".page") || document.body).insertBefore(bar, wsBar || null);
    bar.querySelector(".company-overflow-left").addEventListener("click", (e) => { e.stopPropagation(); openOverflowMenu("left", e.currentTarget); });
    bar.querySelector(".company-overflow-right").addEventListener("click", (e) => { e.stopPropagation(); openOverflowMenu("right", e.currentTarget); });
  }
  const all = visibleCompanies();
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
  // Safety net: if an older bar (scroller directly in the bar, no clipping
  // viewport) is still mounted from a prior version, wrap it now so the
  // gliding row can't slide over the "…" triggers and steal their clicks.
  if (scroller && !scroller.parentElement.classList.contains("company-tab-viewport")) {
    const vp = document.createElement("div");
    vp.className = "company-tab-viewport";
    scroller.parentElement.insertBefore(vp, scroller);
    vp.appendChild(scroller);
  }
  if (!scroller._tabsById) scroller._tabsById = new Map();
  const tabsById = scroller._tabsById;
  for (const [id, el] of [...tabsById]) {
    if (!all.some((c) => c.id === id)) { el.remove(); tabsById.delete(id); }
  }
  // Shown above the selected tab only (set by publish once history loads).
  const activeHost = activeCircuitHost;
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
    const label = conciseLabel(co.label);
    if (isActive && activeHost) {
      // Selected tab only: the circuit IP sits above the name, slightly muted.
      b.textContent = "";
      const ipEl = document.createElement("span");
      ipEl.className = "company-tab-ip";
      ipEl.textContent = activeHost;
      b.append(ipEl, document.createTextNode(label));
    } else {
      b.textContent = label;
    }
    if (scroller.children[index] !== b) scroller.insertBefore(b, scroller.children[index] || null);
  });
  while (scroller.children.length > all.length) scroller.lastChild.remove();
  // True centring: sizes snap instantly, so the active tab's final geometry is
  // measurable right away — glide the row (one composited translateX) until the
  // selected tab's centre sits exactly on the VIEWPORT centre. The shift is
  // clamped so the row never detaches from the viewport at the periphery.
  requestAnimationFrame(() => {
    if (!scroller.isConnected) return;
    const viewport = scroller.parentElement; // .company-tab-viewport
    const activeEl = tabsById.get(companyState.active);
    if (!viewport || !activeEl || activeEl.classList.contains("tier-off")) return;
    // Compensate with the LIVE transform (the row may be mid-glide when
    // stepping quickly), so the measured natural geometry is always exact.
    let liveShift = 0;
    try { liveShift = new DOMMatrixReadOnly(getComputedStyle(scroller).transform).m41 || 0; } catch {}
    const viewRect = viewport.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const tabRect = activeEl.getBoundingClientRect();
    const naturalTabCenter = (tabRect.left + tabRect.width / 2) - liveShift;
    let shift = (viewRect.left + viewRect.width / 2) - naturalTabCenter;
    const naturalLeft = scrollerRect.left - liveShift;
    const naturalRight = scrollerRect.right - liveShift;
    if (naturalRight - naturalLeft < viewRect.width - 12) {
      const minShift = (viewRect.left + 6) - naturalLeft;
      const maxShift = (viewRect.right - 6) - naturalRight;
      shift = Math.min(Math.max(shift, Math.min(minShift, maxShift)), Math.max(minShift, maxShift));
    }
    scroller.style.transform = `translateX(${Math.round(shift)}px)`;
  });
}

// Top-bar search: press the search icon, type a name or IP, and matching circuit
// tabs appear below — clicking one navigates to that company tab.
function initDashboardSearch() {
  const btn = document.querySelector(".control-bar-search");
  const pop = document.getElementById("dashboard-search-popover");
  if (!btn || !pop || pop.dataset.wired === "true") return;
  pop.dataset.wired = "true";
  const input = pop.querySelector(".dashboard-search-input");
  const results = pop.querySelector(".dashboard-search-results");

  const positionPopover = () => {
    const r = btn.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
    pop.style.left = `${Math.round(r.left)}px`;
  };
  const renderResults = () => {
    const q = input.value.trim().toLowerCase();
    results.innerHTML = "";
    // Show the FULL circuit list by default (empty query); typing filters it down.
    const all = visibleCompanies()
      .map((c) => ({ id: c.id, label: conciseLabel(c.label), host: String(c.host || ""), online: c.online !== false }));
    const matches = q
      ? all.filter((c) => c.label.toLowerCase().includes(q) || c.host.toLowerCase().includes(q))
      : all;
    if (!matches.length) { results.innerHTML = '<div class="dashboard-search-empty">No matches</div>'; return; }
    for (const m of matches) {
      const b = document.createElement("button");
      b.type = "button";
      // Reuse the "…" overflow-menu item styling EXACTLY (.company-overflow-item):
      // it already kills the native button appearance/blue active state and uses a
      // colour-only hover. dashboard-search-result only adds the name|IP layout.
      b.className = "company-overflow-item dashboard-search-result" + (m.online ? "" : " is-offline");
      // A <button> in Chromium will NOT grow to fit a flex/block column of children
      // (it collapses to one line-height and centres the overflow — lines then
      // overlap). So the name|IP column lives in a real <div> INSIDE the button. */
      const lines = document.createElement("div");
      lines.className = "res-lines";
      const name = document.createElement("span");
      name.textContent = m.label;
      lines.appendChild(name);
      if (m.host) { const ip = document.createElement("span"); ip.className = "res-ip"; ip.textContent = m.host; lines.appendChild(ip); }
      b.appendChild(lines);
      b.addEventListener("click", () => { close(); setActiveCompany(m.id); });
      results.appendChild(b);
    }
  };
  const open = () => {
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    positionPopover();
    input.value = "";
    renderResults();
    input.focus();
  };
  function close() {
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden ? open() : close(); });
  input.addEventListener("input", renderResults);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); btn.focus(); }
    else if (e.key === "Enter") { results.querySelector(".dashboard-search-result")?.click(); }
  });
  document.addEventListener("pointerdown", (e) => {
    if (pop.hidden || pop.contains(e.target) || btn.contains(e.target)) return;
    close();
  }, true);
  window.addEventListener("resize", () => { if (!pop.hidden) positionPopover(); });
}

async function startFeed() {
  const bridge = window.dashboard;
  if (!bridge) { console.warn("[status-feed] window.dashboard bridge unavailable — no live data."); return; }
  initDashboardSearch();

  // Viewer panels are transient — regenerated from live data each session. An
  // older build may have persisted them into the layout store, so they get
  // restored with stale titles/colours. Purge any restored ones on boot; the
  // first publish() recreates them fresh (current title format + white scheme).
  document.querySelectorAll('.db-panel[data-status-feed-generated="true"]').forEach((p) => p.remove());

  try {
    const snapshot = await bridge.getStatus();
    if (snapshot?.status) state.status = snapshot.status;
    if (snapshot?.connectionState) state.connection = snapshot.connectionState;
  } catch {}
  try {
    const list = await bridge.getCompanies?.();
    if (Array.isArray(list)) companyState.companies = list;
  } catch {}
  try { viewerIpMap = (await bridge.getViewerIps?.()) || {}; } catch {}
  if (companyState.companies.length) {
    // Default to a live company so the dashboard opens on real data, not an offline tab.
    companyState.active = companyState.active
      || (companyState.companies.find((c) => c.online !== false) || companyState.companies[0]).id;
    await loadCompanyHistory(companyState.active);
  }
  renderCompanyTabs();
  publish();
  // First render done — clear the loading gate after the render frame settles.
  requestAnimationFrame(() => requestAnimationFrame(hideDashboardLoading));

  // Tray pie click-through: land on the company whose slice was clicked
  // (pulled when this window boots; pushed live when it is already open). The
  // payload is { id, depth } — depth is the bar-chart granularity the donut's
  // time filter maps to (1hr/1d → hour, 1w → day).
  const focusCompany = async (payload) => {
    const id = (payload && typeof payload === "object") ? payload.id : payload;
    const depth = (payload && typeof payload === "object") ? payload.depth : null;
    if (!id || !companyState.companies.some((c) => c.id === id)) return;
    await setActiveCompany(id);
    if (depth) applyChartDepth(depth);
  };
  try { await focusCompany(await bridge.consumeCompanyFocus?.()); } catch {}
  bridge.onSetCompany?.((payload) => { focusCompany(payload); });

  // ← / → flip between companies (skip while typing or with a menu/modifier).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable
      || (t.closest && t.closest('[contenteditable="true"], [data-inline-text-editing="true"]')))) return;
    if (currentOverflowMenu()) return;
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

  bridge.onConnection((cs) => { state.connection = cs; });
  bridge.onStatus((payload) => { state.status = payload; });
  bridge.onCheck?.(({ companyId, ping }) => {
    if (companyId !== companyState.active || !ping) return;
    let buf = companyState.pingsById.get(companyId);
    if (!buf) { buf = []; companyState.pingsById.set(companyId, buf); }
    buf.push(ping);
    if (buf.length > 3000) buf.splice(0, buf.length - 3000);
    publishSoon();
  });

  // Refresh the company list + per-tab statuses + viewer IPs every 30s (the IP
  // map fills in as connection circuits for each location stream in).
  setInterval(async () => {
    try {
      const list = await bridge.getCompanies?.();
      if (Array.isArray(list) && list.length) { companyState.companies = list; renderCompanyTabs(); }
    } catch {}
    try { const m = await bridge.getViewerIps?.(); if (m && Object.keys(m).length) { viewerIpMap = m; publishSoon(); } } catch {}
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

// Suppress native (OS) tooltips everywhere: as the cursor moves onto anything,
// strip the `title` attribute (and any SVG <title>) from it and its ancestors
// before the ~0.5s hover delay can pop the Windows tooltip. Covers static markup
// (panel tool buttons, etc.) and dynamic content (table cells, tabs).
function suppressNativeTooltips() {
  const strip = (el) => {
    if (!el || el.nodeType !== 1) return;
    if (typeof el.hasAttribute === "function" && el.hasAttribute("title")) el.removeAttribute("title");
    if (el.namespaceURI === "http://www.w3.org/2000/svg" && typeof el.querySelector === "function") {
      el.querySelector(":scope > title")?.remove();
    }
  };
  document.addEventListener("pointerover", (event) => {
    let el = event.target;
    while (el && el.nodeType === 1) { strip(el); el = el.parentElement; }
  }, true);
  // pointerover only fires when the cursor ENTERS an element, so a `title` that a
  // re-render adds (or restores) while the cursor sits still — the long-hover and
  // click-then-hover cases — was never stripped and the OS tooltip still popped.
  // Strip titles the instant they appear/change anywhere in the document.
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") strip(m.target);
      else for (const node of m.addedNodes) {
        strip(node);
        if (node.querySelectorAll) node.querySelectorAll("[title], title").forEach(strip);
      }
    }
  });
  obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
}
suppressNativeTooltips();

seedChartDefaults();
watchForStatusWidgets();
mirrorBackgroundPreference();
function hideDashboardLoading() {
  document.getElementById("db-loading")?.classList.add("hidden");
}
// Safety net: never let the gate stick even if boot stalls or errors out.
setTimeout(hideDashboardLoading, 8000);
whenDataRuntimeReady(() => { startFeed(); });
