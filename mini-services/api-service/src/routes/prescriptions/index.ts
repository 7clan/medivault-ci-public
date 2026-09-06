/*
 * MediVault Fastify — Prescription Routes
 *
 * CRUD routes for prescriptions.
 * Owner validation: all queries and mutations filtered by doctorId.
 * Medications stored as JSON string.
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth, requirePermission } from '../../plugins/auth.js'
import { validateCsrf } from '../../plugins/csrf.js'
import { db } from '../../lib/db.js'

const VALID_STATUSES = ['active', 'discontinued', 'completed'] as const

export async function registerPrescriptionRoutes(server: FastifyInstance): Promise<void> {
  // ─── List Prescriptions ──────────────────────────────
  server.get('/api/prescriptions', { preHandler: [requireAuth, requirePermission('prescriptions:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const { patientId, status } = request.query as { patientId?: string; status?: string }

      const where: Record<string, unknown> = { doctorId: session.user.id }

      if (patientId) where.patientId = patientId
      if (status) where.status = status

      const prescriptions = await db.prescription.findMany({
        where,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true } },
          doctor: { select: { id: true, name: true, phone: true, specialty: true } },
          visit: { select: { id: true, visitDate: true, visitType: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      return reply.status(200).send(prescriptions)
    } catch (error) {
      console.error('List prescriptions error:', error)
      return reply.status(500).send({ error: 'Failed to list prescriptions' })
    }
  })

  // ─── Get Prescription ────────────────────────────────
  server.get('/api/prescriptions/:id', { preHandler: [requireAuth, requirePermission('prescriptions:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const prescription = await db.prescription.findFirst({
        where: { id, doctorId: session.user.id },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true, address: true } },
          doctor: { select: { id: true, name: true, phone: true, specialty: true } },
          visit: { select: { id: true, visitDate: true, visitType: true, chiefComplaint: true } },
        },
      })

      if (!prescription) {
        return reply.status(404).send({ error: 'Prescription not found' })
      }

      return reply.status(200).send(prescription)
    } catch (error) {
      console.error('Get prescription error:', error)
      return reply.status(500).send({ error: 'Failed to get prescription' })
    }
  })

  // ─── Create Prescription ────────────────────────────
  server.post('/api/prescriptions', { preHandler: [requireAuth, requirePermission('prescriptions:create'), csrfPreHandler] }, async (request, reply) => {
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

      if (!body.medications || !Array.isArray(body.medications) || (body.medications as unknown[]).length === 0) {
        return reply.status(400).send({ error: 'At least one medication is required' })
      }

      const status = body.status && VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])
        ? body.status as string
        : 'active'

      const prescription = await db.prescription.create({
        data: {
          patientId: body.patientId as string,
          doctorId: session.user.id,
          visitId: (body.visitId as string) || null,
          medications: JSON.stringify(body.medications),
          notes: (body.notes as string) || null,
          status,
        },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true } },
          doctor: { select: { id: true, name: true, phone: true, specialty: true } },
          visit: { select: { id: true, visitDate: true, visitType: true } },
        },
      })

      return reply.status(201).send(prescription)
    } catch (error) {
      console.error('Create prescription error:', error)
      return reply.status(500).send({ error: 'Failed to create prescription' })
    }
  })

  // ─── Update Prescription ──────────────────────────────
  server.put('/api/prescriptions/:id', { preHandler: [requireAuth, requirePermission('prescriptions:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, unknown>

      const prescription = await db.prescription.findFirst({
        where: { id, doctorId: session.user.id },
      })
      if (!prescription) {
        return reply.status(404).send({ error: 'Prescription not found' })
      }

      const updateData: Record<string, unknown> = {}

      if (body.status !== undefined && VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
        updateData.status = body.status
      }
      if (body.notes !== undefined) {
        updateData.notes = (body.notes as string) || null
      }
      if (body.medications !== undefined) {
        if (Array.isArray(body.medications) && (body.medications as unknown[]).length > 0) {
          updateData.medications = JSON.stringify(body.medications)
        }
      }

      const updated = await db.prescription.update({
        where: { id },
        data: updateData,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, phone: true } },
          doctor: { select: { id: true, name: true, phone: true, specialty: true } },
          visit: { select: { id: true, visitDate: true, visitType: true } },
        },
      })

      return reply.status(200).send(updated)
    } catch (error) {
      console.error('Update prescription error:', error)
      return reply.status(500).send({ error: 'Failed to update prescription' })
    }
  })

  // ─── Delete Prescription ──────────────────────────────
  server.delete('/api/prescriptions/:id', { preHandler: [requireAuth, requirePermission('prescriptions:delete'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const prescription = await db.prescription.findFirst({
        where: { id, doctorId: session.user.id },
      })
      if (!prescription) {
        return reply.status(404).send({ error: 'Prescription not found' })
      }

      await db.prescription.delete({ where: { id } })

      return reply.status(200).send({ success: true })
    } catch (error) {
      console.error('Delete prescription error:', error)
      return reply.status(500).send({ error: 'Failed to delete prescription' })
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