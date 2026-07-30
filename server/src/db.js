// server/src/db.js
// SQLite (better-sqlite3) singleton + helpers.
// WAL + foreign keys + busy_timeout — настройки для устойчивости под нагрузкой.
//
// spec:04-data-model.md#q1 — соглашения (snake_case, INTEGER timestamps, FK on)
// spec:07-non-functional.md#q2 — WAL, foreign_keys = ON
// spec:04-data-model.md#q6 — schema_migrations tracking

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';

let _db = null;

export function getDb() {
  if (_db) return _db;
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const db = new Database(config.databasePath);

  // spec:07-non-functional.md#q2
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  _db = db;
  logger.info({ path: config.databasePath, wal: true }, 'sqlite opened');
  return db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// spec:07-non-functional.md#q3 — prepared statements only
// Обёртка для транзакции: все запросы выполняются в IMMEDIATE-транзакции.
export function withTx(fn) {
  const db = getDb();
  // BEGIN IMMEDIATE — сразу берёт write-lock, нужно для single-instance lock'а scheduler'а.
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(db);
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}
