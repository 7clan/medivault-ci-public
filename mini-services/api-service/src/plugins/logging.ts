/**
 * MediVault Fastify — Structured Logging Configuration
 *
 * Configures pino for structured JSON logging.
 * - Redacts sensitive headers: authorization, cookie, set-cookie
 * - Does NOT log request bodies or patient document contents
 */

export const loggerConfig = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: { colorize: true },
  } : undefined,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.set-cookie'],
  serializers: {
    req(request: any) {
      return {
        method: request.method,
        url: request.url,
        id: request.id,
        headers: request.headers,
        remoteAddress: request.ip,
        remotePort: request.socket?.remotePort,
      }
    },
    res(reply: any) {
      return {
        statusCode: reply.statusCode,
      }
    },
  },
}
