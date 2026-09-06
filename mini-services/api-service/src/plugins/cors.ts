/**
 * MediVault Fastify — CORS Plugin
 *
 * Configures Cross-Origin Resource Sharing using @fastify/cors.
 * - Allowed origins from ALLOWED_ORIGINS env var (comma-separated)
 * - Credentials: true (required for cookie-based auth)
 * - Wildcard origin is NOT used with credentials
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import cors from '@fastify/cors'

/**
 * Get allowed origins from environment.
 * Defaults to localhost:3000 and localhost:3001 in development.
 */
function getAllowedOrigins(): Array<string | RegExp> {
  const envOrigins = process.env.ALLOWED_ORIGINS
  if (!envOrigins) {
    return ['http://localhost:3000', 'http://localhost:3001']
  }
  return envOrigins.split(',').map((o) => o.trim())
}

export const corsPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(cors, {
    origin: getAllowedOrigins(),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Device-Id'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
}

export default fp(corsPlugin, {
  name: 'medivault-cors',
})
