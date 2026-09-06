/**
 * MediVault Fastify — Visit Routes
 *
 * CRUD routes for patient visits.
 * Owner validation: all queries and mutations filtered by doctorId.
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth, requirePermission } from '../../plugins/auth.js'
import { validateCsrf } from '../../plugins/csrf.js'
import { db } from '../../lib/db.js'

const VALID_TYPES = ['Checkup', 'Follow-up', 'Consultation', 'Emergency', 'Procedure'] as const
const VALID_STATUSES = ['scheduled', 'completed', 'cancelled', 'no-show'] as const

export async function registerVisitRoutes(server: FastifyInstance): Promise<void> {
  // ─── List Visits ──────────────────────────────────────
  server.get('/api/visits', { preHandler: [requireAuth, requirePermission('visits:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const { patientId, status, dateFrom, dateTo, upcoming } = request.query as {
        patientId?: string; status?: string; dateFrom?: string; dateTo?: string; upcoming?: string
      }

      const where: Record<string, unknown> = { doctorId: session.user.id }

      if (patientId) where.patientId = patientId
      if (status) where.status = status
      if (dateFrom || dateTo) {
        const dateFilter: Record<string, unknown> = {}
        if (dateFrom) dateFilter.gte = new Date(dateFrom)
        if (dateTo) dateFilter.lte = new Date(dateTo)
        where.visitDate = dateFilter
      }
      if (upcoming === 'true') {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        where.visitDate = { gte: today }
        where.status = 'scheduled'
      }

      const visits = await db.visit.findMany({
        where,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true } },
        },
        orderBy: [{ visitDate: 'asc' }, { visitTime: 'asc' }],
        take: upcoming === 'true' ? 50 : undefined,
      })

      return reply.status(200).send(visits)
    } catch (error) {
      console.error('List visits error:', error)
      return reply.status(500).send({ error: 'Failed to list visits' })
    }
  })

  // ─── Get Visit ───────────────────────────────────────
  server.get('/api/visits/:id', { preHandler: [requireAuth, requirePermission('visits:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const visit = await db.visit.findFirst({
        where: { id, doctorId: session.user.id },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true } },
        },
      })

      if (!visit) {
        return reply.status(404).send({ error: 'Visit not found' })
      }

      return reply.status(200).send(visit)
    } catch (error) {
      console.error('Get visit error:', error)
      return reply.status(500).send({ error: 'Failed to get visit' })
    }
  })

  // ─── Create Visit ───────────────────────────────────
  server.post('/api/visits', { preHandler: [requireAuth, requirePermission('visits:create'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const body = request.body as Record<string, unknown>

      // Validate patient belongs to this doctor
      const patient = await db.patient.findFirst({
        where: { id: body.patientId as string, doctorId: session.user.id },
      })
      if (!patient) {
        return reply.status(404).send({ error: 'Patient not found' })
      }

      if (!body.visitType || !VALID_TYPES.includes(body.visitType as typeof VALID_TYPES[number])) {
        return reply.status(400).send({ error: 'Invalid visit type' })
      }

      const status = body.status && VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])
        ? body.status as string
        : 'scheduled'

      const visit = await db.visit.create({
        data: {
          patientId: body.patientId as string,
          doctorId: session.user.id,
          visitDate: new Date(body.visitDate as string),
          visitTime: (body.visitTime as string) || null,
          visitType: body.visitType as string,
          chiefComplaint: (body.chiefComplaint as string) || null,
          diagnosis: (body.diagnosis as string) || null,
          prescription: (body.prescription as string) || null,
          followUpDate: body.followUpDate ? new Date(body.followUpDate as string) : null,
          followUpNotes: (body.followUpNotes as string) || null,
          status,
          notes: (body.notes as string) || null,
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true } },
        },
      })

      return reply.status(201).send(visit)
    } catch (error) {
      console.error('Create visit error:', error)
      return reply.status(500).send({ error: 'Failed to create visit' })
    }
  })

  // ─── Update Visit ─────────────────────────────────────
  server.put('/api/visits/:id', { preHandler: [requireAuth, requirePermission('visits:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, unknown>

      const visit = await db.visit.findFirst({
        where: { id, doctorId: session.user.id },
      })
      if (!visit) {
        return reply.status(404).send({ error: 'Visit not found' })
      }

      const updateData: Record<string, unknown> = {}
      if (body.visitDate !== undefined) updateData.visitDate = new Date(body.visitDate as string)
      if (body.visitTime !== undefined) updateData.visitTime = (body.visitTime as string) || null
      if (body.visitType !== undefined) updateData.visitType = body.visitType
      if (body.chiefComplaint !== undefined) updateData.chiefComplaint = (body.chiefComplaint as string) || null
      if (body.diagnosis !== undefined) updateData.diagnosis = (body.diagnosis as string) || null
      if (body.prescription !== undefined) updateData.prescription = (body.prescription as string) || null
      if (body.followUpDate !== undefined) updateData.followUpDate = body.followUpDate ? new Date(body.followUpDate as string) : null
      if (body.followUpNotes !== undefined) updateData.followUpNotes = (body.followUpNotes as string) || null
      if (body.notes !== undefined) updateData.notes = (body.notes as string) || null
      if (body.status !== undefined && VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
        updateData.status = body.status
      }

      const updated = await db.visit.update({
        where: { id },
        data: updateData,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true } },
        },
      })

      return reply.status(200).send(updated)
    } catch (error) {
      console.error('Update visit error:', error)
      return reply.status(500).send({ error: 'Failed to update visit' })
    }
  })

  // ─── Delete Visit ─────────────────────────────────────
  server.delete('/api/visits/:id', { preHandler: [requireAuth, requirePermission('visits:delete'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const visit = await db.visit.findFirst({
        where: { id, doctorId: session.user.id },
      })
      if (!visit) {
        return reply.status(404).send({ error: 'Visit not found' })
      }

      await db.visit.delete({ where: { id } })

      return reply.status(200).send({ success: true })
    } catch (error) {
      console.error('Delete visit error:', error)
      return reply.status(500).send({ error: 'Failed to delete visit' })
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