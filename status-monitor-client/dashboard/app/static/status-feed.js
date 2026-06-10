// Status feed — bridges the tray app's live monitor data (window.dashboard,
// exposed by dashboard-preload.js) into the dashboard widget data runtime.
//
// Loaded as a module script after app.js: the widget registry exists at module
// evaluation time, so the "status" widget type registers before the layout
// hydrates at DOMContentLoaded. The data runtime is created during boot, so
// ingestion waits for window.dashboardWidgetDataRuntime to appear.

const STATUS_COLORS = {
  green: "#34c759",
  yellow: "#f5a623",
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
  const { color, label, connection } = statusVisual();
  const current = state.status || {};
  els.cluster.style.setProperty("--status-color", color);
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

  els.popover.innerHTML = `
    <span class="status-detail-title">
      <span class="status-detail-dot" aria-hidden="true"></span>
      ${escapeHtml(label)}
    </span>
    <span class="status-detail-body">${escapeHtml(detail)}</span>
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

const historyRow = (entry) => ({
  date: entry.checkedAt,
  checkedAt: entry.checkedAt,
  status: entry.status,
  stage: entry.stage || "",
  detail: entry.detail || "",
  lastSuccess: entry.lastSuccess || "",
  // Numeric level so sum/avg/min/max metrics and charts have a value field.
  value: entry.status === "green" ? 2 : entry.status === "yellow" ? 1 : 0,
});

function currentStatusRow() {
  const payload = state.status || {};
  return {
    ...historyRow({ ...payload, checkedAt: payload.checkedAt || "" }),
    connection: state.connection,
    historyError: state.historyError,
  };
}

function publish() {
  const dataRuntime = window.dashboardWidgetDataRuntime;
  if (!dataRuntime?.ingest) return;

  const rows = state.history.map(historyRow);
  if (!rows.length && state.status) rows.push(historyRow(state.status));

  dataRuntime.ingest({
    // Every data widget without a more specific source sees the check history.
    default: { rows },
    types: {
      status: { rows: [currentStatusRow()] },
    },
    widgets: {
      "widget-checks": { rows },
      "widget-ok": { rows: rows.filter((row) => row.status === "green") },
      "widget-warn": { rows: rows.filter((row) => row.status === "yellow") },
      "widget-error": { rows: rows.filter((row) => row.status === "red") },
    },
  });
}

async function refreshHistory() {
  try {
    const response = await window.dashboard.getHistory(200);
    if (response?.ok && Array.isArray(response.results)) {
      // API returns newest-first; widgets/charts want chronological order.
      state.history = response.results.slice().reverse();
      state.historyError = false;
    } else if (response && response.ok === false) {
      // Reached the bridge but the REST fetch failed (main returns ok:false).
      state.historyError = true;
    }
  } catch {
    // Bridge threw — keep whatever history we already have, flag staleness.
    state.historyError = true;
  }
}

// Coalesce history refreshes: a status push that arrives while a fetch is
// already running marks a single trailing re-run instead of stacking a second
// concurrent fetch. The final pass always re-fetches and re-publishes, so the
// freshest history + status are shown; only redundant in-flight work is
// dropped. Behavior is identical to the old per-push fetch when pushes do not
// overlap (the common case).
let historySyncRunning = false;
let historySyncQueued = false;

async function syncHistoryAndPublish() {
  if (historySyncRunning) {
    historySyncQueued = true;
    return;
  }
  historySyncRunning = true;
  try {
    do {
      historySyncQueued = false;
      await refreshHistory();
      publish();
      updateStatusIndicator();
    } while (historySyncQueued);
  } finally {
    historySyncRunning = false;
  }
}

async function startFeed() {
  const bridge = window.dashboard;
  if (!bridge) {
    console.warn("[status-feed] window.dashboard bridge unavailable — no live data.");
    return;
  }

  try {
    const snapshot = await bridge.getStatus();
    if (snapshot?.status) state.status = snapshot.status;
    if (snapshot?.connectionState) state.connection = snapshot.connectionState;
  } catch {}

  await refreshHistory();
  publish();
  updateStatusIndicator();

  bridge.onStatus((payload) => {
    state.status = payload;
    updateStatusIndicator();
    syncHistoryAndPublish();
  });

  bridge.onConnection((connectionState) => {
    state.connection = connectionState;
    updateStatusIndicator();
    publish();
  });
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
