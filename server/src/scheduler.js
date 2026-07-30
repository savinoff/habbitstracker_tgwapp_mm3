// server/src/scheduler.js
// In-process scheduler: каждые 60 сек проверяет, кому пора слать напоминание.
//
// spec:03-features/reminders.md — полная логика
// spec:04-data-model.md#q5 — reminder_log
// spec:00-vision.md#q8 — setInterval, не system cron

import { getAllUsersForReminders, wasSent, markSent, eveningSurveyExists } from './repos/reminder.js';
import { withTx } from './db.js';
import { dateInTz, partsInTz } from './utils/dateInTz.js';
import { logger } from './logger.js';
import { TEXTS } from './bot/texts.js';

const TICK_MS = 60 * 1000; // spec:03-features/reminders.md#q3

let _interval = null;

/**
 * Один тик scheduler'а. Возвращает число отправленных напоминаний.
 * Вынесен в отдельную функцию, чтобы можно было тестировать без setInterval.
 */
export async function tick(bot) {
  // spec:03-features/reminders.md#q8 — single-instance lock через BEGIN IMMEDIATE.
  // Если второй инстанс уже держит write lock, withTx бросит SQLITE_BUSY — мы
  // пропустим этот тик, что и нужно.
  let users;
  try {
    users = withTx(() => getAllUsersForReminders());
  } catch (err) {
    if (err && /SQLITE_BUSY/.test(String(err.message || ''))) {
      logger.debug('tick skipped: db busy (another instance holds the lock)');
      return 0;
    }
    throw err;
  }

  const now = new Date();
  let sentCount = 0;

  for (const user of users) {
    try {
      const { hour, minute } = partsInTz(now, user.timezone || 'UTC');
      const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      const localDate = dateInTz(now, user.timezone || 'UTC');

      // Утренний слот.
      if (hhmm === user.morning_reminder_time) {
        if (!wasSent({ userId: user.id, kind: 'morning', localDate })) {
          await trySend(bot, user.telegram_id, TEXTS.reminderMorning, null, 'morning');
          markSent({ userId: user.id, kind: 'morning', localDate });
          sentCount++;
        }
      }

      // Вечерний слот.
      if (hhmm === user.evening_reminder_time) {
        if (!wasSent({ userId: user.id, kind: 'evening', localDate })) {
          await trySend(bot, user.telegram_id, TEXTS.reminderEvening, null, 'evening');
          markSent({ userId: user.id, kind: 'evening', localDate });
          sentCount++;
        }
      }

      // Догоняющее вечернее: шлём через 60 мин после основного, если записи нет.
      // Окно для followup: [evening_hour + 1:00, evening_hour + 1:59].
      const evHour = Number(user.evening_reminder_time.slice(0, 2));
      const evMin = Number(user.evening_reminder_time.slice(3, 5));
      const followupHour = (evHour + 1) % 24;
      if (hour === followupHour && minute === evMin) {
        if (
          !wasSent({ userId: user.id, kind: 'evening_followup', localDate }) &&
          !eveningSurveyExists({ userId: user.id, localDate })
        ) {
          await trySend(bot, user.telegram_id, TEXTS.reminderFollowup, null, 'evening_followup');
          markSent({ userId: user.id, kind: 'evening_followup', localDate });
          sentCount++;
        }
      }
    } catch (err) {
      // Один пользователь не должен ломать весь тик.
      logger.warn({ err, userId: user.id }, 'tick: user failed');
    }
  }

  if (sentCount > 0) {
    logger.info({ sentCount, users: users.length }, 'reminder tick sent');
  }
  return sentCount;
}

async function trySend(bot, chatId, text, _unused, _kind) {
  if (!bot) {
    logger.warn({ chatId }, 'bot not available; reminder not sent');
    return;
  }
  try {
    await bot.sendMessage(chatId, text);
  } catch (err) {
    logger.warn({ err: { code: err.code, message: err.message }, chatId }, 'bot.sendMessage failed');
  }
}

export function startScheduler(bot) {
  if (_interval) return;
  // Первый тик — через минуту после старта (а не сразу, чтобы не дублировать /start).
  // Но в тестах удобно иметь возможность дёрнуть tick() напрямую.
  _interval = setInterval(() => {
    tick(bot).catch((err) => {
      logger.error({ err }, 'scheduler tick crashed');
    });
  }, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'reminder scheduler started');
}

export function stopScheduler() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
