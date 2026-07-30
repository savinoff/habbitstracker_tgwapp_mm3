// server/src/routes/history.js
// GET /api/history?days=7|30|-1
//
// spec:05-api.md#q5 — contract
// spec:03-features/history.md — фича

import { findByTelegramId } from '../repos/users.js';
import { getHistory } from '../repos/history.js';
import { dateInTz, isValidTimezone, shiftYmd } from '../utils/dateInTz.js';
import { getDb } from '../db.js';

const ALLOWED_DAYS = new Set([7, 30, -1]);

const _stmt = {};
function stmts() {
  if (_stmt.earliestMorning) return _stmt;
  const db = getDb();
  _stmt.earliestMorning = db.prepare(
    "SELECT MIN(local_date) AS d FROM morning_surveys WHERE user_id = ?",
  );
  _stmt.earliestEvening = db.prepare(
    "SELECT MIN(local_date) AS d FROM evening_surveys WHERE user_id = ?",
  );
  return _stmt;
}

function earliestDateForUser(userId) {
  const m = stmts().earliestMorning.get(userId)?.d;
  const e = stmts().earliestEvening.get(userId)?.d;
  if (!m) return e;
  if (!e) return m;
  return m < e ? m : e;
}

export default async function historyRoutes(fastify) {
  fastify.get(
    '/api/history',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'integer', enum: [7, 30, -1] },
          },
        },
      },
      attachValidation: true,
    },
    async (req, reply) => {
      const vErr = req.validationError;
      if (vErr) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION',
            message: 'Invalid query',
            details: [{ path: '/days', message: 'must be one of 7, 30, -1' }],
          },
        });
      }

      const daysParam = req.query.days === undefined ? 7 : Number(req.query.days);
      if (!ALLOWED_DAYS.has(daysParam)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION',
            message: 'Invalid query',
            details: [{ path: '/days', message: 'must be one of 7, 30, -1' }],
          },
        });
      }

      const tgUser = req.user;
      const userRow = findByTelegramId(tgUser.id);
      if (!userRow) {
        // Пользователь не зарегистрирован (бот не вызывал /start).
        // Возвращаем пустой массив — UI получит «Здесь будет твоя история».
        return { ok: true, data: { days: [] } };
      }
      const tz = isValidTimezone(userRow.timezone) ? userRow.timezone : 'UTC';
      const now = new Date();
      const todayLocal = dateInTz(now, tz);

      let fromDate;
      let toDate = todayLocal;
      if (daysParam === -1) {
        const earliest = earliestDateForUser(userRow.id);
        fromDate = earliest || todayLocal;
      } else {
        // [today - days + 1, today]
        fromDate = shiftYmd(todayLocal, -(daysParam - 1));
      }

      const days = getHistory({ userId: userRow.id, fromDate, toDate });
      return { ok: true, data: { days } };
    },
  );
}
