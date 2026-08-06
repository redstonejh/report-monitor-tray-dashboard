'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mqtt = require('mqtt');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_DIR = path.join(ROOT, 'status-monitor-client', 'dashboard');
const PORT = numberEnv('PORT', 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'monitor-state.json');
const DEFAULT_CLIENTS_FILE = path.join(ROOT, 'status-monitor-client', 'clients.json');
const CLIENTS_FILE = process.env.CLIENTS_CONFIG || path.join(DATA_DIR, 'clients.json');
const MQTT_URL = process.env.MQTT_URL || 'mqtt://24.121.212.206:1883';
const ONLINE_MS = numberEnv('ONLINE_WINDOW_MS', 5 * 60 * 1000);
const RETENTION_MS = numberEnv('HISTORY_RETENTION_MS', 7 * 24 * 60 * 60 * 1000);
const MAX_PINGS = numberEnv('MAX_PINGS_PER_COMPANY', 50000);
const STATUS_WINDOW_MS = 24 * 60 * 60 * 1000;
const CRITICAL_DOWN_STREAK = 4;
const FLAKY_WINDOW_MS = 10 * 60 * 1000;
const FLAKY_MIN_FAILS = 4;

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadClients() {
  const configured = fs.existsSync(CLIENTS_FILE) ? CLIENTS_FILE : DEFAULT_CLIENTS_FILE;
  const data = readJson(configured, { companies: [] });
  return Array.isArray(data.companies) ? data.companies : [];
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(from [^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

const clientRules = loadClients();
const companies = new Map();
const systemActivity = new Map();
const connectionHostByToken = new Map();
const viewerAgent = new Map();
const agentViewerNames = new Map();
const eventClients = new Set();
let mqttConnectionState = 'grey';
let lastCheckedAt = null;
let saveTimer = null;

function companyForCheck(label, id) {
  const haystack = `${id || ''} ${label || ''}`.toLowerCase();
  for (const rule of clientRules) {
    if (Array.isArray(rule.match) && rule.match.some((term) => haystack.includes(String(term).toLowerCase()))) {
      return { id: slugify(rule.label), label: String(rule.label) };
    }
  }
  const labelWithoutViewer = String(label || id || 'Unknown')
    .replace(/\s*\(from [^)]*\)\s*/i, '')
    .trim() || 'Unknown';
  return { id: slugify(labelWithoutViewer), label: labelWithoutViewer };
}

function checkToPing(payload) {
  const status = payload.available === false
    ? 'red'
    : Number(payload.packetLoss) > 0 ? 'yellow' : 'green';
  const detail = [];
  if (payload.host) detail.push(payload.host);
  if (payload.available === false) detail.push('unreachable');
  else if (payload.latencyMs != null) detail.push(`${payload.latencyMs} ms`);
  if (Number(payload.packetLoss) > 0) detail.push(`${payload.packetLoss}% loss`);
  if (payload.error) detail.push(String(payload.error));
  return {
    checkedAt: payload.checkedAt || payload.lastReceived || new Date().toISOString(),
    status,
    latencyMs: payload.available !== false && payload.latencyMs != null && payload.latencyMs !== ''
      ? Number(payload.latencyMs) : null,
    packetLossPct: payload.available !== false && payload.packetLoss != null && payload.packetLoss !== ''
      ? Number(payload.packetLoss) : null,
    up: status === 'red' ? 0 : 1,
    machine: payload.label || payload.id || '',
    checkId: payload.id || '',
    host: payload.host || '',
    detail: detail.join(' · '),
  };
}

function ensureCompany(company) {
  let entry = companies.get(company.id);
  if (!entry) {
    entry = {
      id: company.id,
      label: company.label,
      pings: [],
      lastByCheck: new Map(),
      systems: new Set(),
    };
    companies.set(company.id, entry);
  }
  return entry;
}

function ingestCheck(payload, system) {
  if (!payload || payload.available === undefined) return null;
  const company = companyForCheck(payload.label, payload.id);
  const entry = ensureCompany(company);
  if (system) entry.systems.add(system);
  const ping = checkToPing(payload);
  const previous = entry.lastByCheck.get(ping.checkId);
  if (previous?.checkedAt === ping.checkedAt) return null;
  entry.lastByCheck.set(ping.checkId, ping);
  entry.pings.push(ping);
  prunePings(entry);
  lastCheckedAt = ping.checkedAt || lastCheckedAt;
  scheduleSave();
  return { companyId: company.id, ping };
}

function prunePings(entry) {
  const cutoff = Date.now() - RETENTION_MS;
  entry.pings = entry.pings
    .filter((ping) => {
      const time = Date.parse(ping?.checkedAt);
      return Number.isFinite(time) && time >= cutoff;
    })
    .slice(-MAX_PINGS);
}

function viewerFromMachine(machine) {
  const match = String(machine || '').match(/\(from ([^)]*)\)/i);
  return match?.[1]?.trim() || String(machine || 'primary');
}

function derivedMinuteLevels(pings) {
  if (!pings.length) return [];
  const latencyValues = pings
    .map((ping) => ping.latencyMs)
    .filter((value) => value != null && Number.isFinite(value));
  const averageLatency = latencyValues.length
    ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
    : null;
  const levelOf = (ping) => ping.status === 'red'
    ? 'red'
    : ping.status === 'yellow'
      || (averageLatency != null && ping.latencyMs != null
        && ping.latencyMs > Math.max(averageLatency * 2.2 + 25, 40))
      ? 'yellow'
      : 'green';
  const severity = { green: 0, yellow: 1, red: 2 };
  const viewerCount = new Set(pings.map((ping) => viewerFromMachine(ping.machine))).size || 1;
  const buckets = new Map();

  for (const ping of pings) {
    const time = Date.parse(ping.checkedAt);
    if (!Number.isFinite(time)) continue;
    const minute = Math.floor(time / 60000) * 60000;
    if (!buckets.has(minute)) buckets.set(minute, new Map());
    const votes = buckets.get(minute);
    const viewer = viewerFromMachine(ping.machine);
    const level = levelOf(ping);
    const previous = votes.get(viewer);
    if (previous == null || severity[level] > severity[previous]) votes.set(viewer, level);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, votes]) => {
      const levels = [...votes.values()];
      const failures = levels.filter((level) => level === 'red').length;
      const level = failures / viewerCount >= 0.5
        ? 'red'
        : failures > 0 || levels.includes('yellow') ? 'yellow' : 'green';
      return { ms, level };
    });
}

function trailingDownStreak(levels) {
  let streak = 0;
  for (let index = levels.length - 1; index >= 0 && levels[index].level === 'red'; index -= 1) {
    streak += 1;
  }
  return streak;
}

function companyStatus(entry) {
  const cutoff = Date.now() - STATUS_WINDOW_MS;
  const levels = derivedMinuteLevels(
    entry.pings.filter((ping) => Date.parse(ping.checkedAt) >= cutoff),
  );
  const trailing = trailingDownStreak(levels);
  if (trailing >= CRITICAL_DOWN_STREAK) return 'red';
  const recentFailureCount = levels.filter(
    ({ ms, level }) => level === 'red' && ms >= Date.now() - FLAKY_WINDOW_MS,
  ).length;
  if (trailing < CRITICAL_DOWN_STREAK && recentFailureCount >= FLAKY_MIN_FAILS) return 'yellow';
  return 'green';
}

function companyOnline(entry) {
  const now = Date.now();
  return [...entry.systems].some((system) => now - (systemActivity.get(system) || 0) < ONLINE_MS);
}

function companyList() {
  return [...companies.values()]
    .map((entry) => {
      const lastPing = entry.pings.at(-1);
      const online = companyOnline(entry);
      return {
        id: entry.id,
        label: entry.label,
        status: online ? companyStatus(entry) : 'offline',
        online,
        checks: entry.lastByCheck.size,
        host: lastPing?.host || '',
        historical: false,
        lastSeen: lastPing?.checkedAt ? Date.parse(lastPing.checkedAt) : 0,
      };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || a.label.localeCompare(b.label));
}

function overallSnapshot() {
  const list = companyList();
  const down = list.filter((company) => company.online && company.status === 'red').map((company) => company.label);
  const degraded = list.filter((company) => company.online && company.status === 'yellow').map((company) => company.label);
  const offline = list.filter((company) => !company.online).map((company) => company.label);
  const status = down.length ? 'red' : degraded.length || offline.length ? 'yellow' : 'green';
  const detail = !list.length
    ? 'Waiting for data…'
    : status === 'green'
      ? `All ${list.length} clients healthy`
      : [
          down.length ? `${down.length} down` : '',
          degraded.length ? `${degraded.length} degraded` : '',
          offline.length ? `${offline.length} offline` : '',
        ].filter(Boolean).join(' · ');
  return {
    status,
    detail,
    down,
    degraded,
    offline,
    live: list.length - offline.length,
    total: list.length,
    checkedAt: lastCheckedAt,
  };
}

function locationToken(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';
}

function recordViewerLocation(payload, system) {
  const circuit = String(payload.subjectLabel || payload.label || '')
    .replace(/\s*\(from [^)]*\)\s*/i, '')
    .trim();
  const token = locationToken(circuit);
  if (token && payload.host && (!connectionHostByToken.has(token) || /fiber/i.test(circuit))) {
    connectionHostByToken.set(token, payload.host);
  }
  const match = String(payload.label || '').match(/\(from ([^)]*)\)/i);
  const viewer = match?.[1]?.trim();
  if (viewer && system) {
    viewerAgent.set(viewer, system);
    if (!agentViewerNames.has(system)) agentViewerNames.set(system, new Set());
    agentViewerNames.get(system).add(viewer);
  }
}

function viewerIp(name) {
  const direct = connectionHostByToken.get(locationToken(name));
  if (direct) return direct;
  const system = viewerAgent.get(name);
  for (const alternate of agentViewerNames.get(system) || []) {
    const ip = connectionHostByToken.get(locationToken(alternate));
    if (ip) return ip;
  }
  return '';
}

function viewerIps() {
  const output = {};
  for (const name of viewerAgent.keys()) {
    const ip = viewerIp(name);
    if (ip) output[name] = ip;
  }
  return output;
}

function serializeState() {
  return {
    savedAt: Date.now(),
    lastCheckedAt,
    companies: [...companies.values()].map((entry) => ({
      id: entry.id,
      label: entry.label,
      pings: entry.pings,
      systems: [...entry.systems],
    })),
  };
}

function loadState() {
  const state = readJson(STATE_FILE, null);
  if (!state?.companies) return;
  lastCheckedAt = state.lastCheckedAt || null;
  for (const saved of state.companies) {
    if (!saved?.id) continue;
    const entry = ensureCompany({ id: saved.id, label: saved.label || saved.id });
    entry.pings = Array.isArray(saved.pings) ? saved.pings.slice(-MAX_PINGS) : [];
    entry.systems = new Set(Array.isArray(saved.systems) ? saved.systems : []);
    prunePings(entry);
    for (const ping of entry.pings) {
      if (ping?.checkId) entry.lastByCheck.set(ping.checkId, ping);
    }
  }
}

function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temporary = `${STATE_FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(serializeState()), 'utf8');
    fs.renameSync(temporary, STATE_FILE);
  } catch (error) {
    console.error('[STATE] Could not save dashboard history:', error.message);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveState();
  }, 5000);
}

function emitEvent(type, data) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of eventClients) response.write(frame);
}

function setConnectionState(state) {
  if (mqttConnectionState === state) return;
  mqttConnectionState = state;
  emitEvent('connection', state);
}

function connectMqtt() {
  const options = {
    clean: true,
    reconnectPeriod: numberEnv('MQTT_RECONNECT_MS', 15000),
  };
  if (process.env.MQTT_USERNAME) options.username = process.env.MQTT_USERNAME;
  if (process.env.MQTT_PASSWORD) options.password = process.env.MQTT_PASSWORD;
  if (process.env.MQTT_CLIENT_ID) options.clientId = process.env.MQTT_CLIENT_ID;

  console.log(`[MQTT] Connecting to ${MQTT_URL}`);
  const client = mqtt.connect(MQTT_URL, options);
  client.on('connect', () => {
    setConnectionState('live');
    const topics = [
      process.env.MQTT_CHECKS_TOPIC || '+/+/checks/+',
      process.env.MQTT_CONNECTIONS_TOPIC || 'connections/#',
      process.env.MQTT_HEARTBEATS_TOPIC || '+/+/heartbeat',
    ];
    client.subscribe(topics, { qos: 0 }, (error) => {
      if (error) console.error('[MQTT] Subscribe failed:', error.message);
      else console.log(`[MQTT] Subscribed to ${topics.join(', ')}`);
    });
  });
  client.on('message', (topic, message) => {
    if (!message.length) return;
    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch {
      return;
    }
    const parts = topic.split('/');
    if (topic.endsWith('/heartbeat')) {
      const system = `${parts[0]}/${parts[1]}`;
      const publishedAt = Date.parse(payload.publishedAt);
      systemActivity.set(system, Number.isFinite(publishedAt) ? publishedAt : Date.now());
      return;
    }

    let system;
    if (topic.includes('/checks/')) {
      system = `${parts[0]}/${parts[1]}`;
    } else if (parts[0] === 'connections' && parts.length >= 5) {
      system = `${parts[2]}/${parts[3]}`;
      recordViewerLocation(payload, system);
    } else {
      return;
    }

    const observedAt = Date.parse(payload.checkedAt || payload.lastReceived);
    systemActivity.set(system, Number.isFinite(observedAt) ? observedAt : Date.now());
    const result = ingestCheck(payload, system);
    if (!result) return;
    setConnectionState('live');
    emitEvent('check', result);
    emitEvent('status', overallSnapshot());
  });
  client.on('reconnect', () => setConnectionState('grey'));
  client.on('offline', () => setConnectionState('grey'));
  client.on('close', () => setConnectionState('grey'));
  client.on('error', (error) => {
    console.error('[MQTT]', error.message);
    setConnectionState('black');
  });
  return client;
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function basicAuth(req, res, next) {
  const expectedUser = process.env.WEB_USERNAME;
  const expectedPassword = process.env.WEB_PASSWORD;
  if (!expectedUser && !expectedPassword) return next();
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  let suppliedUser = '';
  let suppliedPassword = '';
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    suppliedUser = separator >= 0 ? decoded.slice(0, separator) : decoded;
    suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : '';
  }
  if (secureEqual(suppliedUser, expectedUser || '') && secureEqual(suppliedPassword, expectedPassword || '')) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Report Monitor", charset="UTF-8"');
  return res.status(401).send('Authentication required');
}

loadState();
const mqttClient = connectMqtt();
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.json({ ok: true, mqtt: mqttConnectionState }));
app.use(basicAuth);
app.get('/api/status', (_req, res) => {
  res.json({ status: overallSnapshot(), connectionState: mqttConnectionState });
});
app.get('/api/companies', (_req, res) => res.json(companyList()));
app.get('/api/companies/:id/history', (req, res) => {
  const entry = companies.get(req.params.id);
  const requested = Number(req.query.limit) || 20000;
  const limit = Math.min(Math.max(requested, 1), MAX_PINGS);
  res.json({ ok: true, results: entry?.pings.slice(-limit) || [], rollups: [] });
});
app.get('/api/viewer-ips', (_req, res) => res.json(viewerIps()));
app.get('/api/history', (req, res) => {
  const requested = Number(req.query.limit) || 20;
  const limit = Math.min(Math.max(requested, 1), 500);
  const results = [...companies.values()]
    .flatMap((entry) => entry.pings)
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
    .slice(0, limit);
  res.json({ ok: true, results });
});
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  eventClients.add(res);
  res.write(`event: connection\ndata: ${JSON.stringify(mqttConnectionState)}\n\n`);
  const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    eventClients.delete(res);
  });
});
app.use(express.static(DASHBOARD_DIR, {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, file) {
    if (file.endsWith('index.html') || file.endsWith('web-bridge.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.get('*path', (_req, res) => res.sendFile(path.join(DASHBOARD_DIR, 'index.html')));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[WEB] Report Monitor available on http://0.0.0.0:${PORT}`);
});

function shutdown(signal) {
  console.log(`[WEB] ${signal} received, shutting down`);
  if (saveTimer) clearTimeout(saveTimer);
  saveState();
  mqttClient.end(true);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
