import { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import mqtt from 'mqtt';
import squirrelStartup from 'electron-squirrel-startup';
import { icons } from './icons';
import auth from './auth.js';

// Handle Squirrel.Windows install/update/uninstall events — must quit immediately.
if (squirrelStartup) app.quit();

// Kill the default application menu (File/Edit/View/Window/Help) for a chrome-free
// tray popover. Must be called before any window is created.
Menu.setApplicationMenu(null);

// ─── Settings persistence ─────────────────────────────────────────────────────

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  mqttHost: '24.121.212.206',
  mqttPort: 1883,
  projectId: '',
  systemId: '',
  apiPort: 3847, // REST API port for history (mirrors DEFAULT_API_PORT below)
};

// Maps monitored checks → companies (dashboard tabs). Editable JSON shipped with
// the app; loaded at startup. Empty companies[] => one tab per check (auto-named).
function clientsConfigPath() {
  const candidates = [
    path.join(app.getPath('userData'), 'clients.json'),
    app.isPackaged ? path.join(process.resourcesPath, 'clients.json') : '',
    path.join(__dirname, '..', 'clients.json'),
  ].filter(Boolean);
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || candidates[candidates.length - 1];
}
function loadClients() {
  try {
    const cfg = JSON.parse(fs.readFileSync(clientsConfigPath(), 'utf8'));
    return { companies: Array.isArray(cfg.companies) ? cfg.companies : [] };
  } catch {
    return { companies: [] };
  }
}

function loadSettings() {
  try {
    const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    // Migrate pre-multi-company configs that pointed at a local broker — the
    // company data lives on the central broker now.
    if (!merged.mqttHost || merged.mqttHost === 'localhost' || merged.mqttHost === '127.0.0.1') {
      merged.mqttHost = DEFAULT_SETTINGS.mqttHost;
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ─── App state ────────────────────────────────────────────────────────────────

let tray = null;
let mainWindow = null;
let dashboardWindow = null;
let mqttClient = null;
let currentStatus = null;        // most recent status payload
let currentConnectionState = 'grey'; // 'grey' | 'live' | 'black'
let lastCheckedAt = null;        // checkedAt from most recent message
let settings = loadSettings();
let clientsConfig = loadClients();
// companyId -> { id, label, pings: [...], lastByCheck: Map<checkId, ping> }
const companies = new Map();
// Persistent roster of every company ever seen: id -> { id, label, lastSeen }.
// Lets offline clients keep their tab (shown grey) when their checks go quiet.
let roster = new Map();
// "<projectId>/<systemId>" -> last activity (ms). Fed by heartbeats and any
// check/connection message, so a company is online whenever its monitoring
// agent is alive — even if an individual circuit check publishes slowly.
const systemActivity = new Map();
// Retained-message presence = "tracked in the explorer". A check is tracked while
// its retained topic exists on the broker; when that retained record is deleted
// (a zero-length tombstone, or it's absent from the retained burst on reconnect)
// the connection moves to the historical roster. No staleness timers — this is
// symmetric with how a newly-published retained message adds a connection.
const trackedCheckTopics = new Set();   // check/connection topics with a live retained record
const companyCheckTopics = new Map();   // companyId -> Set(topic) of its check topics
let trackingDiscoveryDeadline = 0;      // grace window so the retained burst can arrive before we judge
const TRACKING_DISCOVERY_MS = 10_000;
let isQuitting = false;
let popoverMode = 'peek';        // 'peek' | 'expanded'
let popoverPinned = false;
let popoverPinnedAt = 0;         // when the popover was last pinned (blur-race guard)
let pointerInPopover = false;
let pointerInTray = false;
let hideTimer = null;
let popoverReady = false;
let pendingPopover = null;
let lastAnchorEdge = 'bottom';   // 'top' means grow down; 'bottom' means grow up
let capturedAnchorPoint = null;

// The legend ("i") opens as its OWN small window to the LEFT of the popover.
// `legendOpen` suppresses the popover's hide-on-blur so opening/holding the
// legend doesn't dismiss the dashboard; `legendClosedAt` keeps that suppression
// alive through the single click that closes the legend, so the FIRST off-click
// closes only the legend and the SECOND closes the dashboard.
let legendWindow = null;
let legendOpen = false;
let legendClosedAt = 0;
// Invisible full-screen click-catcher shown while the legend is open. On Windows the
// popover can't pull focus back after an off-click lands on the desktop, so a second
// off-click would never reach it via blur. This scrim catches those off-clicks
// directly (it sits below the popover/legend but above everything else) to drive the
// layered dismiss: 1st off-click closes the legend, 2nd closes the dashboard.
let dismissScrim = null;
const LEGEND_W = 256; // SAME size as the popover window (POPOVER_WIDTH × its height)
const LEGEND_H = 319; // measured popover window height — content fills it exactly, no wasted space

const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_API_PORT = 3847;
const POPOVER_WIDTH = 256;
const POPOVER_PEEK_HEIGHT = 96;
const POPOVER_EXPANDED_HEIGHT = 210;
const POPOVER_INITIAL_HEIGHT = POPOVER_PEEK_HEIGHT;
const POPOVER_MIN_HEIGHT = 80;
const POPOVER_HIDE_GRACE_MS = 250;
const POPOVER_ANCHOR_GAP = 6;
const SUPPORTS_TRAY_HOVER = process.platform !== 'linux';

// ─── MQTT (multi-company) ────────────────────────────────────────────────────
// The broker carries one branch per monitoring server (projectId/systemId) with
// a check per topic: `<projectId>/<systemId>/checks/<checkId>`. We subscribe to
// all of them, parse each check's {available, latencyMs, packetLoss, ...}, group
// the checks into companies (clients.json), and keep a per-company ping buffer.

function setConnectionState(state) {
  currentConnectionState = state;
  broadcastConnectionState(state);
  if (state === 'black') updateTray('black');
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(from [^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

// Which company tab a check belongs to. Explicit clients.json matches win;
// otherwise the company is derived from the check label (one tab per check).
function companyForCheck(label, id) {
  const hay = `${id || ''} ${label || ''}`.toLowerCase();
  for (const c of (clientsConfig.companies || [])) {
    if (Array.isArray(c.match) && c.match.some((m) => hay.includes(String(m).toLowerCase()))) {
      return { id: slugify(c.label), label: String(c.label) };
    }
  }
  const derived = String(label || id || 'Unknown').replace(/\s*\(from [^)]*\)\s*/i, '').trim() || 'Unknown';
  return { id: slugify(derived), label: derived };
}

// A raw check payload → a dashboard ping row. A check is binary up/down
// (available); packet loss flags a degraded (amber) ping.
function checkToPing(p) {
  const status = p.available === false ? 'red' : (Number(p.packetLoss) > 0 ? 'yellow' : 'green');
  const bits = [];
  if (p.host) bits.push(p.host);
  if (p.available === false) bits.push('unreachable');
  else if (p.latencyMs != null) bits.push(`${p.latencyMs} ms`);
  if (Number(p.packetLoss) > 0) bits.push(`${p.packetLoss}% loss`);
  if (p.error) bits.push(String(p.error));
  return {
    // checks/ use checkedAt; connections/ use lastReceived.
    checkedAt: p.checkedAt || p.lastReceived || new Date().toISOString(),
    status,
    // Numeric latency for the stat cards; null when unreachable so it's excluded
    // from avg/min/max rather than counted as 0 ms.
    latencyMs: (p.available !== false && p.latencyMs != null && p.latencyMs !== '') ? Number(p.latencyMs) : null,
    // Packet loss % (responded pings only) and a 1/0 up flag for uptime %.
    packetLossPct: (p.available !== false && p.packetLoss != null && p.packetLoss !== '') ? Number(p.packetLoss) : null,
    up: status === 'red' ? 0 : 1,
    machine: p.label || p.id || '',
    checkId: p.id || '',
    host: p.host || '',
    detail: bits.join(' · '),
  };
}

const MAX_PINGS_PER_COMPANY = 50000; // safety cap; the real bound is RAW_RETENTION_MS (7 days) via rollUpAged

function ingestCheck(payload, system) {
  if (!payload || payload.available === undefined) return null;
  const co = companyForCheck(payload.label, payload.id);
  rememberCompany(co);
  let entry = companies.get(co.id);
  if (!entry) { entry = { id: co.id, label: co.label, pings: [], lastByCheck: new Map(), systems: new Set() }; companies.set(co.id, entry); }
  // Record which monitoring agent(s) cover this company so liveness can be judged
  // by the agent's heartbeat, not by one (possibly slow) check's timestamp.
  if (system) entry.systems.add(system);
  const ping = checkToPing(payload);
  const prev = entry.lastByCheck.get(ping.checkId);
  if (prev && prev.checkedAt === ping.checkedAt) return null; // retained re-delivery / duplicate
  entry.lastByCheck.set(ping.checkId, ping);
  entry.pings.push(ping);
  if (entry.pings.length > MAX_PINGS_PER_COMPANY) entry.pings.splice(0, entry.pings.length - MAX_PINGS_PER_COMPANY);
  if (ping.checkedAt) lastCheckedAt = ping.checkedAt;
  // Bound lastByCheck: drop checks that haven't reported in a long time so a
  // company churning through check IDs can't grow the map without limit (and
  // long-dead checks don't linger in the "current" status). Gated on size so it's
  // a no-op for the normal handful of checks.
  if (entry.lastByCheck.size > 64) {
    const staleBefore = Date.now() - STALE_MS;
    for (const [k, p] of entry.lastByCheck) {
      const t = Date.parse(p.checkedAt);
      if (Number.isFinite(t) && t < staleBefore) entry.lastByCheck.delete(k);
    }
  }
  savePingsSoon(); // debounced persist so history survives a restart
  return { companyId: co.id, ping };
}

// A company is "online" only if one of its checks reported within this window;
// retained-but-stale or never-seen-this-session companies read as offline.
const ONLINE_MS = 5 * 60 * 1000;

function rosterFile() {
  return path.join(app.getPath('userData'), 'roster.json');
}
function loadRoster() {
  try {
    const data = JSON.parse(fs.readFileSync(rosterFile(), 'utf8'));
    const m = new Map();
    for (const c of (data.companies || [])) {
      if (c && c.id) m.set(c.id, { id: c.id, label: c.label || c.id, lastSeen: c.lastSeen || 0 });
    }
    return m;
  } catch { return new Map(); }
}
let rosterSaveTimer = null;
function saveRosterSoon() {
  if (rosterSaveTimer) return;
  rosterSaveTimer = setTimeout(() => {
    rosterSaveTimer = null;
    try { fs.writeFileSync(rosterFile(), JSON.stringify({ companies: [...roster.values()] }, null, 2)); } catch {}
  }, 2000);
}
function rememberCompany(co) {
  const known = roster.get(co.id);
  if (!known || known.label !== co.label) {
    roster.set(co.id, { id: co.id, label: co.label, lastSeen: Date.now() });
  } else {
    known.lastSeen = Date.now();
  }
  saveRosterSoon();
}

// ── Ping persistence ──────────────────────────────────────────────────────────
// entry.pings is the per-company ping history that drives the charts/tables and
// the 4-in-a-row criticality. It lives only in memory, so without this it rebuilds
// from scratch (empty) after every restart. Persist it to disk — debounced while
// running, flushed synchronously on quit — and reload it on startup so history
// survives a restart. Capped to the last PERSIST_WINDOW_MS (the window the UI
// actually derives over) so the file stays small.
const PERSIST_WINDOW_MS = 24 * 60 * 60 * 1000;     // the PIE / criticality derive over this — unchanged
const RAW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;  // keep full-minute pings this long; older data → hourly rollups
const ROLLUP_HOUR_MS = 3600000;
function pingsCacheFile() {
  return path.join(app.getPath('userData'), 'pings-cache.json');
}
function pingsCacheFileGz() {
  return path.join(app.getPath('userData'), 'pings-cache.json.gz');
}
// Window the PIE / tray derivation sees (last 24h). Kept independent of the raw
// retention window so extending full-resolution history does NOT change the pie.
function recentPings(pings) {
  const cutoff = Date.now() - PERSIST_WINDOW_MS;
  const kept = (pings || []).filter((p) => {
    const t = Date.parse(p && p.checkedAt);
    return Number.isFinite(t) && t > cutoff;
  });
  return kept.length > 3000 ? kept.slice(kept.length - 3000) : kept;
}
// Full-resolution pings retained in memory + on disk: the last RAW_RETENTION_MS.
function rawPings(pings) {
  const cutoff = Date.now() - RAW_RETENTION_MS;
  const kept = (pings || []).filter((p) => {
    const t = Date.parse(p && p.checkedAt);
    return Number.isFinite(t) && t > cutoff;
  });
  return kept.length > MAX_PINGS_PER_COMPANY ? kept.slice(kept.length - MAX_PINGS_PER_COMPANY) : kept;
}
// Roll up pings older than the raw-retention window into HOURLY buckets that
// preserve the EXACT bar-chart inputs: per hour we store the consensus
// green/yellow/down MINUTE counts (g/y/d) — so the stacked HP bar reproduces
// byte-for-byte — plus latency/loss stats for the stat cards. Levels come from
// derivedMinuteLevels over the full buffer (stable baseline), the same algorithm
// the live chart uses. The rolled pings are then dropped, so memory + disk stay
// bounded while the trend is kept forever.
function rollUpAged(entry) {
  const pings = entry.pings || [];
  if (!pings.length) return;
  const cutoffHour = Math.floor((Date.now() - RAW_RETENTION_MS) / ROLLUP_HOUR_MS) * ROLLUP_HOUR_MS;
  if (!pings.some((p) => { const t = Date.parse(p.checkedAt); return Number.isFinite(t) && t < cutoffHour; })) return;
  if (!entry.rollups) entry.rollups = new Map();
  const bucketFor = (h) => {
    let b = entry.rollups.get(h);
    if (!b) { b = { h, g: 0, y: 0, d: 0, latN: 0, latSum: 0, latMin: 0, latMax: 0, lossN: 0, lossSum: 0, lossMax: 0 }; entry.rollups.set(h, b); }
    return b;
  };
  // consensus minute levels (red = >=50% viewers down, yellow = any down/degraded, else green)
  for (const { ms, level } of derivedMinuteLevels(pings)) {
    if (ms >= cutoffHour) continue;
    const b = bucketFor(Math.floor(ms / ROLLUP_HOUR_MS) * ROLLUP_HOUR_MS);
    if (level === 'red') b.d += 1; else if (level === 'yellow') b.y += 1; else b.g += 1;
  }
  // latency/loss stats from the raw aged pings (drives stat cards over old ranges)
  for (const p of pings) {
    const t = Date.parse(p.checkedAt);
    if (!Number.isFinite(t) || t >= cutoffHour) continue;
    const b = bucketFor(Math.floor(t / ROLLUP_HOUR_MS) * ROLLUP_HOUR_MS);
    if (p.latencyMs != null) { b.latMin = b.latN ? Math.min(b.latMin, p.latencyMs) : p.latencyMs; b.latMax = b.latN ? Math.max(b.latMax, p.latencyMs) : p.latencyMs; b.latN += 1; b.latSum += p.latencyMs; }
    const loss = Number(p.packetLoss);
    if (Number.isFinite(loss)) { b.lossN += 1; b.lossSum += loss; if (loss > b.lossMax) b.lossMax = loss; }
  }
  entry.pings = pings.filter((p) => { const t = Date.parse(p.checkedAt); return !Number.isFinite(t) || t >= cutoffHour; });
  entry._derived = null; // invalidate the memoized 24h derivation
}
function rollUpAllAged() { for (const e of companies.values()) rollUpAged(e); }

function snapshotPings() {
  rollUpAllAged(); // fold anything older than the raw window into hourly rollups first
  const out = [];
  for (const e of companies.values()) {
    const pings = rawPings(e.pings);
    const rollups = e.rollups && e.rollups.size ? [...e.rollups.values()] : [];
    if (pings.length || rollups.length) out.push({ id: e.id, label: e.label, pings, rollups });
  }
  return { savedAt: Date.now(), companies: out };
}
function loadPingsCache() {
  const zlib = require('zlib');
  let data;
  try {
    if (fs.existsSync(pingsCacheFileGz())) data = JSON.parse(zlib.gunzipSync(fs.readFileSync(pingsCacheFileGz())).toString('utf8'));
    else data = JSON.parse(fs.readFileSync(pingsCacheFile(), 'utf8'));
  } catch { return; }
  if (!data || !Array.isArray(data.companies)) return;
  for (const c of data.companies) {
    if (!c || !c.id) continue;
    // Load raw pings as-is (the cache already holds ≤ raw window from the last save);
    // rollUpAllAged() right after load folds anything that aged past the window while
    // the app was closed. Only a hard safety cap is applied here.
    const pings = Array.isArray(c.pings) ? c.pings.slice(-MAX_PINGS_PER_COMPANY) : [];
    const rollups = new Map();
    for (const r of (Array.isArray(c.rollups) ? c.rollups : [])) { if (r && Number.isFinite(r.h)) rollups.set(r.h, r); }
    if (!pings.length && !rollups.size) continue;
    // Rebuild lastByCheck (newest ping per checkId) so ingestCheck's retained-
    // re-delivery dedupe works against the restored history and never double-counts.
    const lastByCheck = new Map();
    for (const p of pings) { if (p && p.checkId) lastByCheck.set(p.checkId, p); }
    companies.set(c.id, { id: c.id, label: c.label || c.id, pings, lastByCheck, systems: new Set(), rollups });
  }
}
let pingsSaveTimer = null;
function writePingsCache(sync) {
  const zlib = require('zlib');
  let buf;
  try { buf = zlib.gzipSync(Buffer.from(JSON.stringify(snapshotPings()))); } catch { return; }
  if (sync) { try { fs.writeFileSync(pingsCacheFileGz(), buf); } catch {} }
  else fs.promises.writeFile(pingsCacheFileGz(), buf).catch(() => {});
}
function savePingsSoon() {
  if (pingsSaveTimer) return;
  pingsSaveTimer = setTimeout(() => { pingsSaveTimer = null; writePingsCache(false); }, 60000);
}
function flushPingsCache() {
  if (pingsSaveTimer) { clearTimeout(pingsSaveTimer); pingsSaveTimer = null; }
  writePingsCache(true);
}

// The vantage point a check pings FROM, parsed from its label "(from X)".
// Checks without the suffix (e.g. local LAN checks) are each their own viewer.
function viewerFromMachine(machine) {
  const m = String(machine || '').match(/\(from ([^)]*)\)/i);
  return (m && m[1].trim()) || String(machine || 'primary');
}

// Derive each minute's consensus level from a circuit's ping history: bucket by
// minute, take each viewer's worst level that minute, then RED when >=50% of the
// viewers are down, YELLOW for any down/degraded, else GREEN — the same derived
// criticality the dashboard timeline shows. Returns levels oldest -> newest.
function derivedMinuteLevels(pings) {
  if (!pings || !pings.length) return [];
  const latencies = pings.filter((p) => p.latencyMs != null).map((p) => p.latencyMs);
  const avg = latencies.length ? latencies.reduce((s, v) => s + v, 0) / latencies.length : null;
  const levelOf = (p) => p.status === 'red' ? 'red'
    : (p.status === 'yellow' || (avg != null && p.latencyMs != null && p.latencyMs > Math.max(avg * 2.2 + 25, 40))) ? 'yellow'
      : 'green';
  const worse = { green: 0, yellow: 1, red: 2 };
  const totalViewers = new Set(pings.map((p) => viewerFromMachine(p.machine))).size || 1;
  const buckets = new Map(); // minuteMs -> Map<viewer, worstLevel>
  for (const p of pings) {
    const t = Date.parse(p.checkedAt);
    if (!Number.isFinite(t)) continue;
    const ms = Math.floor(t / 60000) * 60000;
    let votes = buckets.get(ms);
    if (!votes) { votes = new Map(); buckets.set(ms, votes); }
    const v = viewerFromMachine(p.machine);
    const lvl = levelOf(p);
    const prev = votes.get(v);
    if (prev == null || worse[lvl] > worse[prev]) votes.set(v, lvl);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([ms, votes]) => {
    const vals = [...votes.values()];
    const fails = vals.filter((x) => x === 'red').length;
    const level = fails / totalViewers >= 0.5 ? 'red'
      : (fails > 0 || vals.some((x) => x === 'yellow')) ? 'yellow' : 'green';
    return { ms, level };
  });
}

// Memoized per-company derivation. derivedMinuteLevels is O(pings); recomputing it
// for every company on every 1.5s snapshot — and 3x per company in companies:pie —
// was the main-thread hot path that decayed as buffers filled toward the 3000 cap.
// Cache the result on the entry, keyed by (ping count + newest ping timestamp), so
// it recomputes ONLY when that company gets a new ping; every reader (companyWorst,
// the pie counts, the critical streak) then shares one derivation over the last 24h.
function derivedFor(entry) {
  const pings = entry.pings || [];
  const lastTs = pings.length ? pings[pings.length - 1].checkedAt : '';
  const cache = entry._derived;
  if (cache && cache.len === pings.length && cache.lastTs === lastTs) return cache;
  const windowed = recentPings(pings);
  const levels = derivedMinuteLevels(windowed);
  const viewers = new Set(windowed.map((p) => viewerFromMachine(p.machine))).size || 1;
  const next = { len: pings.length, lastTs, levels, viewers };
  entry._derived = next;
  return next;
}

// Consecutive derived-down minute buckets at the END of the run. >= CRITICAL_DOWN_STREAK
// is a confirmed, sustained outage — the single rule that reds the tray icon and
// auto-highlights the pie slice. Operates on already-derived levels (cheap tail scan).
const CRITICAL_DOWN_STREAK = 4;
function trailingDownStreakFromLevels(levels) {
  let streak = 0;
  for (let i = levels.length - 1; i >= 0 && levels[i].level === 'red'; i--) streak += 1;
  return streak;
}

// FLAKY (yellow): a circuit that failed FLAKY_MIN_FAILS+ derived-down minutes in
// the last FLAKY_WINDOW_MS, but is NOT in a sustained 4-in-a-row outage right now
// — i.e. intermittent, non-consecutive drops. This is what turns the tray icon
// amber (!) and auto-highlights the slice yellow (mirror of the red critical rule).
const FLAKY_WINDOW_MS = 10 * 60 * 1000; // past 10 minutes
const FLAKY_MIN_FAILS = 4;
function recentDownCount(levels, windowMs) {
  const cutoff = Date.now() - windowMs;
  let n = 0;
  for (const { ms, level } of levels) if (level === 'red' && ms >= cutoff) n += 1;
  return n;
}
function isFlaky(levels) {
  return trailingDownStreakFromLevels(levels) < CRITICAL_DOWN_STREAK
    && recentDownCount(levels, FLAKY_WINDOW_MS) >= FLAKY_MIN_FAILS;
}

// How many DISTINCT sustained-outage episodes occurred across the window — each
// maximal run of >= CRITICAL_DOWN_STREAK consecutive derived-down buckets counts
// once (the moment the run crosses the threshold is the icon going red once). This
// feeds the pie's deep-red outer tier: a tally of "went critical" events.
function countCriticalEpisodes(levels) {
  let count = 0, run = 0;
  for (const { level } of levels) {
    if (level === 'red') { run += 1; if (run === CRITICAL_DOWN_STREAK) count += 1; }
    else run = 0;
  }
  return count;
}

// A circuit watched from several vantage points ("viewers") is a redundancy
// group: a single viewer reporting down usually means THAT viewer's path is
// broken, not the target — so criticality is derived by >=50% quorum per minute.
// RED is reserved for a SUSTAINED outage: >=4 consecutive derived-down minute
// buckets (the current run). A shorter dip or any degraded viewer is AMBER, so a
// single blip never reds the fleet; red means a confirmed, ongoing outage.
function companyWorst(entry) {
  const { levels } = derivedFor(entry);
  // RED: a sustained outage — 4 derived-down minutes in a row, right now.
  if (trailingDownStreakFromLevels(levels) >= CRITICAL_DOWN_STREAK) return 'red';
  // YELLOW: flaky — 4+ derived-down minutes in the last 10 min that were NOT
  // back-to-back (else it'd be red). Intermittent failures, not a current outage.
  if (isFlaky(levels)) return 'yellow';
  return 'green';
}

// ── Viewer source IPs ─────────────────────────────────────────────────────────
// The connection check carries only the TARGET host, not each viewer's own IP.
// But every viewer location (Vance, STL, Grayson, Biztech…) is itself a tracked
// WAN circuit, so its IP is the host of that circuit. Build the lookup as
// connection checks stream in.
const connectionHostByToken = new Map(); // "vance" -> "207.242.49.34" (fiber preferred)
const viewerAgent = new Map();           // "Eureka NOC" -> "<proj>/<sys>"
const agentViewerNames = new Map();      // "<proj>/<sys>" -> Set("Eureka NOC","Biztech NOC")

function locationToken(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';
}
function recordViewerLocation(payload, system) {
  // Target circuit's location → its own host (the location's IP). Prefer a
  // "fiber" circuit's host when a location has several circuits.
  const circuit = String(payload.subjectLabel || payload.label || '').replace(/\s*\(from [^)]*\)\s*/i, '').trim();
  const ctoken = locationToken(circuit);
  if (ctoken && payload.host && (!connectionHostByToken.has(ctoken) || /fiber/i.test(circuit))) {
    connectionHostByToken.set(ctoken, payload.host);
  }
  // The viewer (vantage) name + the agent that publishes it.
  const m = String(payload.label || '').match(/\(from ([^)]*)\)/i);
  const viewer = m && m[1].trim();
  if (viewer && system) {
    viewerAgent.set(viewer, system);
    let names = agentViewerNames.get(system);
    if (!names) { names = new Set(); agentViewerNames.set(system, names); }
    names.add(viewer);
  }
}
function viewerIp(name) {
  const direct = connectionHostByToken.get(locationToken(name));
  if (direct) return direct;
  // The same agent can be labelled differently elsewhere (e.g. "Eureka NOC" is
  // the same agent as "Biztech NOC") — try the agent's other location names.
  const agent = viewerAgent.get(name);
  if (agent) {
    for (const alt of agentViewerNames.get(agent) || []) {
      const ip = connectionHostByToken.get(locationToken(alt));
      if (ip) return ip;
    }
  }
  return '';
}

function companyOnline(entry) {
  const now = Date.now();
  // Online if any covering agent has reported (heartbeat or check) recently.
  for (const sys of entry.systems || []) {
    if (now - (systemActivity.get(sys) || 0) < ONLINE_MS) return true;
  }
  return false;
}

// The signed-in user's allowed company ids, or null when their view is
// unrestricted (admin / account manager). Drives the per-viewer IP filter so a
// viewer only ever receives the IPs an admin granted them — and a newly seen IP
// reaches admins automatically but no viewer until it is granted.
function allowedCompanyIds() {
  const ids = auth.visibleCompaniesFor(auth.currentUser());
  return ids ? new Set(ids) : null;
}

// A connection is "historical" when it is no longer tracked on the broker: its
// retained check topic was deleted (tombstone) or was absent from the retained
// burst after a (re)connect. Purely presence-based — no staleness timers — so it
// is symmetric with how a newly-published retained message adds a connection. A
// check whose retained record still exists but whose agent is down is NOT
// historical; it stays "offline" (grey) and can come back.
function companyHistorical(companyId) {
  if (Date.now() < trackingDiscoveryDeadline) return false; // let the retained burst arrive first
  const topics = companyCheckTopics.get(companyId);
  if (!topics || topics.size === 0) return true;            // nothing tracked this connect
  for (const t of topics) if (trackedCheckTopics.has(t)) return false;
  return true;                                              // every check topic untracked
}

// The full roster (every company ever seen) merged with this session's live
// data. Live companies report their real status; the rest read as offline.
function companyList() {
  const out = new Map();
  for (const r of roster.values()) {
    out.set(r.id, { id: r.id, label: r.label, status: 'offline', online: false, checks: 0, historical: companyHistorical(r.id), lastSeen: r.lastSeen || 0 });
  }
  for (const e of companies.values()) {
    const online = companyOnline(e);
    const lastPing = e.pings.length ? e.pings[e.pings.length - 1] : null;
    const lastSeen = lastPing && lastPing.checkedAt ? Date.parse(lastPing.checkedAt) : 0;
    // HISTORICAL = no longer tracked on the broker (its retained record was deleted).
    // Presence-based, not time-based: a check whose retained message still exists but
    // whose agent is down stays "offline" (grey); a deleted connection moves to the
    // historical roster — symmetric with how a new retained message adds it.
    const historical = companyHistorical(e.id);
    out.set(e.id, {
      id: e.id,
      label: e.label,
      status: online ? companyWorst(e) : 'offline',
      online,
      checks: e.lastByCheck.size,
      host: (lastPing && lastPing.host) || '', // target IP, for search-by-IP
      historical,
      lastSeen,
    });
  }
  const allowed = allowedCompanyIds();
  let list = [...out.values()];
  if (allowed) list = list.filter((c) => allowed.has(c.id));
  // Live clients first (left), offline clients last (right); alphabetical within each.
  return list.sort((a, b) =>
    (Number(b.online) - Number(a.online)) || a.label.localeCompare(b.label));
}

// Aggregate health across the whole fleet — drives the tray icon, tooltip,
// right-click menu, and popover.
function overallSnapshot() {
  // Historical (taken-off-the-network) connections are excluded from the fleet
  // status — a deliberately-removed circuit must not amber the tray as "offline"
  // (the pie already filters them out). Genuinely-offline circuits (agent down,
  // retained record still present) are NOT historical and still count.
  const list = companyList().filter((c) => !c.historical);
  const down = list.filter((c) => c.online && c.status === 'red').map((c) => c.label);
  const degraded = list.filter((c) => c.online && c.status === 'yellow').map((c) => c.label);
  const offline = list.filter((c) => !c.online).map((c) => c.label);
  // Red if a client is down; amber if a client is degraded OR we've lost
  // monitoring on one (offline); green only when everything is live and healthy.
  const status = down.length ? 'red' : (degraded.length || offline.length) ? 'yellow' : 'green';
  let detail;
  if (!list.length) {
    detail = 'Waiting for data…';
  } else if (status === 'green') {
    detail = `All ${list.length} clients healthy`;
  } else {
    const parts = [];
    if (down.length) parts.push(`${down.length} down`);
    if (degraded.length) parts.push(`${degraded.length} degraded`);
    if (offline.length) parts.push(`${offline.length} offline`);
    detail = parts.join(' · ');
  }
  return { status, detail, down, degraded, offline, live: list.length - offline.length, total: list.length, checkedAt: lastCheckedAt };
}

function statusSnapshot() {
  return { status: currentStatus || overallSnapshot(), connectionState: currentConnectionState };
}

let overallBroadcastAt = 0;

// ─── Ticketing emission ───────────────────────────────────────────────────────
// The companion ticketing app stores tickets as retained MQTT docs on tickets/<id>.
// The monitor is the ONLY automatic creator: on a sustained-outage (red) transition
// it publishes ONE retained ticket. Detection mirrors the tray-red rule exactly.
const companyRedState = new Map(); // companyId -> { red, episodeKey }
const ticketCache = new Map();     // ticketId -> retained ticket doc (from tickets/#)

function publishTicketEvent(topic, obj, { retain = false } = {}) {
  if (!mqttClient) return;
  try { mqttClient.publish(topic, JSON.stringify(obj), { qos: 1, retain }); } catch { /* offline */ }
}

// Deterministic id from the episode key so every monitor instance that observes the
// same outage writes the SAME retained topic — N publishers collapse to one ticket.
function ticketIdFromEpisode(episodeKey) {
  return episodeKey.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function maybeCreateTicket(entry, episodeKey, host) {
  const id = ticketIdFromEpisode(episodeKey);
  if (ticketCache.has(id)) return; // already created (this or another instance)
  const nowIso = new Date().toISOString();
  const doc = {
    id, episodeKey,
    companyId: entry.id, companyLabel: entry.label, host: host || '',
    severity: 'red', state: 'open', createdAt: nowIso,
    assignee: null, assignedBy: null, claimedBy: null,
    recoveredAt: null, resolvedAt: null, resolvedBy: null,
    updatedAt: Date.now(), version: 1,
    history: [{ at: nowIso, by: 'system', action: 'created',
      detail: `Sustained outage detected (${CRITICAL_DOWN_STREAK}+ consecutive down minutes)` }],
  };
  ticketCache.set(id, doc);                       // optimistic: dedup before the retained echo
  publishTicketEvent(`tickets/${id}`, doc, { retain: true });
}

// Record recovery WITHOUT closing the ticket (a human resolves it). Merge only the
// machine-owned fields onto the current retained doc — never touch assignee/claim/state.
function markTicketRecovered(episodeKey) {
  const id = ticketIdFromEpisode(episodeKey);
  const cur = ticketCache.get(id);
  if (!cur || cur.state === 'resolved' || cur.recoveredAt) return;
  const nowIso = new Date().toISOString();
  const doc = { ...cur, recoveredAt: nowIso, updatedAt: Date.now(), version: (cur.version || 0) + 1,
    history: [...(cur.history || []), { at: nowIso, by: 'system', action: 'recovered', detail: 'Connection recovered' }] };
  ticketCache.set(id, doc);
  publishTicketEvent(`tickets/${id}`, doc, { retain: true });
}

// Fires once per outage episode on the rising edge (->red); records recovery only on
// a genuine red->green while STILL ONLINE (an agent going offline is not a recovery).
function detectTicketTransitions() {
  for (const e of companies.values()) {
    const online = companyOnline(e);
    const { levels } = derivedFor(e);
    const streak = trailingDownStreakFromLevels(levels);
    const isRed = online && streak >= CRITICAL_DOWN_STREAK;
    const prev = companyRedState.get(e.id) || { red: false, episodeKey: null };
    if (isRed && !prev.red) {
      const startMs = levels[levels.length - streak].ms; // first down-minute of the run (stable across the episode)
      const episodeKey = `${e.id}:${new Date(startMs).toISOString()}`;
      companyRedState.set(e.id, { red: true, episodeKey });
      const lastPing = e.pings.length ? e.pings[e.pings.length - 1] : null;
      maybeCreateTicket(e, episodeKey, (lastPing && lastPing.host) || '');
    } else if (prev.red && online && streak < CRITICAL_DOWN_STREAK) {
      companyRedState.set(e.id, { red: false, episodeKey: null });
      if (prev.episodeKey) markTicketRecovered(prev.episodeKey);
    }
    // prev.red && !online: leave pending — no false "recovery" when an agent dies.
  }
}

function connectMqtt() {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }

  currentConnectionState = 'grey';
  broadcastConnectionState('grey');
  updateTray('grey');

  const url = `mqtt://${settings.mqttHost}:${settings.mqttPort}`;
  console.log(`[MQTT] Connecting to ${url}`);

  mqttClient = mqtt.connect(url, { clean: true, reconnectPeriod: 15_000 });

  mqttClient.on('connect', () => {
    console.log('[MQTT] Connected — subscribing to checks, connections, heartbeats');
    // Local server checks live under <proj>/<sys>/checks/<id>; client WAN circuits
    // (the connection tests) live under connections/<subject>/<proj>/<sys>/<id>;
    // each agent's liveness comes from <proj>/<sys>/heartbeat.
    mqttClient.subscribe(['+/+/checks/+', 'connections/#', '+/+/heartbeat'], { qos: 0 });
    // Rebuild the tracked-connection set from this connect's retained burst: clear it
    // and give the retained messages a short window to arrive before any connection is
    // judged "untracked". This catches removals that happened while we were offline.
    trackedCheckTopics.clear();
    trackingDiscoveryDeadline = Date.now() + TRACKING_DISCOVERY_MS;
    // Shared ticket store for the companion ticketing app: keep a live cache of the
    // retained ticket docs so we can dedup creation and merge recovery without
    // clobbering human edits (claim/assign/resolve).
    mqttClient.subscribe('tickets/#', { qos: 1 });
  });

  mqttClient.on('message', (topic, message) => {
    // Retained ticket docs (tickets/<id>) feed the shared ticket cache. Handle this
    // BEFORE the generic JSON.parse so an empty-payload retained clear acts as a
    // tombstone rather than being dropped as unparseable.
    if (topic.startsWith('tickets/')) {
      const id = topic.slice('tickets/'.length);
      if (!message || message.length === 0) ticketCache.delete(id);
      else { try { ticketCache.set(id, JSON.parse(message.toString())); } catch { /* ignore */ } }
      return;
    }

    // Empty retained payload on a check/connection topic = its retained record was
    // deleted, i.e. the connection is no longer tracked in the explorer. Drop it from
    // the tracked set (mirrors the tickets/ tombstone above) so companyList moves it to
    // the historical roster, then refresh the tray/popover immediately. No time logic.
    if (message.length === 0 && (topic.includes('/checks/') || topic.startsWith('connections/'))) {
      if (trackedCheckTopics.delete(topic)) {
        currentStatus = overallSnapshot();
        updateTray(currentStatus.status);
        broadcastToRenderer(currentStatus);
      }
      return;
    }

    let payload;
    try { payload = JSON.parse(message.toString()); } catch { return; }
    const parts = topic.split('/');

    // Heartbeat: just marks the agent (system) alive — used for online/offline.
    if (topic.endsWith('/heartbeat')) {
      const system = `${parts[0]}/${parts[1]}`;
      const ts = payload.publishedAt ? new Date(payload.publishedAt).getTime() : 0;
      if (ts) systemActivity.set(system, Math.max(systemActivity.get(system) || 0, ts));
      setConnectionState('live');
      return;
    }

    // Identify the publishing agent from the topic shape.
    let system = null;
    if (topic.includes('/checks/')) {
      system = `${parts[0]}/${parts[1]}`;               // <proj>/<sys>/checks/<id>
    } else if (parts[0] === 'connections' && parts.length >= 5) {
      system = `${parts[2]}/${parts[3]}`;               // connections/<subject>/<proj>/<sys>/<id>
      recordViewerLocation(payload, system);
    } else {
      return; // ignore legacy <proj>/<sys>/status and anything else
    }

    const tts = payload.checkedAt || payload.lastReceived;
    if (tts) systemActivity.set(system, Math.max(systemActivity.get(system) || 0, new Date(tts).getTime()));

    // Mark this topic tracked BEFORE ingest: a retained re-delivery that duplicates
    // persisted history makes ingestCheck return null, but the retained record still
    // exists, so the connection is still tracked. Derive the company id the same way.
    const trackedCo = companyForCheck(payload.label, payload.id);
    trackedCheckTopics.add(topic);
    let cset = companyCheckTopics.get(trackedCo.id);
    if (!cset) { cset = new Set(); companyCheckTopics.set(trackedCo.id, cset); }
    cset.add(topic);

    const res = ingestCheck(payload, system);
    if (!res) return;
    broadcastCheck(res.companyId, res.ping);

    const age = lastCheckedAt ? Date.now() - new Date(lastCheckedAt).getTime() : Infinity;
    if (age > STALE_MS) { setConnectionState('black'); return; }
    setConnectionState('live');

    // Checks arrive in per-minute bursts; coalesce the tray/popover refresh.
    const now = Date.now();
    if (now - overallBroadcastAt > 1500) {
      overallBroadcastAt = now;
      currentStatus = overallSnapshot();
      updateTray(currentStatus.status);
      broadcastToRenderer(currentStatus);
      detectTicketTransitions();
    }
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] Error:', err.message);
    setConnectionState('black');
  });

  mqttClient.on('close', () => {
    if (currentConnectionState === 'live') updateTray('grey');
  });
}

// ─── Staleness interval ───────────────────────────────────────────────────────

// Runs every minute to catch the case where MQTT is connected but the API
// stopped publishing (no new messages for 24h).
function startStalenessCheck() {
  setInterval(() => {
    if (currentConnectionState === 'black') return;
    if (!lastCheckedAt) return;
    const age = Date.now() - new Date(lastCheckedAt).getTime();
    if (age > STALE_MS) {
      console.log('[STALENESS] No update in 24h — going black');
      setConnectionState('black');
    }
  }, 60_000);
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function statusLabel(s) {
  const labels = {
    green: 'All healthy', yellow: 'Attention needed',
    red: 'Client down', grey: 'Connecting…', black: 'No updates',
  };
  return labels[s] || 'Unknown';
}

function buildContextMenu() {
  const items = [{ label: 'Status Monitor', enabled: false }];
  const snap = (auth.currentUser() && currentConnectionState === 'live') ? overallSnapshot() : null;
  if (!snap) {
    items.push({ label: `Status: ${statusLabel(currentConnectionState)}`, enabled: false });
  } else {
    items.push({ label: snap.detail, enabled: false });
    // Name the clients that need attention so the menu tells the whole story.
    const addNames = (prefix, names) => {
      if (!names.length) return;
      items.push({ type: 'separator' });
      for (const n of names.slice(0, 8)) items.push({ label: `   ${prefix} ${n}`, enabled: false });
      if (names.length > 8) items.push({ label: `   …and ${names.length - 8} more`, enabled: false });
    };
    addNames('✕', snap.down);       // down
    addNames('▲', snap.degraded);   // degraded
    addNames('○', snap.offline);    // offline (lost monitoring)
  }
  items.push(
    { type: 'separator' },
    { label: 'Open Details', click: () => showExpandedWindow(true) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  );
  return Menu.buildFromTemplate(items);
}

let lastTrayStatus = 'grey';
function updateTray(status) {
  if (!tray) return;
  lastTrayStatus = status;
  // No status is revealed until someone is signed in — the tray icon stays
  // neutral grey while signed out.
  const signedIn = !!auth.currentUser();
  const effective = signedIn ? status : 'grey';
  tray.setImage(icons[effective] || icons.grey);
  // No OS tooltip at all on the tray icon (hovering opens the popover instead).
  tray.setToolTip('');
}

// ─── Main window ──────────────────────────────────────────────────────────────

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  // Base options shared across platforms.
  const opts = {
    width: POPOVER_WIDTH,
    height: POPOVER_INITIAL_HEIGHT,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    frame: false,            // frameless — no OS title bar / chrome
    transparent: true,       // per-pixel transparency — only the CSS .panel paints
    backgroundColor: '#00000000', // fully transparent base (no opaque window fill)
    roundedCorners: true,    // honored on macOS; Win11 rounds frameless windows automatically
    // hasShadow MUST be false on a transparent frameless window: on Windows the DWM
    // shadow is drawn around the window's full RECTANGLE (it ignores the CSS
    // border-radius), which shows up as the grey rectangle behind the rounded panel.
    hasShadow: false,
    thickFrame: false,       // no native resize/frame surface that could paint a rect
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  };

  if (process.platform === 'darwin') {
    // macOS native vibrancy. macOS clips vibrancy to the window's rounded shape,
    // so no rectangular backdrop leaks out behind the corners.
    opts.vibrancy = 'under-window';
    opts.visualEffectState = 'active';
  } else if (process.platform === 'win32') {
    // Windows 11: real OS acrylic so DWM blurs the desktop / other app windows
    // BEHIND the popover. backgroundMaterial requires a NON-transparent window,
    // so transparent is flipped off; backgroundColor #00000000 = pure acrylic
    // with no fill, and the .panel paints the widget-well tint on top. DWM rounds
    // the frameless window at its native radius (the .panel is squared to match
    // under body.win-acrylic so no corner leaks).
    opts.transparent = false;
    opts.backgroundColor = '#00000000';
    opts.backgroundMaterial = 'acrylic';
    // DWM backdrop effects (acrylic/mica) need the window to keep WS_THICKFRAME —
    // a frameless window with thickFrame:false won't render the acrylic at all.
    opts.thickFrame = true;
  } else {
    // Linux / other: stay transparent too. An opaque window backgroundColor
    // ('#141414') was the grey rectangle here — the .panel's CSS rgba fill is
    // the only surface. Compositing-less WMs degrade to the panel rgba, which is
    // still acceptable; no window-level opaque rectangle is ever drawn.
  }

  mainWindow = new BrowserWindow(opts);
  if (process.platform === 'win32' && typeof mainWindow.setBackgroundMaterial === 'function') {
    // Some Electron builds only apply acrylic when set after construction.
    try { mainWindow.setBackgroundMaterial('acrylic'); } catch { /* older Electron: no-op */ }
  }
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.setContentSize(POPOVER_WIDTH, POPOVER_PEEK_HEIGHT);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    hidePopover();
  });

  mainWindow.on('blur', () => {
    if (mainWindow.webContents.isDevToolsOpened()) return;
    // The legend window is open: keep the popover up (the legend stole our focus).
    // Closing the legend returns focus here, so the SECOND off-click blurs the
    // popover and runs the dismiss below. The short recency window only absorbs any
    // focus churn from that refocus — it is NOT long enough to swallow a real
    // second click (which is a deliberate, later action).
    if (legendOpen || Date.now() - legendClosedAt < 150) return;
    if (popoverPinned) {
      // A tray click that pins the popover can briefly blur it; ignore that single
      // blur for a moment after pinning. A real off-click is a deliberate, later
      // action, so it still closes the popover. (Don't gate this on pointerInTray —
      // Windows tray mouse-leave is unreliable and can stick it 'true' forever.)
      if (Date.now() - popoverPinnedAt < 250) return;
      hidePopover();
      return;
    }
    if (!popoverPinned && !pointerInPopover && !pointerInTray) schedulePeekHide();
  });

  mainWindow.on('hide', () => {
    resetToHoverBaseline();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    sendPopoverMode();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.setContentSize(POPOVER_WIDTH, POPOVER_PEEK_HEIGHT);
    positionWindow();
  });

  return mainWindow;
}

function cancelHideTimer() {
  if (!hideTimer) return;
  clearTimeout(hideTimer);
  hideTimer = null;
}

function resetToHoverBaseline() {
  cancelHideTimer();
  popoverPinned = false;
  pointerInPopover = false;
  pointerInTray = false;
  pendingPopover = null;
  capturedAnchorPoint = null;
  popoverMode = 'peek';
  lastAnchorEdge = 'bottom';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(false);
    // Only reposition while VISIBLE. Repositioning a HIDDEN window here — with the
    // anchor just cleared above — re-anchors it to the live cursor (which is now far
    // from the tray, so capturePopoverAnchor falls back to the cursor). A later show
    // then made the window flash at the cursor instead of by the tray icon.
    if (mainWindow.isVisible()) applyPopoverBounds(POPOVER_PEEK_HEIGHT, false);
    sendAnchorEdge();
    sendPopoverMode();
  }
}

function hidePopover() {
  hideLegendWindow();
  hideDismissScrim();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  resetToHoverBaseline();
}

// ─── Legend window (the "i" key) ──────────────────────────────────────────────
// A separate frameless acrylic window — same shell as the popover — opened to the
// LEFT of the popover. It reuses the popover renderer in legend-only mode
// (?legend=1). Closing on blur + the popover's suppression flag give the layered
// dismiss the user asked for.
function legendWindowOpts() {
  const o = {
    width: LEGEND_W, height: LEGEND_H, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', hasShadow: false, thickFrame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
  };
  if (process.platform === 'darwin') { o.vibrancy = 'under-window'; o.visualEffectState = 'active'; }
  else if (process.platform === 'win32') { o.transparent = false; o.backgroundMaterial = 'acrylic'; o.thickFrame = true; }
  return o;
}

function ensureLegendWindow() {
  if (legendWindow && !legendWindow.isDestroyed()) return legendWindow;
  legendWindow = new BrowserWindow(legendWindowOpts());
  if (process.platform === 'win32' && typeof legendWindow.setBackgroundMaterial === 'function') {
    try { legendWindow.setBackgroundMaterial('acrylic'); } catch { /* older Electron */ }
  }
  legendWindow.setAlwaysOnTop(true, 'screen-saver');
  legendWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    legendWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?legend=1`);
  } else {
    legendWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { search: 'legend=1' });
  }
  // Legend loses focus only when the user clicks the POPOVER itself (off-clicks are
  // caught by the dismiss scrim, which is non-activating and doesn't move focus).
  // Closing here keeps the scrim up so the next off-click still closes the dashboard.
  legendWindow.on('blur', () => {
    if (legendWindow && legendWindow.webContents.isDevToolsOpened()) return;
    hideLegendWindow();
  });
  legendWindow.on('close', (e) => { if (!isQuitting) { e.preventDefault(); hideLegendWindow(); } });
  return legendWindow;
}

function showLegendWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  const w = ensureLegendWindow();
  const b = mainWindow.getBounds();
  // To the LEFT of the popover, bottom-aligned (the "i" sits in the popover's
  // bottom-left corner). Clamp onto the popover's display work area.
  const area = screen.getDisplayMatching(b).workArea;
  let x = b.x - LEGEND_W - 8;
  let y = b.y + b.height - LEGEND_H;
  if (x < area.x + 4) x = b.x + b.width + 8;            // no room left → flip right
  if (x + LEGEND_W > area.x + area.width - 4) x = area.x + area.width - LEGEND_W - 4;
  if (y < area.y + 4) y = area.y + 4;
  if (y + LEGEND_H > area.y + area.height - 4) y = area.y + area.height - LEGEND_H - 4;
  w.setBounds({ x: Math.round(x), y: Math.round(y), width: LEGEND_W, height: LEGEND_H });
  legendOpen = true;
  w.show(); // focus it so a click ON THE POPOVER fires its blur (and closes it)
  showDismissScrim(); // catch OFF-clicks for the layered dismiss
}

// ─── Dismiss scrim (catches off-clicks while the legend is open) ───────────────
function dismissScrimOpts() {
  return {
    show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, focusable: false, backgroundColor: '#00000000',
    thickFrame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
  };
}

// Inlined as a data URL (NOT a file): electron-forge's Vite build only emits the JS
// entry points to .vite/build, so a static scrim.html next to the source isn't there
// at runtime. The preload still applies, so window.electron.scrimClick() is available.
const SCRIM_HTML =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'">' +
  '<style>html,body{margin:0;padding:0;width:100vw;height:100vh;background:transparent;overflow:hidden;cursor:default}</style></head>' +
  '<body><script>window.addEventListener("mousedown",function(){try{window.electron&&window.electron.scrimClick();}catch(e){}},true);</script></body></html>';

function ensureDismissScrim() {
  if (dismissScrim && !dismissScrim.isDestroyed()) return dismissScrim;
  dismissScrim = new BrowserWindow(dismissScrimOpts());
  dismissScrim.setIgnoreMouseEvents(false);
  dismissScrim.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SCRIM_HTML));
  dismissScrim.on('close', (e) => { if (!isQuitting) { e.preventDefault(); hideDismissScrim(); } });
  return dismissScrim;
}

function showDismissScrim() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  const w = ensureDismissScrim();
  // Cover the union of every display so an off-click on any monitor is caught.
  const ds = screen.getAllDisplays();
  const x = Math.min(...ds.map((d) => d.bounds.x));
  const y = Math.min(...ds.map((d) => d.bounds.y));
  const right = Math.max(...ds.map((d) => d.bounds.x + d.bounds.width));
  const bottom = Math.max(...ds.map((d) => d.bounds.y + d.bounds.height));
  w.setBounds({ x, y, width: right - x, height: bottom - y });
  w.setAlwaysOnTop(true); // below the popover/legend ('screen-saver' level)
  w.showInactive();       // never steal focus
  // Keep the popover and legend ABOVE the scrim so they stay clickable.
  if (legendWindow && !legendWindow.isDestroyed() && legendWindow.isVisible()) legendWindow.moveTop();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.moveTop();
}

function hideDismissScrim() {
  if (dismissScrim && !dismissScrim.isDestroyed() && dismissScrim.isVisible()) dismissScrim.hide();
}

function hideLegendWindow() {
  if (!legendOpen && (!legendWindow || !legendWindow.isVisible())) return;
  legendOpen = false;
  legendClosedAt = Date.now();
  if (legendWindow && !legendWindow.isDestroyed()) legendWindow.hide();
}

function toggleLegendWindow() {
  // Clicking the "i" while the legend is open first blurs (and closes) the legend
  // window; without this recency guard the toggle would then re-open it. Treat a
  // just-closed legend as "close", so the "i" reliably toggles.
  if (legendOpen || Date.now() - legendClosedAt < 250) { hideLegendWindow(); return; }
  showLegendWindow();
}

function schedulePeekHide() {
  cancelHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (isCursorInPopover()) return;
    if (popoverPinned || pointerInPopover || pointerInTray) return;
    hidePopover();
  }, POPOVER_HIDE_GRACE_MS);
}

function sendPopoverMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:mode', popoverMode);
}

function sendAnchorEdge() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:anchor-edge', lastAnchorEdge);
}

function targetHeightForMode(mode) {
  return mode === 'expanded' ? POPOVER_EXPANDED_HEIGHT : POPOVER_PEEK_HEIGHT;
}

function boundsForHeight(height, pinned = popoverPinned) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const current = mainWindow.getBounds();
  const width = POPOVER_WIDTH;

  if (pinned) {
    const display = screen.getDisplayMatching(current);
    const workArea = display.workArea;
    const x = Math.round(Math.min(
      Math.max(current.x, workArea.x),
      workArea.x + workArea.width - width
    ));
    const y = lastAnchorEdge === 'bottom'
      ? current.y + current.height - height
      : current.y;
    const clampedY = Math.round(Math.min(
      Math.max(y, workArea.y),
      workArea.y + workArea.height - height
    ));
    return { x, y: clampedY, width, height };
  }

  return boundsForTrayAnchor(height);
}

function applyPopoverBounds(targetHeight, pinned = popoverPinned) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = boundsForHeight(targetHeight, pinned);
  if (bounds) mainWindow.setBounds(bounds);
}

function applyPopoverSize(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  applyPopoverBounds(targetHeightForMode(mode));
}

function setPopoverMode(mode) {
  popoverMode = mode;
  applyPopoverSize(mode);
  sendAnchorEdge();
  sendPopoverMode();
}

function pinPopover() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  cancelHideTimer();
  pendingPopover = null;
  pointerInPopover = true;
  popoverPinned = true;
  mainWindow.setIgnoreMouseEvents(false);
  if (popoverMode === 'peek') setPopoverMode('expanded');
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function trayBoundsAreUsable(trayBounds, cursorPoint) {
  if (!trayBounds || trayBounds.width <= 2 || trayBounds.height <= 2) return false;
  const trayCenter = {
    x: trayBounds.x + trayBounds.width / 2,
    y: trayBounds.y + trayBounds.height / 2,
  };
  const distance = Math.hypot(trayCenter.x - cursorPoint.x, trayCenter.y - cursorPoint.y);
  return distance <= 180;
}

function capturePopoverAnchor() {
  // Once the popover is open with an anchor, keep it FIXED for the whole visible
  // session — any stray re-anchor (e.g. a resize-driven reposition reading the
  // live cursor) would make the window trail the mouse. The anchor is cleared on
  // hide (resetToHoverBaseline), so the next open captures fresh.
  if (capturedAnchorPoint && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    return capturedAnchorPoint;
  }
  const trayBounds = tray.getBounds();
  const cursorPoint = screen.getCursorScreenPoint();
  const hasUsableTrayBounds = trayBoundsAreUsable(trayBounds, cursorPoint);
  capturedAnchorPoint = hasUsableTrayBounds
    ? {
        x: trayBounds.x + trayBounds.width / 2,
        y: trayBounds.y,
      }
    : cursorPoint;
  return capturedAnchorPoint;
}

function popoverAnchor() {
  const anchorPoint = capturedAnchorPoint || capturePopoverAnchor();
  const display = screen.getDisplayNearestPoint(anchorPoint);
  return { anchorPoint, display };
}

function isCursorInPopover(padding = 8) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const cursor = screen.getCursorScreenPoint();
  const bounds = mainWindow.getBounds();
  return cursor.x >= bounds.x - padding
    && cursor.x <= bounds.x + bounds.width + padding
    && cursor.y >= bounds.y - padding
    && cursor.y <= bounds.y + bounds.height + padding;
}

function maxPopoverHeight() {
  const { display } = popoverAnchor();
  return Math.max(POPOVER_MIN_HEIGHT, display.workArea.height - 4);
}

function boundsForTrayAnchor(height = null) {
  if (!tray || !mainWindow || mainWindow.isDestroyed()) return;

  const windowBounds = mainWindow.getBounds();
  const { anchorPoint, display } = popoverAnchor();
  const workArea = display.workArea;
  const width = POPOVER_WIDTH;
  const targetHeight = height ?? windowBounds.height;
  let x = anchorPoint.x - width / 2;
  let y = anchorPoint.y - targetHeight - POPOVER_ANCHOR_GAP;
  const anchorNearTop = anchorPoint.y < workArea.y + workArea.height / 2;

  if (anchorNearTop) {
    lastAnchorEdge = 'top';
    y = anchorPoint.y + POPOVER_ANCHOR_GAP;
  } else {
    lastAnchorEdge = 'bottom';
  }

  x = Math.round(Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width));
  y = Math.round(Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - targetHeight));

  return { x, y, width, height: targetHeight };
}

function positionWindow() {
  const bounds = boundsForTrayAnchor();
  if (bounds) mainWindow.setBounds(bounds);
}

function showPopover(mode, focus, pinned = false) {
  if (!mainWindow) createWindow();

  cancelHideTimer();
  if (!mainWindow.isVisible() && !pinned) {
    popoverPinned = false;
    pointerInPopover = false;
    pendingPopover = null;
    capturePopoverAnchor();
  }
  const wasVisible = mainWindow.isVisible();
  popoverPinned = pinned && wasVisible;
  setPopoverMode(mode);
  popoverPinned = pinned;
  positionWindow();

  if (!popoverReady) {
    pendingPopover = { mode, focus, pinned };
    return;
  }

  if (focus) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
  } else {
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.showInactive();
    mainWindow.moveTop();
  }
}

function flushPendingPopover() {
  if (!pendingPopover || !mainWindow || mainWindow.isDestroyed()) return;
  const { mode, focus, pinned } = pendingPopover;
  pendingPopover = null;
  popoverPinned = pinned;
  setPopoverMode(mode);
  positionWindow();
  if (focus) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
  } else {
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.showInactive();
    mainWindow.moveTop();
  }
}

function showPeekWindow() {
  pointerInPopover = false;
  popoverPinned = false;
  capturePopoverAnchor();
  showPopover('peek', false, false);
}

function showExpandedWindow(pinned = false) {
  pointerInPopover = false;
  // Always focus (2nd arg) so Windows renders the OS acrylic backdrop — an
  // unfocused window (showInactive) falls back to a flat, non-blurred fill, which
  // is why hover used to look non-acrylic. `pinned` still controls whether the
  // popover stays open after the pointer leaves the tray/popover.
  showPopover('expanded', true, pinned);
  if (pinned) popoverPinnedAt = Date.now();
}

// ─── Dashboard window ───────────────────────────────────────────────────────

function dashboardIndexPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'dashboard', 'index.html');
  }

  const candidates = [
    path.join(app.getAppPath(), 'dashboard', 'index.html'),
    path.join(process.cwd(), 'dashboard', 'index.html'),
    path.join(__dirname, '..', '..', 'dashboard', 'index.html'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

// The dashboard markup (dashboard/index.html) is the canonical default layout —
// a brand-new account just renders it. This used to seed a saved "Baxley"
// snapshot from default-layout.json, which kept resurrecting the old layout
// (gauge + count cards) over the current default, so seeding is disabled.
function seedDefaultLayoutForUser() {}

function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    return dashboardWindow;
  }

  // The dashboard renderer draws its own window chrome (drag region +
  // minimize/close/reload glass controls), so the window is frameless.
  // sandbox:false lets dashboard-preload.js use node:fs for the synchronous
  // layout persistence bridge the dashboard builder requires.
  dashboardWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    resizable: false,   // fixed size — the grid layout is tuned to this window
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f8fb',
    webPreferences: {
      preload: path.join(__dirname, 'dashboard-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  seedDefaultLayoutForUser(auth.currentUser());
  // ⚠ NO HOT-RELOAD: the dashboard is loaded from a STATIC FILE (not the Vite dev
  // server), so edits to dashboard/app/static/* (auth-ui.js, themes.css,
  // widget-registry.js, status-feed.js, app.js, …) DO NOT appear until this window
  // is reloaded (Ctrl+R / the refresh control / dash.reload() over CDP). If a CSS
  // or JS change "isn't working", reload before assuming the code is wrong — and
  // verify visual changes by screenshotting over CDP, never by guessing. (The tray
  // popover, src/*, is React on the Vite server and DOES hot-reload.)
  dashboardWindow.loadFile(dashboardIndexPath());

  dashboardWindow.once('ready-to-show', () => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
    dashboardWindow.show();
    dashboardWindow.focus();
  });

  dashboardWindow.webContents.once('did-finish-load', () => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
    dashboardWindow.webContents.send('mqtt:connection', currentConnectionState);
    if (currentStatus) dashboardWindow.webContents.send('mqtt:status', currentStatus);
  });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });

  return dashboardWindow;
}

function openDashboardWindow() {
  const window = createDashboardWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function openRendererWindows() {
  return [mainWindow, dashboardWindow].filter((win) => win && !win.isDestroyed());
}

function broadcastToRenderer(payload) {
  openRendererWindows().forEach((win) => win.webContents.send('mqtt:status', payload));
}

function broadcastConnectionState(state) {
  openRendererWindows().forEach((win) => win.webContents.send('mqtt:connection', state));
}

// A single new ping for one company → the dashboard (which buffers per company).
function broadcastCheck(companyId, ping) {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('mqtt:check', { companyId, ping });
  }
}

// ─── Notifications ────────────────────────────────────────────────────────────

function sendNotification(payload) {
  if (!Notification.isSupported()) return;
  const titles = { green: 'Status OK', yellow: 'Status Warning', red: 'Status Error' };
  new Notification({
    title: titles[payload.status] || 'Status Changed',
    body: payload.detail || '',
    urgency: payload.status === 'red' ? 'critical' : 'normal',
  }).show();
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();

  roster = loadRoster();
  loadPingsCache(); // restore per-company ping history before live data resumes
  rollUpAllAged();  // fold any pings that aged past the raw window while we were closed
  auth.init();

  tray = new Tray(icons.grey);
  updateTray('grey');
  createWindow();

  // The dashboard is the primary surface: open it on launch so users sign in
  // and land on it by default (the tray popover remains available).
  openDashboardWindow();

  // LEFT click toggles the popover near the tray icon.
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      // Already open. A hover-opened popover isn't pinned yet — a click should just
      // PIN it so it stays put. The old code re-showed it (positionWindow + show),
      // which read as a jarring close-and-reopen. A click on an already-pinned
      // popover toggles it closed.
      if (popoverPinned) hidePopover();
      else {
        // Hover-opened → pin it in place (no re-show, so no flicker). focus() is
        // required: the tray click blurs the popover, and without re-focusing it a
        // later off-click wouldn't blur it and it'd never close. Stamp the pin time
        // so the brief blur from THIS click is ignored (see the blur handler).
        popoverPinned = true;
        popoverPinnedAt = Date.now();
        cancelHideTimer();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
      }
    } else {
      showExpandedWindow(true);
    }
  });

  if (SUPPORTS_TRAY_HOVER) {
    // macOS and Windows expose tray hover. Windows can be unreliable when the
    // icon lives in the overflow flyout instead of the visible taskbar.
    tray.on('mouse-enter', () => {
      pointerInTray = true;
      // Windows fires mouse-enter repeatedly as the cursor moves over the icon.
      // Only OPEN (and anchor) the popover when it isn't already showing — re-
      // showing on every event re-ran positionWindow, so the window trailed the
      // cursor before the hide grace elapsed. While it's already open we just
      // keep it open (cancel any pending hide) without re-anchoring it.
      cancelHideTimer();
      if (!mainWindow || !mainWindow.isVisible()) {
        showExpandedWindow(false);
      }
    });

    tray.on('mouse-leave', () => {
      pointerInTray = false;
      if (!popoverPinned && !pointerInPopover) schedulePeekHide();
    });
  }

  // RIGHT click shows the status breakdown + show/quit menu.
  tray.on('right-click', () => {
    tray.popUpContextMenu(buildContextMenu());
  });

  startStalenessCheck();
  connectMqtt();
});

app.on('before-quit', () => { isQuitting = true; flushPingsCache(); });

app.on('window-all-closed', () => {});

app.on('will-quit', () => {
  if (mqttClient) mqttClient.end(true); // force-close, don't wait for handshake
});

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('status:get', () => statusSnapshot());

// Multi-company API for the dashboard tabs.
ipcMain.handle('companies:get', () => companyList());
// Connections once tracked but now taken off the network (agent alive, but no longer
// publishing this connection's checks). Hidden from the donut + dashboard; surfaced in
// the popover's historical dropdown. Their full ping history is preserved (companies
// are never deleted), so opening one still shows its record.
ipcMain.handle('companies:historical', () =>
  companyList().filter((c) => c.historical).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)));

// viewer name → its source IP (derived from each location's own circuit).
ipcMain.handle('viewers:ips', () => {
  const out = {};
  for (const name of viewerAgent.keys()) {
    const ip = viewerIp(name);
    if (ip) out[name] = ip;
  }
  return out;
});

ipcMain.handle('company:history', (_e, payload = {}) => {
  const entry = companies.get(payload.companyId);
  if (!entry) return { ok: true, results: [], rollups: [] };
  const n = Math.min(Math.max(Number(payload.limit) || 20000, 1), MAX_PINGS_PER_COMPANY);
  // Raw full-resolution pings (last 7 days) + hourly rollups (everything older) so
  // the chart can draw the full history; rollups carry per-hour g/y/d minute counts.
  return { ok: true, results: entry.pings.slice(-n), rollups: entry.rollups ? [...entry.rollups.values()].sort((a, b) => a.h - b.h) : [] };
});

ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:save', (_e, newSettings) => {
  if (newSettings.shareCode) {
    try {
      const decoded = JSON.parse(Buffer.from(newSettings.shareCode, 'base64').toString('utf8'));
      newSettings.mqttHost  = decoded.mqttHost  || newSettings.mqttHost;
      newSettings.mqttPort  = decoded.mqttPort  || decoded.mqttWsPort || newSettings.mqttPort;
      newSettings.projectId = decoded.projectId  || newSettings.projectId;
      newSettings.systemId  = decoded.systemId   || newSettings.systemId;
      newSettings.apiPort   = decoded.apiPort    || newSettings.apiPort;
    } catch {
      return { ok: false, error: 'Invalid share code' };
    }
  }
  delete newSettings.shareCode;
  settings = { ...settings, ...newSettings };
  saveSettings(settings);
  connectMqtt();
  return { ok: true };
});

ipcMain.handle('shell:openExternal', (_e, url) => {
  // Only hand http(s) URLs to the OS — never file:, javascript:, or other
  // schemes a malformed/unexpected value could carry.
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return shell.openExternal(parsed.href);
    }
  } catch {}
  return undefined;
});

ipcMain.handle('window:resize-content', (e, size = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  if (e.sender !== mainWindow.webContents) return { ok: false };

  const parsedHeight = Number.parseInt(size.height, 10);
  const measuredHeight = Number.isFinite(parsedHeight)
    ? parsedHeight
    : targetHeightForMode(popoverMode);
  // Size the expanded window to its MEASURED content — do NOT floor it at the
  // donut's height. Shorter views (profile/settings) used to be forced to the
  // full expanded height, and since the panel is bottom-anchored that left an
  // empty strip above them — now visible as bare acrylic (it was transparent
  // before the OS-acrylic window). The donut's content already exceeds the floor,
  // so it is unaffected.
  const height = popoverMode === 'peek'
    ? POPOVER_PEEK_HEIGHT
    : Math.min(Math.max(measuredHeight, POPOVER_MIN_HEIGHT), maxPopoverHeight());

  // Don't reposition a hidden window: the renderer's ResizeObserver keeps firing
  // while hidden (status ticks, view reset), and re-anchoring then snaps the window
  // to the far-away cursor — which is what made it flash at the cursor on a later
  // desktop click. Resize in place only when visible.
  if (mainWindow.isVisible()) applyPopoverBounds(height, popoverPinned);
  return { ok: true, width: POPOVER_WIDTH, height };
});

ipcMain.handle('window:renderer-ready', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  popoverReady = true;
  applyPopoverSize(popoverMode);
  flushPendingPopover();
  return { ok: true };
});

ipcMain.handle('window:pin', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  pinPopover();
  return { ok: true };
});

// The popover's "i" toggles the legend window; the legend window itself asks to
// close (its own dismiss button / Escape).
ipcMain.handle('legend:toggle', (e) => {
  if (mainWindow && e.sender === mainWindow.webContents) toggleLegendWindow();
  else hideLegendWindow();
  return { ok: true };
});
ipcMain.handle('legend:close', () => { hideLegendWindow(); return { ok: true }; });

// Off-click reported by the dismiss scrim → layered dismiss. The FIRST off-click
// (legend still open) closes only the legend; the SECOND closes the dashboard.
ipcMain.on('scrim:click', () => {
  if (legendOpen) { hideLegendWindow(); return; }
  hidePopover();
});

// The legend window shows the LITERAL tray icons as its key — hand it the exact
// nativeImages the tray uses, as PNG data URLs (not a CSS recreation).
ipcMain.handle('tray-icons:get', () => ({
  green: icons.green.toDataURL(),
  yellow: icons.yellow.toDataURL(),
  red: icons.red.toDataURL(),
  grey: icons.grey.toDataURL(),
}));

ipcMain.handle('window:refresh-status', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  connectMqtt();
  if (currentStatus) mainWindow.webContents.send('mqtt:status', currentStatus);
  mainWindow.webContents.send('mqtt:connection', currentConnectionState);
  return { ok: true, ...statusSnapshot() };
});

ipcMain.handle('window:hide-popover', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  hidePopover();
  return { ok: true };
});

ipcMain.handle('window:pointer-enter', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  pointerInPopover = true;
  cancelHideTimer();
  mainWindow.setIgnoreMouseEvents(false);
  if (!popoverPinned && popoverMode === 'peek') {
    setPopoverMode('expanded');
  }
  return { ok: true };
});

ipcMain.handle('window:pointer-leave', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  pointerInPopover = false;
  if (!popoverPinned && !pointerInTray) schedulePeekHide();
  return { ok: true };
});

// ─── Dashboard background environment (for the popover's WebGL glass) ────────
// Tone presets and photo sources mirror dashboard/app/static (index.html boot
// script and modules/background-controller.js). The dashboard mirrors its
// localStorage background choice into the shared layout store
// (~/.status-monitor/dashboard-layout-store.json) so it is readable here.

const BACKGROUND_TONE_PRESETS = {
  'tone-light-grey': '#d1d5db',
  'tone-grey': '#6b7280',
  'tone-dark-grey': '#1f2937',
  'tone-black': '#000000',
};

const BACKGROUND_PHOTO_SOURCES = {
  'photo-bark': 'app/static/backgrounds/nature/bark.webp',
  'photo-cloud': 'app/static/backgrounds/nature/cloud.webp',
  'photo-jungle': 'app/static/backgrounds/nature/jungle.webp',
  'photo-moss': 'app/static/backgrounds/nature/moss.webp',
  'photo-sand': 'app/static/backgrounds/nature/sand.webp',
  'photo-shore': 'app/static/backgrounds/nature/shore.webp',
  'photo-turf': 'app/static/backgrounds/nature/turf.webp',
  'photo-water': 'app/static/backgrounds/nature/water.webp',
  'photo-water2': 'app/static/backgrounds/nature/water2.webp',
  'photo-denim': 'app/static/backgrounds/textures/denim.webp',
  'photo-marble': 'app/static/backgrounds/textures/marble.webp',
  'photo-leather': 'app/static/backgrounds/textures/leather.webp',
  'photo-texture': 'app/static/backgrounds/textures/texture.webp',
  'photo-paint': 'app/static/backgrounds/abstract/paint.webp',
  'photo-paintspill': 'app/static/backgrounds/abstract/paintspill.webp',
  'photo-city': 'app/static/backgrounds/urban/city.webp',
  'photo-modern': 'app/static/backgrounds/urban/modern.webp',
  'photo-mercury': 'app/static/backgrounds/space/mercury.webp',
  'photo-venus': 'app/static/backgrounds/space/venus.webp',
  'photo-earth': 'app/static/backgrounds/space/earth.webp',
  'photo-mars': 'app/static/backgrounds/space/mars.webp',
  'photo-jupiter': 'app/static/backgrounds/space/jupiter.webp',
  'photo-saturn': 'app/static/backgrounds/space/saturn.webp',
  'photo-uranus': 'app/static/backgrounds/space/uranus.webp',
  'photo-neptune': 'app/static/backgrounds/space/neptune.webp',
  'photo-pluto': 'app/static/backgrounds/space/pluto.webp',
};

const DASHBOARD_LAYOUT_STORE = path.join(os.homedir(), '.status-monitor', 'dashboard-layout-store.json');

// Photo backgrounds are read once and memoized — the popover re-requests the
// backdrop on every show, and the bundled photos never change at runtime.
const photoDataUrlCache = new Map();

function savedDashboardBackground() {
  try {
    const store = JSON.parse(fs.readFileSync(DASHBOARD_LAYOUT_STORE, 'utf8'));
    const value = store['dashboard-background'];
    return typeof value === 'string' && value.trim() ? value.trim() : 'tone-dark-grey';
  } catch {
    return 'tone-dark-grey';
  }
}

ipcMain.handle('dashboard:background', () => {
  const key = savedDashboardBackground();
  const fallbackTone = BACKGROUND_TONE_PRESETS['tone-dark-grey'];
  const result = { key, bgStart: fallbackTone, bgEnd: fallbackTone, photoDataUrl: '' };

  if (BACKGROUND_TONE_PRESETS[key]) {
    result.bgStart = result.bgEnd = BACKGROUND_TONE_PRESETS[key];
    return result;
  }
  if (/^#[0-9a-f]{6}$/i.test(key)) {
    // Derived custom-color backgrounds serialize as a bare hex tone.
    result.bgStart = result.bgEnd = key;
    return result;
  }
  const photoSource = BACKGROUND_PHOTO_SOURCES[key];
  if (photoSource) {
    if (photoDataUrlCache.has(key)) {
      result.photoDataUrl = photoDataUrlCache.get(key);
    } else {
      try {
        const photoPath = path.join(path.dirname(dashboardIndexPath()), photoSource);
        const dataUrl = `data:image/webp;base64,${fs.readFileSync(photoPath).toString('base64')}`;
        photoDataUrlCache.set(key, dataUrl);
        result.photoDataUrl = dataUrl;
      } catch (err) {
        console.warn('[dashboard:background] photo read failed:', err.message);
      }
    }
  }
  // solar-system / unknown keys keep the dark tone (with no photo).
  return result;
});

ipcMain.handle('dashboard:open', () => {
  openDashboardWindow();
  return { ok: true };
});

// ── Tray pie ──────────────────────────────────────────────────────────────
// Per-company condition mix over the past 24 hours for the popover's pie:
// how many pings were healthy / degraded / down. "Degraded" mirrors the
// dashboard's logic — packet loss, or latency far above the company's own
// average.
// Derived consensus mix for a circuit: combine its viewers per minute bucket
// (red >=50% of viewers down; else amber if any viewer down or degraded; else
// green) and tally the buckets. The pie's radial thirds + counts read this, so
// a single viewer's bad path can't paint the whole circuit red.
ipcMain.handle('companies:pie', (e, windowMs) => {
  // Optional time filter (tray donut 1hr / 1d / 1w). Default = the retained 24h.
  const w = Number(windowMs);
  const useWindow = Number.isFinite(w) && w > 0 && w !== PERSIST_WINDOW_MS;
  // Historical (taken-off-the-network) connections are surfaced in the popover's
  // historical dropdown instead, never as donut slices.
  return companyList().filter((co) => !co.historical).map((co) => {
    const entry = companies.get(co.id);
    if (!entry) {
      return { id: co.id, label: co.label, host: co.host || '', online: co.online, healthy: 0, degraded: 0, down: 0, total: 0, viewers: 1, critical: false, flaky: false, criticalCount: 0 };
    }
    // The memoized 24h derivation (a cache hit — companyList just ran it) is the
    // base. For a sub-24h filter (1hr) we just slice its per-minute levels — no
    // recompute. For a longer filter (1w) we derive over whatever raw history we
    // still hold (bounded by the 3000-ping cap). 1d uses the base as-is.
    const base = derivedFor(entry);
    const viewers = base.viewers;
    let levels = base.levels;
    if (useWindow) {
      const cutoff = Date.now() - w;
      if (w < PERSIST_WINDOW_MS) {
        levels = base.levels.filter((l) => l.ms >= cutoff);
      } else {
        levels = derivedMinuteLevels((entry.pings || []).filter((p) => Date.parse(p.checkedAt) >= cutoff));
      }
    }
    let healthy = 0, degraded = 0, down = 0;
    for (const { level } of levels) {
      if (level === 'red') down += 1;
      else if (level === 'yellow') degraded += 1;
      else healthy += 1;
    }
    // critical = a SUSTAINED outage right now (>=4 derived-down buckets in a row);
    // the pie auto-highlights these slices red without needing a hover.
    const critical = co.online && trailingDownStreakFromLevels(levels) >= CRITICAL_DOWN_STREAK;
    // flaky = YELLOW severity, mirroring the tray icon (amber = a degraded/flaky link
    // OR a link we've lost monitoring on). So: intermittent fails (isFlaky) OR offline.
    // Auto-highlights the slice YELLOW (same mechanism as `critical` reds it). Offline
    // slices used to just GREY OUT — de-emphasised, the reverse of what's wanted.
    // Mutually exclusive with critical.
    const flaky = !critical && (isFlaky(levels) || co.online === false);
    // criticalCount = how many times this circuit went critical (4-in-a-row) over
    // the window — the deep-red outer tier's tally (shown only when > 0).
    const criticalCount = countCriticalEpisodes(levels);
    return { id: co.id, label: co.label, host: co.host || '', online: co.online, healthy, degraded, down, total: levels.length, viewers, critical, flaky, criticalCount };
  });
});

// Open the dashboard focused on one company (a clicked pie slice). If the
// window already exists the company is pushed live; a freshly created window
// pulls the pending focus once its feed boots.
let pendingCompanyFocus = null;
let pendingChartDepth = null; // bar-chart depth to open at (from the donut's time filter)
ipcMain.handle('dashboard:open-company', (_e, companyId, chartDepth) => {
  pendingCompanyFocus = String(companyId || '') || null;
  pendingChartDepth = chartDepth === 'day' || chartDepth === 'hour' ? chartDepth : null;
  const existing = dashboardWindow && !dashboardWindow.isDestroyed();
  openDashboardWindow();
  if (existing && pendingCompanyFocus) {
    dashboardWindow.webContents.send('dashboard:set-company', { id: pendingCompanyFocus, depth: pendingChartDepth });
    pendingCompanyFocus = null;
    pendingChartDepth = null;
  }
  return { ok: true };
});

ipcMain.handle('company:focus:consume', () => {
  const value = { id: pendingCompanyFocus, depth: pendingChartDepth };
  pendingCompanyFocus = null;
  pendingChartDepth = null;
  return value;
});

ipcMain.handle('dashboard:close', () => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.close();
  return { ok: true };
});

ipcMain.handle('dashboard:minimize', () => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.minimize();
  return { ok: true };
});

// Window-control IPC used by the dashboard renderer's own frameless chrome
// (window-control-cluster buttons → dashboardWindowControls bridge).

function isDashboardSender(e) {
  return dashboardWindow
    && !dashboardWindow.isDestroyed()
    && e.sender === dashboardWindow.webContents;
}

ipcMain.handle('dashboard-window:reload', (e) => {
  if (!isDashboardSender(e)) return { ok: false };
  dashboardWindow.webContents.reload();
  return { ok: true };
});

ipcMain.handle('dashboard-window:minimize', (e) => {
  if (!isDashboardSender(e)) return { ok: false };
  dashboardWindow.minimize();
  return { ok: true };
});

ipcMain.handle('dashboard-window:close', (e) => {
  if (!isDashboardSender(e)) return { ok: false };
  dashboardWindow.close();
  return { ok: true };
});

// ─── Accounts / auth ─────────────────────────────────────────────────────────

function broadcastAuth() {
  const payload = auth.session();
  BrowserWindow.getAllWindows().forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send('auth:changed', payload);
  });
}

function canManageUsers() {
  const s = auth.session();
  return !!(s.user && (s.user.isAdmin || s.user.permissions.canManageUsers));
}

ipcMain.handle('auth:session', () => auth.session());

ipcMain.handle('auth:login', (_e, { username, password } = {}) => {
  const result = auth.login(username, password);
  if (result.ok) { seedDefaultLayoutForUser(auth.currentUser()); broadcastAuth(); updateTray(lastTrayStatus); }
  return result;
});

ipcMain.handle('auth:logout', () => {
  const result = auth.logout();
  broadcastAuth();
  updateTray(lastTrayStatus);
  return result;
});

ipcMain.handle('auth:register', (_e, payload) => {
  const result = auth.register(payload || {});
  if (result.ok) { seedDefaultLayoutForUser(auth.currentUser()); broadcastAuth(); updateTray(lastTrayStatus); }
  return result;
});

ipcMain.handle('auth:set-password', (_e, { password } = {}) => {
  const result = auth.setOwnPassword(password);
  if (result.ok) broadcastAuth();
  return result;
});

ipcMain.handle('auth:list-users', () => (
  canManageUsers() ? { ok: true, users: auth.listUsers() } : { ok: false, error: 'Not allowed' }
));

ipcMain.handle('auth:create-user', (_e, payload) => (
  canManageUsers() ? auth.createUser(payload || {}) : { ok: false, error: 'Not allowed' }
));

ipcMain.handle('auth:update-user', (_e, { username, ...rest } = {}) => (
  canManageUsers() ? auth.updateUser(username, rest) : { ok: false, error: 'Not allowed' }
));

ipcMain.handle('auth:delete-user', (_e, { username } = {}) => (
  canManageUsers() ? auth.deleteUser(username) : { ok: false, error: 'Not allowed' }
));

// Synchronous lookup so a preload can pick the signed-in user's layout store.
ipcMain.on('auth:current-username', (e) => { e.returnValue = auth.currentUser() || ''; });

ipcMain.handle('history:get', async (_e, limit = 20) => {
  const parsedLimit = Number.parseInt(limit, 10);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 500)
    : 20;
  const apiPort = Number.parseInt(settings.apiPort || DEFAULT_API_PORT, 10);
  const url = `http://${settings.mqttHost}:${apiPort}/api/history?limit=${safeLimit}`;

  try {
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, response: body };
    }
    return body;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
