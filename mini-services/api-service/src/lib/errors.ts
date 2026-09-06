/**
 * MediVault Fastify — Error Response Helpers
 *
 * Provides functions for mapping errors to Fastify responses.
 */

import type { FastifyReply } from 'fastify'
import type { AuthError } from '@medivault/auth'

/**
 * Map an AuthError to a Fastify reply with the correct status code.
 */
export function authErrorToResponse(error: unknown, reply: FastifyReply): FastifyReply {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const authErr = error as AuthError
    const body: Record<string, unknown> = { error: authErr.message }

    if ('retryAfterMs' in authErr && typeof (authErr as { retryAfterMs: unknown }).retryAfterMs === 'number') {
      body.retryAfterMs = (authErr as { retryAfterMs: number }).retryAfterMs
      const retryAfterSec = Math.ceil((authErr as { retryAfterMs: number }).retryAfterMs / 1000)
      reply.header('Retry-After', String(retryAfterSec))
    }

    return reply.status(authErr.statusCode).send(body)
  }

  return reply.status(500).send({ error: 'Internal server error' })
}

/**
 * Send a 500 Internal Server Error response.
 * Logs the error with stack trace in non-production.
 */
export function internalError(
  message: string,
  reply: FastifyReply,
  error?: unknown,
): FastifyReply {
  if (error && !(process.env.NODE_ENV === 'production')) {
    console.error('[MediVault] Internal error:', error)
  }

  const isProduction = process.env.NODE_ENV === 'production'
  return reply.status(500).send({
    error: message,
    ...(isProduction ? {} : { stack: error instanceof Error ? error.stack : undefined }),
  })
}
