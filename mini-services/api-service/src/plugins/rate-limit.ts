/**
 * MediVault Fastify — Rate Limiting Plugin
 *
 * Provides two rate limiting configurations:
 * 1. Global rate limit: 100 requests per 60 seconds per IP
 * 2. Auth routes rate limit: 10 requests per 60 seconds per IP
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import rateLimit from '@fastify/rate-limit'

/**
 * Global rate limit: 100 requests per 60 seconds per IP.
 */
export const globalRateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '60 seconds',
    cache: 10000,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  })
}

/**
 * Stricter rate limit for auth routes: 10 requests per 60 seconds per IP.
 * Register this plugin for the auth route prefix.
 */
export const authRateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    max: 10,
    timeWindow: '60 seconds',
    cache: 10000,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  })
}

export default fp(globalRateLimitPlugin, {
  name: 'medivault-rate-limit',
})
