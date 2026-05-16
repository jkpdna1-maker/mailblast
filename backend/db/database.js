const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const DB_PATH = path.join(__dirname, '../mailblast.db');
let _db = null;
async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }
  _db._save = function () {
    const data = this.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  };
  createTables();
  return _db;
}
function createTables() {
  _db.run(`CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, user_email TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL, body_html TEXT NOT NULL, body_text TEXT, from_name TEXT NOT NULL, from_email TEXT NOT NULL, track_opens INTEGER DEFAULT 1, status TEXT DEFAULT 'draft', scheduled_at TEXT, sent_at TEXT, total_recipients INTEGER DEFAULT 0, sent_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`);
  _db.run(`CREATE TABLE IF NOT EXISTS recipients (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT, status TEXT DEFAULT 'pending', sent_at TEXT, error TEXT)`);
  _db.run(`CREATE TABLE IF NOT EXISTS open_events (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, recipient_id TEXT NOT NULL, email TEXT NOT NULL, opened_at TEXT DEFAULT (datetime('now')), ip TEXT, user_agent TEXT)`);
  _db.run(`CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, filename TEXT NOT NULL, mimetype TEXT NOT NULL, size INTEGER, data BLOB)`);
  _db.run(`CREATE TABLE IF NOT EXISTS scheduled_jobs (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, scheduled_at TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')))`);
  _db._save();
}
function prepare(sql) {
  return {
    get: (...params) => {
      const flat = params.flat();
      const result = _db.exec(sql, flat);
      if (!result || result.length === 0) return undefined;
      const { columns, values } = result[0];
      if (!values || values.length === 0) return undefined;
      return Object.fromEntries(columns.map((c, i) => [c, values[0][i]]));
    },
    all: (...params) => {
      const flat = params.flat();
      const result = _db.exec(sql, flat);
      if (!result || result.length === 0) return [];
      const { columns, values } = result[0];
      return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
    },
    run: (...params) => {
      const flat = params.flat();
      _db.run(sql, flat);
      _db._save();
      return { changes: _db.getRowsModified() };
    }
  };
}
function exec(sql) { _db.run(sql); _db._save(); }
function transaction(fn) {
  return (args) => {
    try {
      _db.run('BEGIN');
      fn(args);
      _db.run('COMMIT');
      _db._save();
    } catch (e) {
      try { _db.run('ROLLBACK'); } catch (_) {}
      throw e;
    }
  };
}
module.exports = { initDb, prepare, exec, transaction };