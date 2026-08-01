// server/src/plugins/error.js
// Единый формат ошибок: { error: { code, message, details? } }.
// Так клиент Mini App всегда может полагаться на структуру.
//
// spec:05-api.md#q1 — формат ошибок
//
// v0.3.0: 404-handler убран из этого плагина. Он регистрируется в
// server/src/index.js ПОСЛЕ @fastify/static, чтобы:
//   - /api/foo → JSON 404 (как раньше)
//   - /history, /settings → SPA index.html (новое поведение, q10)

export async function errorPlugin(fastify) {
  fastify.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;

    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
    } else {
      req.log.warn({ err: { code: err.code, message: err.message } }, 'client error');
    }

    const body = {
      error: {
        code: err.code || (status === 400 ? 'VALIDATION' : status === 401 ? 'UNAUTHORIZED' : 'INTERNAL'),
        message: err.message || 'Internal error',
      },
    };
    if (err.details) body.error.details = err.details;

    reply.code(status).send(body);
  });
}
