#!/usr/bin/env node
// scripts/test-db.js
// Sanity-check: применяет миграции в /tmp и проверяет, что все таблицы из 04-data-model созданы.
// Запускается вручную и в CI (дополнительно к spec-check).
//
// spec:04-data-model.md#q2..q6 — все 5 таблиц должны быть на месте
// spec:07-non-functional.md#q2 — WAL, FK

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Перенаправляем DATABASE_PATH во временную папку ДО импорта db.js.
const tmp = mkdtempSync(join(tmpdir(), 'habitstracker-test-'));
process.env.DATABASE_PATH = join(tmp, 'habits.db');

const { getDb, closeDb } = await import('../server/src/db.js');
const { runMigrations } = await import('../server/src/migrate.js');

let failed = false;
try {
  runMigrations();
  const db = getDb();

  // spec:04-data-model.md#q2..q6
  const expected = ['users', 'morning_surveys', 'evening_surveys', 'reminder_log', 'schema_migrations'];
  const got = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);

  for (const t of expected) {
    if (!got.includes(t)) {
      console.error(`  ✗ table missing: ${t}`);
      failed = true;
    } else {
      console.log(`  ✓ table present: ${t}`);
    }
  }

  // WAL mode
  const jm = db.pragma('journal_mode', { simple: true });
  if (jm !== 'wal') {
    console.error(`  ✗ journal_mode is '${jm}', expected 'wal'`);
    failed = true;
  } else {
    console.log(`  ✓ journal_mode = wal`);
  }

  // FK
  const fk = db.pragma('foreign_keys', { simple: true });
  if (fk !== 1) {
    console.error(`  ✗ foreign_keys = ${fk}, expected 1`);
    failed = true;
  } else {
    console.log(`  ✓ foreign_keys = ON`);
  }

  // Idempotency: повторный runMigrations не должен ничего менять
  const before = db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c;
  runMigrations();
  const after = db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c;
  if (before !== after) {
    console.error(`  ✗ migrations not idempotent: ${before} -> ${after}`);
    failed = true;
  } else {
    console.log(`  ✓ migrations idempotent (${after} applied)`);
  }
} catch (err) {
  console.error('test-db failed:', err);
  failed = true;
} finally {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
