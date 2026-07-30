// web/src/api.js
// Обёртка над fetch: каждый запрос к /api/* несёт заголовок X-Telegram-Init-Data.
//
// spec:05-api.md#q9 — аутентификация через initData
// spec:07-non-functional.md#q3 — заголовок секретный, в логи не пишем

/**
 * Получает initData из Telegram WebApp SDK.
 * В production всегда есть window.Telegram.WebApp.initData (строка).
 * В dev (открыли index.html не через Telegram) — пустая строка → 401.
 */
function getInitData() {
  if (typeof window === 'undefined') return '';
  const tg = window.Telegram?.WebApp;
  if (!tg) return '';
  return tg.initData || '';
}

export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Делает fetch к /api/* и парсит ответ.
 * Бросает ApiError при HTTP-ошибке.
 */
export async function apiFetch(path, options = {}) {
  const initData = getInitData();
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': initData,
    ...(options.headers || {}),
  };
  const res = await fetch(path, { ...options, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // пустое тело или не JSON
  }
  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      code: body?.error?.code,
      message: body?.error?.message || res.statusText,
      details: body?.error?.details,
    });
  }
  return body;
}

// ─── Конкретные эндпоинты (повторяют 05-api.md) ───

export function getHealth() {
  return apiFetch('/api/health');
}

export function getSettings() {
  return apiFetch('/api/settings');
}

export function updateSettings(payload) {
  return apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function resetSettings() {
  return apiFetch('/api/settings/reset', { method: 'POST' });
}

export function getHistory(days = 7) {
  return apiFetch(`/api/history?days=${days}`);
}

export function saveMorningSurvey(payload) {
  return apiFetch('/api/surveys/morning', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function saveEveningSurvey(payload) {
  return apiFetch('/api/surveys/evening', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
