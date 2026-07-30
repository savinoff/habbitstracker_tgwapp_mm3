// server/src/migrate.js
// Standalone migration runner. Применяет все .sql из server/migrations/ в порядке имени.
// Записывает факт применения в schema_migrations (см. 04-data-model.md#q6).
//
// Также вызывается автоматически из server/src/index.js при старте.
//
// spec:04-data-model.md#q6 — schema_migrations
// spec:08-deploy.md (deploy flow) — idempotent restart

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((filename) => {
      const m = /^(\d{4})_(.+)\.sql$/.exec(filename);
      return {
        filename,
        version: Number.parseInt(m[1], 10),
        name: m[2],
        sql: readFileSync(join(MIGRATIONS_DIR, filename), 'utf8'),
      };
    });
}

export function runMigrations() {
  const db = getDb();

  // spec:04-data-model.md#q6
  // schema_migrations может ещё не существовать (если миграций вообще не было) — создадим.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version),
  );

  const pending = listMigrations().filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    logger.info({ applied: applied.size }, 'migrations: nothing to apply');
    return { applied: applied.size, newCount: 0 };
  }

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const m of pending) {
    const t0 = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      insertMigration.run(m.version, m.name, Math.floor(Date.now() / 1000));
      db.exec('COMMIT');
      logger.info(
        { version: m.version, name: m.name, ms: Date.now() - t0 },
        'migration applied',
      );
    } catch (err) {
      db.exec('ROLLBACK');
      logger.error({ err, version: m.version, name: m.name }, 'migration failed');
      throw err;
    }
  }

  return { applied: applied.size + pending.length, newCount: pending.length };
}

// CLI: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { applied, newCount } = runMigrations();
    console.log(JSON.stringify({ ok: true, applied, newCount }));
    closeDb();
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    closeDb();
    process.exit(1);
  }
}
