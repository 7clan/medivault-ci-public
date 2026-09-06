/**
 * MediVault Fastify — Annotation Routes
 *
 * Update and delete individual annotations.
 * Owner validation: annotation -> document -> patient -> doctorId.
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth, requirePermission } from '../../plugins/auth.js'
import { validateCsrf } from '../../plugins/csrf.js'
import { db } from '../../lib/db.js'

export async function registerAnnotationRoutes(server: FastifyInstance): Promise<void> {
  // ─── Update Annotation ──────────────────────────────
  server.put('/api/annotations/:id', { preHandler: [requireAuth, requirePermission('notes:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, unknown>
      const { content, color } = body

      if (!content) {
        return reply.status(400).send({ error: 'content is required' })
      }

      const annotation = await db.annotation.findUnique({
        where: { id },
        include: { document: { include: { patient: true } } },
      })

      if (!annotation || annotation.document.patient.doctorId !== session.user.id) {
        return reply.status(404).send({ error: 'Annotation not found' })
      }

      const updated = await db.annotation.update({
        where: { id },
        data: {
          content: content as string,
          color: (color as string) || annotation.color,
        },
      })

      return reply.status(200).send(updated)
    } catch (error) {
      console.error('Update annotation error:', error)
      return reply.status(500).send({ error: 'Failed to update annotation' })
    }
  })

  // ─── Delete Annotation ──────────────────────────────
  server.delete('/api/annotations/:id', { preHandler: [requireAuth, requirePermission('notes:delete'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const annotation = await db.annotation.findUnique({
        where: { id },
        include: { document: { include: { patient: true } } },
      })

      if (!annotation || annotation.document.patient.doctorId !== session.user.id) {
        return reply.status(404).send({ error: 'Annotation not found' })
      }

      await db.annotation.delete({ where: { id } })

      return reply.status(200).send({ success: true })
    } catch (error) {
      console.error('Delete annotation error:', error)
      return reply.status(500).send({ error: 'Failed to delete annotation' })
    }
  })
}

// ─── CSRF pre-handler helper ────────────────────────────
function csrfPreHandler(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, done: () => void): void {
  try { validateCsrf(request); done() } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) { reply.status((error as { statusCode: number }).statusCode).send({ error: (error as unknown as { message: string }).message }) }
    else { reply.status(403).send({ error: 'CSRF validation failed' }) }
  }
}