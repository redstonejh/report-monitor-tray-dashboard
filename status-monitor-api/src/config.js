'use strict';
const path = require('path');

// Join a base path with a sub-path using forward slash, stripping any trailing
// separator from base. Works for both Windows drive paths and URLs.
function joinPath(base, sub) {
  if (!base) return sub || '';
  if (!sub) return base;
  return `${base.replace(/[/\\]+$/, '')}/${sub}`;
}

function parseList(value, fallback) {
  return String(value || fallback)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith('.') ? item : `.${item}`));
}

function buildConfig(env) {
  // PROJECT_ID and SYSTEM_ID are written to .env on first run by index.js.
  const projectId = env.PROJECT_ID;
  const systemId  = env.SYSTEM_ID;

  const mqttHost   = env.MQTT_BROKER_HOST || 'localhost';
  const mqttPort   = parseInt(env.MQTT_BROKER_PORT || '1883', 10);
  const mqttWsPort = parseInt(env.MQTT_WS_PORT || '9001', 10);
  const apiPort    = parseInt(env.API_PORT || '3847', 10);

  // The topic clients subscribe to — opaque UIDs reveal nothing to sniffers
  const statusTopic = `${projectId}/${systemId}/status`;

  // Share code encodes everything a client needs to connect. apiPort lets the
  // client fetch history without assuming the default port (older share codes
  // omit it; the client falls back to its default/manual value).
  const sharePayload = { mqttHost, mqttPort, mqttWsPort, apiPort, projectId, systemId };
  const shareCode = Buffer.from(JSON.stringify(sharePayload)).toString('base64');

  const basePath = env.BASE_PATH || '';

  return {
    // Paths. DB_PATH is independent; source folders are relative to BASE_PATH.
    dbPath:            env.DB_PATH             || '',
    dbTable:           env.DB_TABLE            || 'StatusRecords',
    dbDateColumn:      env.DB_DATE_COLUMN      || 'RecordDate',
    rawDataPath:       joinPath(basePath, env.RAW_DATA_PATH       || ''),
    archivedDataPath:  joinPath(basePath, env.ARCHIVED_DATA_PATH  || ''),
    reportWorkPath:    joinPath(basePath, env.REPORT_WORK_PATH    || ''),
    reportSummaryPath: joinPath(basePath, env.REPORT_SUMMARY_PATH || ''),
    reportFinalPath:   joinPath(basePath, env.REPORT_FINAL_PATH   || ''),
    sourceLogPath:     joinPath(basePath, env.SOURCE_LOG_PATH     || ''),
    rawDataExtensions: parseList(env.RAW_DATA_EXTENSIONS, '.csv,.log,.txt'),
    reportExtensions:  parseList(env.REPORT_EXTENSIONS,  '.xlsx,.xls,.txt,.pdf'),

    // Thresholds
    greenThresholdHours: parseFloat(env.GREEN_THRESHOLD_HOURS || '26'),

    // MQTT
    mqttBrokerHost: mqttHost,
    mqttBrokerPort: parseInt(env.MQTT_BROKER_PORT || '1883', 10),
    mqttWsPort,
    mqttUsername:   env.MQTT_USERNAME || '',
    mqttPassword:   env.MQTT_PASSWORD || '',
    statusTopic,
    shareCode,

    // Schedule / API
    checkCron:     env.CHECK_CRON    || '*/10 * * * *',
    apiPort,
    apiCorsOrigin: env.API_CORS_ORIGIN || '*',
    historyDbPath: env.HISTORY_DB_PATH || path.join(__dirname, '..', 'data', 'history.db'),
  };
}

module.exports = { buildConfig };
