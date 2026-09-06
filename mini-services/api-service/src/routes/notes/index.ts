/**
 * MediVault Fastify — Clinical Note Routes
 *
 * CRUD routes for clinical notes (clinicalNote model).
 * Owner validation: all queries and mutations filtered by doctorId.
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth, requirePermission } from '../../plugins/auth.js'
import { validateCsrf } from '../../plugins/csrf.js'
import { db } from '../../lib/db.js'

const VALID_CATEGORIES = ['General', 'Diagnosis', 'Treatment Plan', 'Lab Results', 'Follow-up', 'Referral'] as const

export async function registerNoteRoutes(server: FastifyInstance): Promise<void> {
  // ─── List Clinical Notes ─────────────────────────────
  server.get('/api/notes', { preHandler: [requireAuth, requirePermission('notes:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const { patientId, visitId, pinned } = request.query as { patientId?: string; visitId?: string; pinned?: string }

      const where: Record<string, unknown> = { doctorId: session.user.id }

      if (patientId) where.patientId = patientId
      if (visitId) where.visitId = visitId
      if (pinned === 'true') where.isPinned = true

      const notes = await db.clinicalNote.findMany({
        where,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true } },
          doctor: { select: { id: true, name: true } },
          visit: { select: { id: true, visitDate: true, visitType: true } },
        },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      })

      return reply.status(200).send(notes)
    } catch (error) {
      console.error('List clinical notes error:', error)
      return reply.status(500).send({ error: 'Failed to list clinical notes' })
    }
  })

  // ─── Create Clinical Note ───────────────────────────
  server.post('/api/notes', { preHandler: [requireAuth, requirePermission('notes:create'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const body = request.body as Record<string, unknown>

      if (!body.title || !body.content) {
        return reply.status(400).send({ error: 'Title and content are required' })
      }

      // Validate patient belongs to this doctor
      const patient = await db.patient.findFirst({
        where: { id: body.patientId as string, doctorId: session.user.id },
      })
      if (!patient) {
        return reply.status(404).send({ error: 'Patient not found' })
      }

      const category = body.category && VALID_CATEGORIES.includes(body.category as typeof VALID_CATEGORIES[number])
        ? body.category as string
        : 'General'

      const note = await db.clinicalNote.create({
        data: {
          patientId: body.patientId as string,
          doctorId: session.user.id,
          visitId: (body.visitId as string) || null,
          title: body.title as string,
          content: body.content as string,
          category,
          isPinned: (body.isPinned as boolean) || false,
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true } },
          doctor: { select: { id: true, name: true } },
          visit: { select: { id: true, visitDate: true, visitType: true } },
        },
      })

      return reply.status(201).send(note)
    } catch (error) {
      console.error('Create clinical note error:', error)
      return reply.status(500).send({ error: 'Failed to create clinical note' })
    }
  })

  // ─── Update Clinical Note ───────────────────────────
  server.put('/api/notes/:id', { preHandler: [requireAuth, requirePermission('notes:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, unknown>

      const note = await db.clinicalNote.findFirst({
        where: { id, doctorId: session.user.id },
      })
      if (!note) {
        return reply.status(404).send({ error: 'Clinical note not found' })
      }

      const updateData: Record<string, unknown> = {}
      if (body.title !== undefined) updateData.title = body.title
      if (body.content !== undefined) updateData.content = body.content
      if (body.category !== undefined && VALID_CATEGORIES.includes(body.category as typeof VALID_CATEGORIES[number])) {
        updateData.category = body.category
      }
      if (body.isPinned !== undefined) updateData.isPinned = body.isPinned

      const updated = await db.clinicalNote.update({
        where: { id },
        data: updateData,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true } },
          doctor: { select: { id: true, name: true } },
          visit: { select: { id: true, visitDate: true, visitType: true } },
        },
      })

      return reply.status(200).send(updated)
    } catch (error) {
      console.error('Update clinical note error:', error)
      return reply.status(500).send({ error: 'Failed to update clinical note' })
    }
  })

  // ─── Delete Clinical Note ───────────────────────────
  server.delete('/api/notes/:id', { preHandler: [requireAuth, requirePermission('notes:delete'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const note = await db.clinicalNote.findFirst({
        where: { id, doctorId: session.user.id },
      })
      if (!note) {
        return reply.status(404).send({ error: 'Clinical note not found' })
      }

      await db.clinicalNote.delete({ where: { id } })

      return reply.status(200).send({ success: true })
    } catch (error) {
      console.error('Delete clinical note error:', error)
      return reply.status(500).send({ error: 'Failed to delete clinical note' })
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
