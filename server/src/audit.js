// server/src/audit.js
// Двухканальный аудит: пишем в БД (audit_log) и в файл (data/audit.log).
//
// Файл ротируется ежедневно через pino-rollup-same-file-name (нет внешних зависимостей,
// просто переименовываем при необходимости).
//
// spec:09-multi-user.md#q10 — dual-write audit
// spec:09-multi-user.md#q11 — backup.sh включает audit.log
// spec:04-data-model.md#q7 — audit_log table

import { appendFileSync, renameSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDb } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';

const AUDIT_DIR = dirname(config.databasePath);  // /data рядом с SQLite
const AUDIT_FILE = join(AUDIT_DIR, 'audit.log');

let lastDate = null;

/**
 * Пишет одну запись аудита в обе стороны.
 * @param {object} entry
 *   - actor_id: number | null
 *   - action: string
 *   - target_id: number | null
 *   - request_ip: string | null
 *   - user_agent: string | null
 *   - request_id: string | null
 *   - details: object | null
 */
export function audit(entry) {
  const ts = Math.floor(Date.now() / 1000);
  const row = {
    ts,
    actor_id: entry.actor_id ?? null,
    action: entry.action,
    target_id: entry.target_id ?? null,
    request_ip: entry.request_ip ?? null,
    user_agent: entry.user_agent ?? null,
    request_id: entry.request_id ?? null,
    details: entry.details ? JSON.stringify(entry.details) : null,
  };

  // 1. БД
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (ts, actor_id, action, target_id, request_ip, user_agent, request_id, details)
      VALUES (@ts, @actor_id, @action, @target_id, @request_ip, @user_agent, @request_id, @details)
    `).run(row);
  } catch (err) {
    logger.error({ err, entry }, 'audit: failed to write to DB');
  }

  // 2. Файл (JSON lines). Ротация по дате.
  try {
    const today = new Date(ts * 1000).toISOString().slice(0, 10);
    if (lastDate !== today) {
      rotateIfNeeded(today);
      lastDate = today;
    }
    mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(AUDIT_FILE, JSON.stringify(row) + '\n', 'utf8');
  } catch (err) {
    logger.error({ err, entry }, 'audit: failed to write to file');
  }
}

/**
 * Ротация: если файл за вчерашний день существует — переименовываем в
 * audit-YYYY-MM-DD.log. Сейчас простая логика без cron — очистка старых
 * файлов делается через backup.sh / deploy-time cron (TODO вне этого PR).
 */
function rotateIfNeeded(today) {
  if (!existsSync(AUDIT_FILE)) return;
  try {
    const st = statSync(AUDIT_FILE);
    const mtimeDay = new Date(st.mtimeMs).toISOString().slice(0, 10);
    if (mtimeDay !== today) {
      const target = join(AUDIT_DIR, `audit-${mtimeDay}.log`);
      if (!existsSync(target)) {
        renameSync(AUDIT_FILE, target);
        logger.info({ from: AUDIT_FILE, to: target }, 'audit: rotated log file');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'audit: rotate failed');
  }
}

/**
 * Чтение audit_log из БД с пагинацией и фильтрами.
 */
export function list({ action, actor_id, target_id, since_ts, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];
  if (action) { conditions.push('action = ?'); params.push(action); }
  if (actor_id !== undefined && actor_id !== null) { conditions.push('actor_id = ?'); params.push(Number(actor_id)); }
  if (target_id !== undefined && target_id !== null) { conditions.push('target_id = ?'); params.push(Number(target_id)); }
  if (since_ts !== undefined && since_ts !== null) { conditions.push('ts >= ?'); params.push(Number(since_ts)); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT count(*) AS c FROM audit_log ${where}`).get(...params).c;
  const items = db.prepare(`
    SELECT * FROM audit_log ${where}
    ORDER BY ts DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return { items, total, limit, offset };
}
