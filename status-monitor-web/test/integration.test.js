'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { Aedes } = require('aedes');
const mqtt = require('mqtt');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError || new Error(`Condition not met within ${timeoutMs}ms`);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('web gateway serves, authenticates, syncs API history, streams SSE, and consumes legacy MQTT status', async (t) => {
  const mqttPort = await freePort();
  const apiPort = await freePort();
  const webPort = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-monitor-web-test-'));
  const checkedAt = new Date(Date.now() - 60000).toISOString();

  const broker = await Aedes.createBroker();
  const brokerServer = net.createServer(broker.handle);
  await listen(brokerServer, mqttPort);

  const apiServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/history')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        results: [{
          checkedAt,
          status: 'yellow',
          stage: 'load',
          detail: 'Backfilled from API history',
          lastSuccess: null,
        }],
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await listen(apiServer, apiPort);

  const serverPath = path.resolve(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(webPort),
      DATA_DIR: dataDir,
      MQTT_URL: `mqtt://127.0.0.1:${mqttPort}`,
      STATUS_API_URL: `http://127.0.0.1:${apiPort}`,
      STATUS_API_SYSTEM: 'report-monitor/server',
      STATUS_API_LABEL: 'Integration Monitor',
      STATUS_API_POLL_MS: '1000',
      WEB_USERNAME: 'test-user',
      WEB_PASSWORD: 'test-password',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout.on('data', (chunk) => { childOutput += chunk; });
  child.stderr.on('data', (chunk) => { childOutput += chunk; });
  let publisher = null;
  let eventReader = null;
  t.after(async () => {
    if (eventReader) await eventReader.cancel().catch(() => {});
    if (publisher) {
      await Promise.race([
        new Promise((resolve) => publisher.end(false, {}, resolve)),
        delay(2000),
      ]);
    }
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(3000),
      ]);
    }
    await close(apiServer);
    await close(brokerServer);
    await broker.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${webPort}`;
  const authorization = `Basic ${Buffer.from('test-user:test-password').toString('base64')}`;
  const authHeaders = { Authorization: authorization };

  const health = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    return response.ok ? response : null;
  });
  assert.equal((await health.json()).ok, true);

  const denied = await fetch(`${baseUrl}/api/companies`);
  assert.equal(denied.status, 401);

  const page = await fetch(`${baseUrl}/`, { headers: authHeaders });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /web-bridge\.js/);

  const bridge = await fetch(`${baseUrl}/app/static/web-bridge.js`, { headers: authHeaders });
  assert.equal(bridge.status, 200);
  assert.match(await bridge.text(), /new EventSource\("\/api\/events"\)/);

  const backfilled = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/companies`, { headers: authHeaders });
    const companies = await response.json();
    return companies.find((company) => company.label === 'Integration Monitor');
  });
  assert.equal(backfilled.status, 'yellow');

  const eventsResponse = await fetch(`${baseUrl}/api/events`, { headers: authHeaders });
  assert.equal(eventsResponse.status, 200);
  assert.match(eventsResponse.headers.get('content-type'), /text\/event-stream/);
  eventReader = eventsResponse.body.getReader();

  publisher = mqtt.connect(`mqtt://127.0.0.1:${mqttPort}`);
  await new Promise((resolve, reject) => {
    publisher.once('connect', resolve);
    publisher.once('error', reject);
  });
  const mqttCheckedAt = new Date().toISOString();
  await new Promise((resolve, reject) => {
    publisher.publish('report-monitor/server/status', JSON.stringify({
      status: 'green',
      stage: null,
      detail: 'Published through MQTT',
      lastSuccess: mqttCheckedAt,
      checkedAt: mqttCheckedAt,
    }), { qos: 1, retain: true }, (error) => error ? reject(error) : resolve());
  });

  let eventText = '';
  await waitFor(async () => {
    const read = await Promise.race([
      eventReader.read(),
      delay(2000).then(() => ({ done: false, value: new Uint8Array() })),
    ]);
    eventText += Buffer.from(read.value || []).toString('utf8');
    return eventText.includes('event: check');
  });
  assert.match(eventText, /"detail":"Published through MQTT"/);
  await eventReader.cancel();
  eventReader = null;

  const history = await waitFor(async () => {
    const response = await fetch(
      `${baseUrl}/api/companies/integration-monitor/history?limit=20`,
      { headers: authHeaders },
    );
    const body = await response.json();
    return body.results.length >= 2 ? body.results : null;
  });
  assert.equal(history.at(-1).status, 'green');
  assert.equal(history.at(-1).detail, 'Published through MQTT');

  assert.equal(child.exitCode, null, childOutput);
});
