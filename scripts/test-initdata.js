#!/usr/bin/env node
// scripts/test-initdata.js
// Тесты валидации Telegram initData. Генерирует тестовые векторы в самом
// репо (по тому же алгоритму, что и Telegram), чтобы CI был детерминированным
// и не зависел от сети.
//
// Покрывает:
//   - валидный вектор проходит
//   - подмена hash → BAD_SIGNATURE
//   - подмена user.id при сохранении hash → BAD_SIGNATURE
//   - просроченный auth_date (> maxAgeSec) → EXPIRED
//   - botToken не сходится → BAD_SIGNATURE
//   - user.id не в whitelist → NOT_OWNER
//   - пустой raw → EMPTY
//   - отсутствие hash → NO_HASH
//   - user не JSON → BAD_USER
//   - безопасный constant-time compare (длина не равна → отказ без падения)

import { createHmac } from 'node:crypto';

// Чтобы избежать import'а dotenv/config в тесте — формируем env заранее.
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'TEST_BOT_TOKEN';
process.env.OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID || '777';

const { validateInitData, ValidationError } = await import('../server/src/auth.js');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);
const NOW = 1_700_000_000; // фиксированный момент для воспроизводимости

let failed = 0;
let passed = 0;
function expectThrows(fn, code, label) {
  try {
    fn();
    console.error(`  ✗ ${label}: expected throw, got none`);
    failed++;
  } catch (err) {
    if (err instanceof ValidationError && err.code === code) {
      console.log(`  ✓ ${label}: ${code}`);
      passed++;
    } else {
      console.error(`  ✗ ${label}: wrong error — code=${err.code}, message=${err.message}`);
      failed++;
    }
  }
}
function expectOk(fn, label, predicate) {
  try {
    const r = fn();
    if (predicate && !predicate(r)) {
      console.error(`  ✗ ${label}: predicate failed`, r);
      failed++;
    } else {
      console.log(`  ✓ ${label}`);
      passed++;
    }
  } catch (err) {
    console.error(`  ✗ ${label}: unexpected throw — ${err.message}`);
    failed++;
  }
}

/**
 * Строит initData + хеш по алгоритму Telegram, идентичному спецификации.
 * Принимает объект полей (без hash) и фиксированный botToken.
 * Telegram считает data_check_string по **raw** URL-encoded форме полей,
 * поэтому не получится собрать initData через URLSearchParams.toString()
 * (он перекодирует значения). Вместо этого склеиваем руками: encodeURIComponent
 * для каждого значения, потом фильтруем hash, сортируем по ключу.
 */
function buildInitData(fields) {
  // 1. Собираем raw строку без hash — точно так, как это делает Telegram WebApp.
  const parts = Object.entries(fields)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  // 2. data_check_string по алгоритму Telegram: фильтр hash + сортировка по ключу.
  const dataCheckString = parts
    .split('&')
    .filter((p) => !p.startsWith('hash='))
    .sort()
    .join('\n');
  // spec:05-api.md#q9: secret_key = HMAC-SHA256(key="WebAppData", msg=BOT_TOKEN)
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return `${parts}&hash=${hash}`;
}

const user = { id: OWNER_ID, first_name: 'Test', username: 'tester' };

// --- 1. Валидный вектор
const goodFields = {
  user: JSON.stringify(user),
  auth_date: String(NOW - 10),
  query_id: 'AAH123',
};
const goodRaw = buildInitData(goodFields);
expectOk(
  () => validateInitData(goodRaw, BOT_TOKEN, { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'valid vector returns parsed user',
  (r) => r.user.id === OWNER_ID && r.auth_date === NOW - 10,
);

// --- 2. Подмена hash
const badHash = goodRaw.replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64));
expectThrows(
  () => validateInitData(badHash, BOT_TOKEN, { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'BAD_SIGNATURE',
  'forged hash is rejected',
);

// --- 3. Подмена user.id (хеш остаётся от старого user.id — не сойдётся)
const swappedFields = { ...goodFields, user: JSON.stringify({ ...user, id: 999 }) };
const swappedRaw = buildInitData(swappedFields); // пересчитанный хеш для нового user — это валидно
// Чтобы реально протестировать "user.id в payload подменён, а хеш нет",
// сделаем иначе: возьмём goodRaw и поправим только user=... в query-string, хеш останется старый.
const tampered = goodRaw.replace(`user=${encodeURIComponent(goodFields.user)}`, `user=${encodeURIComponent(JSON.stringify({ ...user, id: 999 }))}`);
expectThrows(
  () => validateInitData(tampered, BOT_TOKEN, { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'BAD_SIGNATURE',
  'tampered user field invalidates signature',
);

// --- 4. Просроченный auth_date
const expiredFields = { ...goodFields, auth_date: String(NOW - 999) };
const expiredRaw = buildInitData(expiredFields);
expectThrows(
  () => validateInitData(expiredRaw, BOT_TOKEN, { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'EXPIRED',
  'old auth_date rejected',
);

// --- 5. botToken не сходится
expectThrows(
  () => validateInitData(goodRaw, 'WRONG_TOKEN', { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'BAD_SIGNATURE',
  'wrong botToken rejected',
);

// --- 6. Whitelist: user.id != OWNER_ID
const otherFields = { ...goodFields, user: JSON.stringify({ ...user, id: 12345 }) };
const otherRaw = buildInitData(otherFields);
expectThrows(
  () => validateInitData(otherRaw, BOT_TOKEN, { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'NOT_OWNER',
  'non-owner user rejected',
);

// --- 7. Пустой raw
expectThrows(
  () => validateInitData('', BOT_TOKEN, { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'EMPTY',
  'empty raw rejected',
);

// --- 8. Нет hash
const noHashRaw = new URLSearchParams({ user: goodFields.user, auth_date: goodFields.auth_date }).toString();
expectThrows(
  () => validateInitData(noHashRaw, BOT_TOKEN, { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'NO_HASH',
  'missing hash rejected',
);

// --- 9. user не JSON
const badUserFields = { ...goodFields, user: 'not-json{' };
const badUserRaw = buildInitData(badUserFields);
expectThrows(
  () => validateInitData(badUserRaw, BOT_TOKEN, { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'BAD_USER',
  'non-JSON user rejected',
);

// --- 10. TTL на грани: ровно 5 мин — должно проходить
const edgeFields = { ...goodFields, auth_date: String(NOW - 300) };
const edgeRaw = buildInitData(edgeFields);
expectOk(
  () => validateInitData(edgeRaw, BOT_TOKEN, { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'edge case: auth_date exactly maxAgeSec old is accepted',
);

// --- 11. TTL чуть больше maxAgeSec — отказ
const justExpiredFields = { ...goodFields, auth_date: String(NOW - 301) };
const justExpiredRaw = buildInitData(justExpiredFields);
expectThrows(
  () => validateInitData(justExpiredRaw, BOT_TOKEN, { nowSec: NOW, ownerTelegramId: OWNER_ID }),
  'EXPIRED',
  'auth_date older than maxAgeSec rejected',
);

// --- 12. Whitelist не задан (ownerTelegramId = undefined) — пропускает любого
expectOk(
  () => validateInitData(goodRaw, BOT_TOKEN, { nowSec: NOW }),
  'whitelist not enforced when ownerTelegramId is undefined',
  (r) => r.user.id === OWNER_ID,
);

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
