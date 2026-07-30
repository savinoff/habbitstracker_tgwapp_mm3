// server/src/plugins/error.js
// Единый формат ошибок: { error: { code, message, details? } }.
// Так клиент Mini App всегда может полагаться на структуру.
//
// spec:05-api.md#q1 — формат ошибок

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

  fastify.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.url}` },
    });
  });
}
