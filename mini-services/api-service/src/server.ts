/**
 * MediVault Fastify — Main Entry Point
 *
 * Production-grade Fastify API service for the MediVault medical document management system.
 * Replaces Next.js API routes with a standalone Fastify server on port 3001.
 */

import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { loggerConfig } from './plugins/logging.js'
import { enforceHttpsConfig, isLocalhostProductionMode, shouldTrustProxy } from './lib/https-enforcement.js'
import { disconnectDb, db } from './lib/db.js'
import { fastifyAuthPlugin } from './plugins/auth.js'
import { corsPlugin } from './plugins/cors.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { multipartPlugin } from './plugins/multipart.js'
import { runStartupCleanup } from './services/startup-cleanup.js'
import { registerRoutes } from './routes/index.js'

// ─── Constants ───────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3001', 10)
const HOST = process.env.HOST || '0.0.0.0'
const STARTUP_TIME = Date.now()

// ─── HTTPS Enforcement ──────────────────────────────────

try {
  enforceHttpsConfig()
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message)
    process.exit(1)
  }
}

// ─── Trust Proxy Configuration ──────────────────────────
// Model A (localhost-security contract): the desktop-local architecture
// has NO proxy — X-Forwarded-* headers are never trusted in that mode
// (shouldTrustProxy() === false). All other deployments keep their exact
// previous behavior.
const TRUST_PROXY = shouldTrustProxy()

// ─── Create Fastify Instance ────────────────────────────

const server = Fastify({
  logger: loggerConfig,
  trustProxy: TRUST_PROXY,
  genReqId: () => crypto.randomUUID(),
  routerOptions: {
    ignoreTrailingSlash: false,
    maxParamLength: 100,
  },
})

// ─── Health & Readiness Endpoints ────────────────────────

server.get('/health', async (_request, reply) => {
  return reply.status(200).send({
    status: 'ok',
    uptime: Math.floor((Date.now() - STARTUP_TIME) / 1000),
    timestamp: new Date().toISOString(),
  })
})

server.get('/ready', async (_request, reply) => {
  try {
    await db.$queryRaw`SELECT 1`
    return reply.status(200).send({
      status: 'ready',
      db: true,
      uptime: Math.floor((Date.now() - STARTUP_TIME) / 1000),
      timestamp: new Date().toISOString(),
    })
  } catch {
    return reply.status(503).send({
      status: 'not_ready',
      db: false,
      uptime: Math.floor((Date.now() - STARTUP_TIME) / 1000),
      timestamp: new Date().toISOString(),
    })
  }
})

// ─── Register Plugins & Routes ──────────────────────────

async function start(): Promise<void> {
  // 1. Error handler
  await server.register(errorHandlerPlugin)

  // 2. Cookie parser (needed before auth)
  await server.register(cookie)

  // 3. CORS
  await server.register(corsPlugin)

  // 3. Multipart
  await server.register(multipartPlugin)

  // 4. Auth plugin
  await server.register(fastifyAuthPlugin)

  // 5. Register all application routes
  await registerRoutes(server as unknown as import('fastify').FastifyInstance)

  // 6. Startup cleanup (best-effort, non-blocking)
  runStartupCleanup(db, server.log as unknown as import('pino').Logger).catch((err) => {
    server.log.error({ err }, 'Startup cleanup failed')
  })

  // 7. Start listening
  try {
    await server.listen({ port: PORT, host: HOST })
    server.log.info({ port: PORT, host: HOST, env: process.env.NODE_ENV || 'development' }, 'MediVault API server started')
    if (isLocalhostProductionMode()) {
      server.log.info(
        { mode: 'localhost-production', host: HOST, port: PORT, trustProxy: TRUST_PROXY },
        'MODEL-A-LOCALHOST-PRODUCTION — loopback-only bind, no TLS terminator, no proxy trust',
      )
    }
  } catch (error) {
    server.log.fatal({ err: error }, 'Failed to start server')
    process.exit(1)
  }
}

// ─── Graceful Shutdown ───────────────────────────────────

function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    server.log.info({ signal }, 'Received shutdown signal — starting graceful shutdown')

    server.close().then(() => {
      server.log.info('Server stopped accepting new requests')
    }).catch((err) => {
      server.log.error({ err }, 'Error during server close')
    })

    try {
      await disconnectDb()
      server.log.info('Database connections closed')
    } catch (error) {
      server.log.error({ err: error }, 'Error disconnecting from database')
    }

    server.log.info('Graceful shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  process.on('uncaughtException', (error) => {
    server.log.fatal({ err: error }, 'Uncaught exception')
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    server.log.fatal({ reason }, 'Unhandled promise rejection')
    process.exit(1)
  })
}

// ─── Boot ───────────────────────────────────────────────
setupShutdownHandlers()
start().catch((error) => {
  console.error('Failed to start MediVault API service:', error)
  process.exit(1)
})

export { server }
