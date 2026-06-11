// Status feed — bridges the tray app's live monitor data (window.dashboard,
// exposed by dashboard-preload.js) into the dashboard widget data runtime.
//
// Loaded as a module script after app.js: the widget registry exists at module
// evaluation time, so the "status" widget type registers before the layout
// hydrates at DOMContentLoaded. The data runtime is created during boot, so
// ingestion waits for window.dashboardWidgetDataRuntime to appear.

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

function ensureStatusIndicator() {
  if (indicatorEls && document.body.contains(indicatorEls.cluster)) return indicatorEls;
  const cluster = document.createElement("div");
  cluster.className = "status-indicator-cluster";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "window-glass-control status-indicator-control";
  button.setAttribute("aria-label", "Monitor status");

  const popover = document.createElement("div");
  popover.className = "status-detail-popover";
  popover.setAttribute("role", "status");

  cluster.append(button, popover);
  document.body.appendChild(cluster);

  cluster.addEventListener("pointerenter", pokeGlass);
  cluster.addEventListener("pointerleave", pokeGlass);
  button.addEventListener("focus", pokeGlass);
  button.addEventListener("blur", pokeGlass);

  indicatorEls = { cluster, button, popover };
  return indicatorEls;
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
    /* Counter widgets read by meaning, but kept as muted/desaturated tints so
       they harmonise with the glass surface rather than shouting. Scoped to
       :not(.db-panel-custom-color) so a manual recolor still wins. */
    .widget-card[data-widget-key="widget-ok"]:not(.db-panel-custom-color) .stat-val { color: #6fc99a !important; }
    .widget-card[data-widget-key="widget-warn"]:not(.db-panel-custom-color) .stat-val { color: #d4ab63 !important; }
    .widget-card[data-widget-key="widget-error"]:not(.db-panel-custom-color) .stat-val { color: #e1857c !important; }
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
  checked: formatChecked(entry.checkedAt),
  day: formatDay(entry.checkedAt),
  status: entry.status,
  // A ping is binary: it passed (healthy) or it did not.
  result: entry.status === "green" ? "Pass" : "Fail",
  machine: entry.machine || "",
  // Numeric latency (ms) for the stat cards; null/undefined for down pings.
  latencyMs: entry.latencyMs ?? null,
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

// The four stat cards summarize the active company's latency + failures. The
// config (metric/valueField/title) is set once; the runtime aggregates over the
// timeframe-filtered rows, so the numbers track the selected time range.
let statConfigSent = false;
function publish() {
  const dataRuntime = window.dashboardWidgetDataRuntime;
  if (!dataRuntime?.ingest) return;
  const rows = rowsForActive();
  // Latency cards only see pings that actually responded (a real ms value);
  // down pings have no latency and would otherwise skew avg/min toward 0.
  const latencyRows = rows.filter((r) => r.latencyMs != null);
  const failRows = rows.filter((r) => r.status === "red");
  const widgets = {
    "widget-checks": { rows: latencyRows }, // Avg ms  (avg latencyMs)
    "widget-ok": { rows: latencyRows },     // Min ms  (min latencyMs)
    "widget-warn": { rows: latencyRows },   // Max ms  (max latencyMs)
    "widget-error": { rows: failRows },     // Fails   (count of down pings)
  };
  if (!statConfigSent) {
    statConfigSent = true;
    widgets["widget-checks"].config = { metric: "avg", valueField: "latencyMs", label: "Avg ms", title: "Avg ms", format: "number" };
    widgets["widget-ok"].config = { metric: "min", valueField: "latencyMs", label: "Min ms", title: "Min ms", format: "number" };
    widgets["widget-warn"].config = { metric: "max", valueField: "latencyMs", label: "Max ms", title: "Max ms", format: "number" };
    widgets["widget-error"].config = { metric: "count", label: "Fails", title: "Fails", format: "number" };
  }
  dataRuntime.ingest({
    default: { rows },
    types: { status: { rows: rows.length ? [rows[rows.length - 1]] : [currentStatusRow()] } },
    widgets,
  });
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
// -1 = prev/left) for a little swipe between companies.
function animateCompanySwitch(dir) {
  const grid = document.querySelector(".dashboard-layout-grid");
  if (!grid || !dir) return;
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
  publish();
  animateCompanySwitch(dir);
}

// ── Company tab bar (scrollable, with "…" overflow menus on each end) ──────────

let companyCssInjected = false;
function injectCompanyCss() {
  if (companyCssInjected) return;
  companyCssInjected = true;
  const style = document.createElement("style");
  // Company tabs are the unchanged .workspace-tab. Only a fixed window of them is
  // shown at once; a "…" on each end opens the rest. The base <button> blue
  // background/shadow is explicitly removed from the "…" controls.
  style.textContent = `
  .company-tab-bar{ display:flex; align-items:center; justify-content:center; gap:clamp(10px,2.4vw,24px); width:min(100%, 1000px); max-width:100%; margin:2px auto 0; box-sizing:border-box; padding:0 6px; }
  .company-tab-scroller{ display:flex; align-items:center; justify-content:center; gap:clamp(14px,3.5vw,38px); min-width:0; }
  .company-tab-scroller .workspace-tab{ flex:0 0 auto; --tab-accent:#edf2f8; }
  .company-tab-scroller .workspace-tab.is-offline{ --tab-accent:#8a8f98; opacity:.5; }
  .company-overflow-item.is-offline{ color:rgba(138,143,152,0.85); }
  .company-overflow{ flex:0 0 auto; appearance:none; -webkit-appearance:none; border:0 !important; background:transparent !important; box-shadow:none !important; filter:none !important; min-height:0 !important; color:#edf2f8; opacity:0.5; font-size:clamp(18px,2.5vw,27px); line-height:1; padding:0 4px; cursor:pointer; }
  .company-overflow:hover{ opacity:1; }
  .company-overflow[hidden]{ display:none !important; }
  .company-overflow-menu{ position:fixed; z-index:9999; max-height:62vh; overflow-y:auto; background:rgba(28,30,38,0.96); backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:6px; box-shadow:0 12px 40px rgba(0,0,0,0.45); display:flex; flex-direction:column; gap:2px; min-width:200px; }
  .company-overflow-item{ display:block; appearance:none; -webkit-appearance:none; padding:8px 12px; border:0 !important; background:transparent !important; box-shadow:none !important; filter:none !important; min-height:0 !important; color:rgba(255,255,255,0.85); font:inherit; font-size:0.95rem; text-align:left; border-radius:6px; cursor:pointer; white-space:nowrap; }
  .company-overflow-item:hover{ background:rgba(255,255,255,0.1) !important; color:#fff; }
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
const VISIBLE_COMPANY_TABS = 4;

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
  // Window of VISIBLE tabs, keeping the active one in view (second slot).
  const start = Math.min(Math.max(0, active - 1), Math.max(0, n - VISIBLE_COMPANY_TABS));
  const end = Math.min(n, start + VISIBLE_COMPANY_TABS);
  bar._leftHidden = all.slice(0, start).map((c) => c.id);
  bar._rightHidden = all.slice(end).map((c) => c.id);
  bar.querySelector(".company-overflow-left").hidden = start <= 0;
  bar.querySelector(".company-overflow-right").hidden = end >= n;
  const scroller = bar.querySelector(".company-tab-scroller");
  scroller.innerHTML = "";
  for (const co of all.slice(start, end)) {
    const isActive = co.id === companyState.active;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "workspace-tab" + (co.online === false ? " is-offline" : ""); // reuse the existing tab styling
    b.dataset.companyId = co.id;
    b.setAttribute("aria-pressed", String(isActive));
    b.setAttribute("tabindex", isActive ? "0" : "-1");
    b.title = co.online === false ? `${co.label} — offline` : co.label; // full name on hover
    const label = document.createElement("span");
    label.className = "workspace-tab-label";
    label.textContent = conciseLabel(co.label);
    b.appendChild(label);
    b.addEventListener("click", () => setActiveCompany(co.id));
    scroller.appendChild(b);
  }
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
