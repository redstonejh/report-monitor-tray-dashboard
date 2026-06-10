'use strict';
const mqtt = require('mqtt');

let client = null;
let currentTopic = null;
let connected = false;
let pendingPayload = null;

function connect(config) {
  if (client) client.end(true);

  const url = `mqtt://${config.mqttBrokerHost}:${config.mqttBrokerPort}`;
  const opts = { clean: true, reconnectPeriod: 10_000 };
  if (config.mqttUsername) {
    opts.username = config.mqttUsername;
    opts.password = config.mqttPassword;
  }

  currentTopic = config.statusTopic;
  client = mqtt.connect(url, opts);

  client.on('connect', () => {
    connected = true;
    console.log(`[MQTT] Connected to ${url}`);
    if (pendingPayload) {
      const p = pendingPayload;
      pendingPayload = null;
      publish(p);
    }
  });

  client.on('error', (err) => {
    connected = false;
    console.error('[MQTT] Error:', err.message);
  });

  client.on('close', () => {
    connected = false;
  });
}

/**
 * Publish a status payload to the configured topic with the retain flag set.
 * Retained messages ensure new subscribers immediately receive the latest state.
 */
function publish(payload) {
  if (!client || !connected) {
    console.warn('[MQTT] Not connected — queuing for reconnect');
    pendingPayload = payload;
    return;
  }
  const message = JSON.stringify(payload);
  client.publish(currentTopic, message, { retain: true, qos: 1 }, (err) => {
    if (err) console.error('[MQTT] Publish error:', err.message);
    else console.log(`[MQTT] Published status: ${payload.status} (stage: ${payload.stage ?? 'none'})`);
  });
}

function disconnect() {
  if (client) client.end();
}

function isConnected() {
  return connected;
}

module.exports = { connect, publish, disconnect, isConnected };
