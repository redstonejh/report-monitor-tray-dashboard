'use strict';
const fs = require('fs');
const path = require('path');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

let db = null;

function init(dbPath) {
  if (!Database) {
    console.warn('[STORE] better-sqlite3 not available — history disabled');
    return;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS checks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      checkedAt   TEXT NOT NULL,
      status      TEXT NOT NULL,
      stage       TEXT,
      detail      TEXT,
      lastSuccess TEXT
    )
  `);
  console.log(`[STORE] History DB ready: ${dbPath}`);
}

function record(result) {
  if (!db) return;
  db.prepare(`
    INSERT INTO checks (checkedAt, status, stage, detail, lastSuccess)
    VALUES (@checkedAt, @status, @stage, @detail, @lastSuccess)
  `).run(result);
}

function getLatest() {
  if (!db) return null;
  return db.prepare('SELECT * FROM checks ORDER BY id DESC LIMIT 1').get() || null;
}

function getHistory(limit = 20) {
  if (!db) return [];
  return db.prepare('SELECT * FROM checks ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = { init, record, getLatest, getHistory };
