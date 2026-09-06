/**
 * MediVault Fastify — Route Registration
 *
 * Imports and registers all route modules.
 * Routes are organized by domain and registered with appropriate
 * plugins (auth, rate-limiting, etc.).
 */

import type { FastifyInstance } from 'fastify'

/**
 * Register all routes on the Fastify instance.
 * Each route module is an async function that registers routes on the instance.
 *
 * To add new route modules:
 * 1. Create a file in the appropriate subdirectory
 * 2. Export an async function `register(server: FastifyInstance): Promise<void>`
 * 3. Import and call it here
 */
export async function registerRoutes(server: FastifyInstance): Promise<void> {
  // ─── Health & Readiness ───────────────────────────────
  // These are registered directly in server.ts before routes

  // ─── Auth Routes ──────────────────────────────────────
  // Auth routes are registered in server.ts directly (login, refresh, logout, etc.)
  // They need special handling (no auth required for login/setup, cookie management)
  await registerAuthRoutes(server)

  // ─── Patient Routes ───────────────────────────────────
  await registerPatientRoutes(server)

  // ─── Document Routes ──────────────────────────────────
  await registerDocumentRoutes(server)

  // ─── Note Routes ─────────────────────────────────────
  await registerNoteRoutes(server)

  // ─── Prescription Routes ───────────────────────────────
  await registerPrescriptionRoutes(server)

  // ─── Visit Routes ─────────────────────────────────────
  await registerVisitRoutes(server)

  // ─── User Routes ──────────────────────────────────────
  await registerUserRoutes(server)

  // ─── Role Routes ──────────────────────────────────────
  await registerRoleRoutes(server)

  // ─── Annotation Routes ────────────────────────────────
  await registerAnnotationRoutes(server)

  // ─── Misc Routes (stats, reports, backup, GC) ─────────
  await registerMiscRoutes(server)
}

// ─── Lazy imports to avoid circular dependencies ─────────

async function registerAuthRoutes(server: FastifyInstance): Promise<void> {
  const { registerAuthRoutes: register } = await import('./auth/index.js')
  await register(server)
}

async function registerPatientRoutes(server: FastifyInstance): Promise<void> {
  const { registerPatientRoutes: register } = await import('./patients/index.js')
  await register(server)
}

async function registerDocumentRoutes(server: FastifyInstance): Promise<void> {
  const { registerDocumentRoutes: register } = await import('./documents/index.js')
  await register(server)
}

async function registerNoteRoutes(server: FastifyInstance): Promise<void> {
  const { registerNoteRoutes: register } = await import('./notes/index.js')
  await register(server)
}

async function registerPrescriptionRoutes(server: FastifyInstance): Promise<void> {
  const { registerPrescriptionRoutes: register } = await import('./prescriptions/index.js')
  await register(server)
}

async function registerVisitRoutes(server: FastifyInstance): Promise<void> {
  const { registerVisitRoutes: register } = await import('./visits/index.js')
  await register(server)
}

async function registerUserRoutes(server: FastifyInstance): Promise<void> {
  const { registerUserRoutes: register } = await import('./users/index.js')
  await register(server)
}

async function registerRoleRoutes(server: FastifyInstance): Promise<void> {
  const { registerRoleRoutes: register } = await import('./roles/index.js')
  await register(server)
}

async function registerAnnotationRoutes(server: FastifyInstance): Promise<void> {
  const { registerAnnotationRoutes: register } = await import('./annotations/index.js')
  await register(server)
}

async function registerMiscRoutes(server: FastifyInstance): Promise<void> {
  const { registerMiscRoutes: register } = await import('./misc/index.js')
  await register(server)
}
