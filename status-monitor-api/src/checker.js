'use strict';
const fs = require('fs');
const path = require('path');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msToHours(ms) {
  return ms / 3_600_000;
}

/**
 * Walk a directory tree (non-recursive by default) and return the most recent
 * mtime among files matching the optional extension list.
 */
function mostRecentMtime(dirPath, extensions = null, recursive = false) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    let latest = null;

    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);

      if (entry.isDirectory() && recursive) {
        const sub = mostRecentMtime(full, extensions, true);
        if (sub && (!latest || sub > latest)) latest = sub;
        continue;
      }

      if (!entry.isFile()) continue;
      if (extensions && !extensions.includes(path.extname(entry.name).toLowerCase())) continue;

      const { mtimeMs } = fs.statSync(full);
      if (!latest || mtimeMs > latest) latest = mtimeMs;
    }

    return latest;
  } catch {
    return null;
  }
}

/**
 * Scan raw source folders recursively and return the most recent matching file.
 */
function mostRecentRawData(rawDataPath, extensions) {
  return mostRecentMtime(rawDataPath, extensions, true);
}

/**
 * Parse the most recent log file for today's activity and error messages.
 * Log files are named YYYY-MM-DD.log by default.
 */
function readTodayLog(logPath) {
  try {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const logName = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.log`;
    const logFile = path.join(logPath, logName);

    if (!fs.existsSync(logFile)) return { hasActivity: false, hasErrors: false, lastError: null };

    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    const errorLines = lines.filter((l) => l.includes('[ERROR]'));
    const hasSuccess = lines.some((l) => l.includes('[SUCCESS]'));

    return {
      hasActivity: lines.length > 0,
      hasErrors: errorLines.length > 0,
      hasSuccess,
      lastError: errorLines.length > 0 ? errorLines[errorLines.length - 1].trim() : null,
    };
  } catch {
    return { hasActivity: false, hasErrors: false, hasSuccess: false, lastError: null };
  }
}

function sqlIdentifier(value, fallback) {
  const identifier = String(value || fallback);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier) ? identifier : fallback;
}

// ─── Main check ───────────────────────────────────────────────────────────────

/**
 * Run a full monitor health check and return a status object:
 *
 *   { status, stage, detail, lastSuccess, checkedAt }
 *
 * status : 'green' | 'yellow' | 'red'
 * stage  : null | 'scrape' | 'process' | 'load' (failed generic stage)
 * detail : human-readable explanation
 * lastSuccess : ISO string of the most recent date in the DB, or null
 * checkedAt   : ISO string of now
 */
function runCheck(config) {
  const now = new Date();
  const checkedAt = now.toISOString();

  // ── 1. Query the database ─────────────────────────────────────────────────
  let latestDate = null;
  let dbError = null;

  if (!config.dbPath) {
    dbError = 'DB_PATH is not configured';
  } else if (!Database) {
    dbError = 'better-sqlite3 module not available';
  } else {
    try {
      const db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
      const tableName = sqlIdentifier(config.dbTable, 'StatusRecords');
      const dateColumn = sqlIdentifier(config.dbDateColumn, 'RecordDate');
      // ISO-like date strings sort correctly as text and are safe for MAX().
      const row = db.prepare(`SELECT MAX("${dateColumn}") AS latest FROM "${tableName}"`).get();
      db.close();
      // Append T00:00:00 so a YYYY-MM-DD string is parsed as local midnight,
      // not UTC midnight (which drifts by the server's UTC offset).
      if (row && row.latest) latestDate = new Date(`${row.latest}T00:00:00`);
    } catch (err) {
      dbError = err.message;
    }
  }

  const lastSuccess = latestDate ? latestDate.toISOString() : null;
  // A date-only record usually represents data through end of that day, so
  // measure staleness from midnight of the next day.
  const latestEndOfDay = latestDate ? new Date(latestDate.getTime() + 86_400_000) : null;
  const hoursStale = latestEndOfDay ? msToHours(now - latestEndOfDay) : Infinity;

  // ── 2. Green — DB is current ──────────────────────────────────────────────
  if (!dbError && hoursStale <= config.greenThresholdHours) {
    return {
      status: 'green',
      stage: null,
      detail: `Database is current. Most recent record: ${latestDate.toLocaleDateString()}.`,
      lastSuccess,
      checkedAt,
    };
  }

  // DB is stale or unreachable, so work backwards through the generic stages.

  // ── 3. Check for report output (means process step ran but load failed) ───
  const reportMtime = Math.max(
    mostRecentMtime(config.reportWorkPath, config.reportExtensions) || 0,
    mostRecentMtime(config.reportSummaryPath, config.reportExtensions) || 0,
    mostRecentMtime(config.reportFinalPath, config.reportExtensions) || 0,
  );
  const reportHoursAgo = reportMtime ? msToHours(now - reportMtime) : Infinity;

  if (reportHoursAgo <= config.greenThresholdHours) {
    const msg = dbError
      ? `Cannot open database (${dbError}) but report output exists. The database may be locked or the path may be wrong.`
      : `Report output found (${Math.round(reportHoursAgo)}h ago) but database was not updated. The load step may have failed.`;
    return {
      status: 'yellow',
      stage: 'load',
      detail: msg,
      lastSuccess,
      checkedAt,
    };
  }

  // ── 4. Check for raw source files (means collection worked) ───────────────
  const rawMtime = Math.max(
    mostRecentRawData(config.rawDataPath, config.rawDataExtensions) || 0,
    mostRecentMtime(config.archivedDataPath, config.rawDataExtensions, true) || 0,
  );
  const rawHoursAgo = rawMtime ? msToHours(now - rawMtime) : Infinity;

  if (rawHoursAgo <= config.greenThresholdHours) {
    return {
      status: 'yellow',
      stage: 'process',
      detail: `Raw source data found (${Math.round(rawHoursAgo)}h ago) but no report output was produced. The processing step may have failed.`,
      lastSuccess,
      checkedAt,
    };
  }

  // ── 5. Check today's log for any activity ─────────────────────────────────
  const log = readTodayLog(config.sourceLogPath);

  if (log.hasActivity && log.hasErrors) {
    return {
      status: 'yellow',
      stage: 'process',
      detail: `Source job ran today but logged errors. Last error: ${log.lastError || 'see log file'}`,
      lastSuccess,
      checkedAt,
    };
  }

  // ── 6. Nothing found — RED ────────────────────────────────────────────────
  const staleMsg = latestDate
    ? `Last database update was ${Math.round(hoursStale)}h ago.`
    : 'No records found in database.';

  return {
    status: 'red',
    stage: 'scrape',
    detail: `${staleMsg} No raw data, report output, or log activity detected. Source data may not have reached the monitor.`,
    lastSuccess,
    checkedAt,
  };
}

module.exports = { runCheck };
