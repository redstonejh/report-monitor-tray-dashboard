'use strict';
const express = require('express');

function createApp(config, publisherIsConnected, store) {
  const app = express();

  // Parse API_CORS_ORIGIN — supports '*' or a comma-separated list of origins.
  const allowedOrigins =
    config.apiCorsOrigin === '*'
      ? '*'
      : config.apiCorsOrigin.split(',').map((o) => o.trim()).filter(Boolean);

  app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;
    if (allowedOrigins === '*') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const router = express.Router();

  // GET /api/status  — current status snapshot
  router.get('/status', (_req, res) => {
    res.json({
      ok: true,
      mqttConnected: publisherIsConnected(),
      current: store.getLatest(),
    });
  });

  // GET /api/history?limit=N  — recent check history (max 500)
  router.get('/history', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 500);
    res.json({ ok: true, results: store.getHistory(limit) });
  });

  // GET /api/info  — non-sensitive server info + the client share code
  router.get('/info', (_req, res) => {
    res.json({
      ok: true,
      shareCode: config.shareCode,
      mqttWsPort: config.mqttWsPort,
      mqttBrokerHost: config.mqttBrokerHost,
      checkCron: config.checkCron,
      greenThresholdHours: config.greenThresholdHours,
    });
  });

  app.use('/api', router);

  // Health ping (no /api prefix — easy to curl)
  app.get('/ping', (_req, res) => res.json({ ok: true }));

  return { app };
}

module.exports = { createApp };
