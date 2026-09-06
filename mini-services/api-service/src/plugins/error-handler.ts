/**
 * MediVault Fastify — Global Error Handler
 *
 * Maps known error types to appropriate HTTP status codes.
 * - AuthError subclasses → their statusCode
 * - CsrfError → 403
 * - RateLimitError → 429 with Retry-After header
 * - Prisma P2002 (unique constraint violation) → 409
 * - Validation errors → 400
 * - Unknown errors → 500 with logging
 *
 * Never leaks stack traces in production responses.
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyError } from 'fastify'
import {
  AuthError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  AccountLockedError,
  InvalidTokenError,
  TokenReuseError,
  SetupAlreadyCompletedError,
  CsrfError,
  MustChangePasswordError,
} from '@medivault/auth'
import { Prisma } from '@medivault/db'

export const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    const isProduction = process.env.NODE_ENV === 'production'
    const reqId = request.id

    // AuthError subclasses — they carry their own statusCode
    if (error instanceof AuthError) {
      const body: Record<string, unknown> = { error: error.message }
      if ('retryAfterMs' in error && typeof (error as { retryAfterMs: unknown }).retryAfterMs === 'number') {
        body.retryAfterMs = (error as { retryAfterMs: number }).retryAfterMs
        const retryAfterSec = Math.ceil((error as { retryAfterMs: number }).retryAfterMs / 1000)
        reply.header('Retry-After', String(retryAfterSec))
      }
      return reply.status(error.statusCode).send(body)
    }

    // CsrfError → 403
    if (error instanceof CsrfError) {
      return reply.status(403).send({ error: error.message })
    }

    // RateLimitError → 429
    if (error instanceof RateLimitError) {
      const retryAfterMs = (error as RateLimitError).retryAfterMs
      const body: Record<string, unknown> = { error: error.message }
      if (typeof retryAfterMs === 'number') {
        body.retryAfterMs = retryAfterMs
        reply.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
      }
      return reply.status(429).send(body)
    }

    // Prisma unique constraint violation → 409
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.status(409).send({
        error: 'A record with this value already exists',
        code: 'P2002',
      })
    }

    // If error is not a structured error type we recognize, try generic Error handling
    if (!(error instanceof Error)) {
      request.log.error({
        err: error,
        reqId,
        method: request.method,
        url: request.url,
      }, 'Unhandled non-Error thrown')
      return reply.status(500).send({ error: 'Internal server error' })
    }

    // Fastify validation errors → 400
    if ('validation' in error && Array.isArray((error as { validation?: unknown }).validation)) {
      return reply.status(400).send({
        error: 'Validation error',
        details: (error as { validation: unknown }).validation,
      })
    }

    // Fastify FST_ERR_BAD_REQUEST → 400
    if ((error as unknown as { statusCode: number }).statusCode === 400) {
      return reply.status(400).send({ error: error.message })
    }

    // All other errors → 500
    // Log full stack trace for debugging
    request.log.error({
      err: error,
      reqId,
      method: request.method,
      url: request.url,
    }, 'Unhandled error')

    return reply.status(500).send({
      error: isProduction ? 'Internal server error' : error.message,
      ...(isProduction ? {} : { stack: error.stack }),
    })
  })
}

export default fp(errorHandlerPlugin, {
  name: 'medivault-error-handler',
})
