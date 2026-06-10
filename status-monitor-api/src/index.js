'use strict';
const fs   = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');
require('dotenv').config({ path: ENV_PATH });

// Generate PROJECT_ID / SYSTEM_ID on first run and persist them to .env so the
// values survive restarts and can be copied into client settings.
function ensureTopicIds() {
  if (process.env.PROJECT_ID && process.env.SYSTEM_ID) return;
  const { v4: uuidv4 } = require('uuid');
  const lines = [];
  if (!process.env.PROJECT_ID) {
    process.env.PROJECT_ID = uuidv4();
    lines.push(`PROJECT_ID=${process.env.PROJECT_ID}`);
  }
  if (!process.env.SYSTEM_ID) {
    process.env.SYSTEM_ID = uuidv4();
    lines.push(`SYSTEM_ID=${process.env.SYSTEM_ID}`);
  }
  try {
    fs.appendFileSync(ENV_PATH, '\n' + lines.join('\n') + '\n');
    console.log('[CONFIG] Generated topic IDs and appended to .env');
  } catch (err) {
    console.warn('[CONFIG] Could not write topic IDs to .env:', err.message);
  }
}
ensureTopicIds();

const cron = require('node-cron');
const { buildConfig } = require('./config');
const { runCheck } = require('./checker');
const publisher = require('./publisher');
const { createApp } = require('./api');
const store = require('./store');

const config = buildConfig(process.env);

// ── History DB ────────────────────────────────────────────────────────────────
store.init(config.historyDbPath);

// ── MQTT ──────────────────────────────────────────────────────────────────────
publisher.connect(config);

// ── REST API ──────────────────────────────────────────────────────────────────
const { app } = createApp(config, publisher.isConnected, store);

app.listen(config.apiPort, () => {
  console.log(`[API] Listening on http://localhost:${config.apiPort}`);
});

// ── Checker ───────────────────────────────────────────────────────────────────
function check() {
  console.log('[CHECK] Running status health check...');
  let result;
  try {
    result = runCheck(config);
  } catch (err) {
    console.error('[CHECK] Unexpected error:', err.message);
    result = {
      status: 'red',
      stage: 'scrape',
      detail: `Checker threw an unexpected error: ${err.message}`,
      lastSuccess: null,
      checkedAt: new Date().toISOString(),
    };
  }

  console.log(`[CHECK] Result: ${result.status.toUpperCase()} - ${result.detail}`);
  store.record(result);
  publisher.publish(result);
  return result;
}

// Run immediately on startup, then on schedule
check();
cron.schedule(config.checkCron, check);

// ── Startup banner ────────────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║                    Status Monitor API                       ║');
console.log('╠══════════════════════════════════════════════════════════════╣');
console.log(`║  REST API   http://localhost:${config.apiPort}/api/status`);
console.log(`║  MQTT topic ${config.statusTopic.slice(0, 52)}`);
console.log(`║  Schedule   ${config.checkCron}`);
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('  Client share code (copy and paste into tray app Settings):');
console.log(`  ${config.shareCode}`);
console.log('');

process.on('SIGINT', () => {
  publisher.disconnect();
  process.exit(0);
});
