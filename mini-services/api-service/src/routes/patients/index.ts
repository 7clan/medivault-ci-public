/**
 * MediVault Fastify — Patient Routes
 *
 * Full patient CRUD with owner validation, search, pagination,
 * document upload with encrypted storage, CSV import/export,
 * timeline, visits, and multi-file upload support.
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth, requirePermission } from '../../plugins/auth.js'
import { validateCsrf } from '../../plugins/csrf.js'
import { db } from '../../lib/db.js'
import { getStorageService, isValidSha256 } from '../../lib/crypto-helpers.js'
import { FORMAT_VERSION } from '@medivault/crypto'
export async function registerPatientRoutes(server: FastifyInstance): Promise<void> {
  // ─── List Patients ─────────────────────────────────
  server.get('/api/patients', { preHandler: [requireAuth, requirePermission('patient:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const { search, page = '1', limit = '50', sort } = request.query as Record<string, string>

      const where: Record<string, unknown> = { doctorId: session.user.id, deletedAt: null }

      if (search) {
        where.OR = [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { phone: { contains: search } },
          { email: { contains: search } },
        ]
      }

      // Recent activity timeline
      if (sort === 'recent') {
        const [recentPatients, recentDocs] = await Promise.all([
          db.patient.findMany({
            where, orderBy: { createdAt: 'desc' }, take: parseInt(limit),
            include: { _count: { select: { documents: true } } },
          }),
          db.document.findMany({
            where: { patient: { doctorId: session.user.id } },
            include: { patient: { select: { firstName: true, lastName: true, id: true } } },
            orderBy: { createdAt: 'desc' }, take: parseInt(limit),
          }),
        ])

        const timeline: Array<{ type: string; patientId: string; patientName: string; timestamp: string; description: string; documentTitle?: string }> = []
        for (const p of recentPatients) {
          timeline.push({ type: 'patient_added', patientId: p.id, patientName: `${p.firstName} ${p.lastName}`, timestamp: p.createdAt.toISOString(), description: `Patient ${p.firstName} ${p.lastName} was added` })
        }
        for (const d of recentDocs) {
          timeline.push({ type: 'document_uploaded', patientId: d.patient.id, patientName: `${d.patient.firstName} ${d.patient.lastName}`, documentTitle: d.title || d.fileName, timestamp: d.createdAt.toISOString(), description: `${d.title || d.fileName} uploaded for ${d.patient.firstName} ${d.patient.lastName}` })
        }
        timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        return reply.status(200).send({ timeline: timeline.slice(0, parseInt(limit)) })
      }

      const pageNum = parseInt(page)
      const limitNum = parseInt(limit)
      const [patients, total] = await Promise.all([
        db.patient.findMany({
          where, orderBy: { updatedAt: 'desc' },
          skip: (pageNum - 1) * limitNum, take: limitNum,
          include: { _count: { select: { documents: true } }, documents: { orderBy: { scannedAt: 'desc' }, take: 1, select: { id: true, fileName: true, scannedAt: true } } },
        }),
        db.patient.count({ where }),
      ])

      return reply.status(200).send({ patients, total, page: pageNum, totalPages: Math.ceil(total / limitNum) })
    } catch (error) {
      console.error('List patients error:', error)
      return reply.status(500).send({ error: 'Failed to list patients' })
    }
  })

  // ─── Create Patient ─────────────────────────────────
  server.post('/api/patients', { preHandler: [requireAuth, requirePermission('patient:create'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const body = request.body as { firstName?: string; lastName?: string; dateOfBirth?: string; phone?: string; email?: string; address?: string; notes?: string }
      if (!body.firstName || !body.lastName) {
        return reply.status(400).send({ error: 'First name and last name are required' })
      }

      const patient = await db.patient.create({
        data: {
          doctorId: session.user.id, firstName: body.firstName, lastName: body.lastName,
          dateOfBirth: body.dateOfBirth || null, phone: body.phone || null,
          email: body.email || null, address: body.address || null, notes: body.notes || null,
        },
      })
      return reply.status(201).send(patient)
    } catch (error) {
      console.error('Create patient error:', error)
      return reply.status(500).send({ error: 'Failed to create patient' })
    }
  })

  // ─── Get Single Patient ─────────────────────────────
  server.get('/api/patients/:id', { preHandler: [requireAuth, requirePermission('patient:view')] }, async (request, reply) => {
    const session = request.session!
    const { id } = request.params as { id: string }
    const patient = await db.patient.findFirst({ where: { id, doctorId: session.user.id, deletedAt: null }, include: { _count: { select: { documents: true } } } })
    if (!patient) return reply.status(404).send({ error: 'Patient not found' })
    return reply.status(200).send(patient)
  })

  // ─── Update Patient ─────────────────────────────────
  server.put('/api/patients/:id', { preHandler: [requireAuth, requirePermission('patient:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, unknown>

      const patient = await db.patient.findFirst({ where: { id, doctorId: session.user.id } })
      if (!patient) return reply.status(404).send({ error: 'Patient not found' })

      const updated = await db.patient.update({
        where: { id },
        data: {
          firstName: (body.firstName as string) ?? patient.firstName,
          lastName: (body.lastName as string) ?? patient.lastName,
          dateOfBirth: (body.dateOfBirth as string) ?? patient.dateOfBirth,
          phone: (body.phone as string) ?? patient.phone,
          email: (body.email as string) ?? patient.email,
          address: (body.address as string) ?? patient.address,
          notes: (body.notes as string) ?? patient.notes,
        },
      })
      return reply.status(200).send(updated)
    } catch (error) {
      console.error('Update patient error:', error)
      return reply.status(500).send({ error: 'Failed to update patient' })
    }
  })

  // ─── Delete Patient ─────────────────────────────────
  server.delete('/api/patients/:id', { preHandler: [requireAuth, requirePermission('patient:delete'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }
      const patient = await db.patient.findFirst({ where: { id, doctorId: session.user.id } })
      if (!patient) return reply.status(404).send({ error: 'Patient not found' })

      // Cascade deletes documents
      await db.patient.delete({ where: { id } })
      return reply.status(200).send({ success: true })
    } catch (error) {
      console.error('Delete patient error:', error)
      return reply.status(500).send({ error: 'Failed to delete patient' })
    }
  })

  // ─── Move Document to Another Patient ─────────────────
  server.put('/api/patients/:id/documents/move', { preHandler: [requireAuth, requirePermission('document:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id: patientId } = request.params as { id: string }
      const body = request.body as { documentIds: string[]; targetPatientId: string }

      if (!body.documentIds?.length || !body.targetPatientId) {
        return reply.status(400).send({ error: 'documentIds and targetPatientId are required' })
      }

      // Verify source patient belongs to user
      const sourcePatient = await db.patient.findFirst({ where: { id: patientId, doctorId: session.user.id } })
      if (!sourcePatient) return reply.status(404).send({ error: 'Source patient not found' })

      // Verify target patient belongs to user
      const targetPatient = await db.patient.findFirst({ where: { id: body.targetPatientId, doctorId: session.user.id } })
      if (!targetPatient) return reply.status(404).send({ error: 'Target patient not found' })

      // Verify all documents belong to source patient
      const docCount = await db.document.count({ where: { id: { in: body.documentIds }, patientId } })
      if (docCount !== body.documentIds.length) {
        return reply.status(400).send({ error: 'One or more documents not found in source patient' })
      }

      // Move documents
      await db.document.updateMany({
        where: { id: { in: body.documentIds } },
        data: { patientId: body.targetPatientId },
      })

      // Audit log
      await db.auditLog.create({
        data: {
          actorId: session.user.id, action: 'DOCUMENT_MOVE',
          entityType: 'Patient', entityId: patientId,
          details: { documentCount: body.documentIds.length, targetPatientId: body.targetPatientId, sourcePatientId: patientId },
        },
      })

      return reply.status(200).send({ success: true, moved: body.documentIds.length })
    } catch (error) {
      console.error('Move documents error:', error)
      return reply.status(500).send({ error: 'Failed to move documents' })
    }
  })

  // ─── Patient Timeline ─────────────────────────────────
  server.get('/api/patients/:id/timeline', { preHandler: [requireAuth, requirePermission('patient:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id: patientId } = request.params as { id: string }

      const patient = await db.patient.findFirst({ where: { id: patientId, doctorId: session.user.id } })
      if (!patient) return reply.status(404).send({ error: 'Patient not found' })

      const [visits, documents, prescriptions, notes, annotations] = await Promise.all([
        db.visit.findMany({ where: { patientId }, orderBy: { visitDate: 'desc' } }),
        db.document.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } }),
        db.prescription.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } }),
        db.clinicalNote.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } }),
        db.annotation.findMany({ where: { documentId: { in: (await db.document.findMany({ where: { patientId }, select: { id: true } })).map(d => d.id) } }, include: { document: { select: { id: true, fileName: true, title: true } } }, orderBy: { createdAt: 'desc' } }),
      ])

      const events: Array<{ id: string; type: string; title: string; description: string; timestamp: string; details: Record<string, unknown> }> = []

      for (const v of visits) events.push({ id: `visit-${v.id}`, type: 'visit', title: `${v.visitType} Visit`, description: v.chiefComplaint || 'No chief complaint recorded', timestamp: v.visitDate.toISOString(), details: { visitId: v.id, visitType: v.visitType, status: v.status } })
      for (const d of documents) events.push({ id: `doc-${d.id}`, type: 'document', title: d.title || d.fileName, description: d.category, timestamp: d.scannedAt.toISOString(), details: { documentId: d.id, fileName: d.fileName, fileSize: d.fileSize } })
      for (const rx of prescriptions) events.push({ id: `rx-${rx.id}`, type: 'prescription', title: 'Prescription', description: rx.notes || '', timestamp: rx.createdAt.toISOString(), details: { prescriptionId: rx.id, status: rx.status } })
      for (const n of notes) events.push({ id: `note-${n.id}`, type: 'note', title: n.title, description: n.content.substring(0, 150), timestamp: n.createdAt.toISOString(), details: { noteId: n.id, category: n.category, isPinned: n.isPinned } })
      for (const a of annotations) events.push({ id: `ann-${a.id}`, type: 'annotation', title: a.content.substring(0, 80), description: a.document?.title || a.document?.fileName || 'Untitled', timestamp: a.createdAt.toISOString(), details: { annotationId: a.id } })

      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      return reply.status(200).send(events)
    } catch (error) {
      console.error('Timeline error:', error)
      return reply.status(500).send({ error: 'Failed to get timeline' })
    }
  })

  // ─── Patient Visits ────────────────────────────────
  server.get('/api/patients/:id/visits', { preHandler: [requireAuth, requirePermission('visits:view')] }, async (request, reply) => {
    const session = request.session!
    const { id } = request.params as { id: string }
    const patient = await db.patient.findFirst({ where: { id, doctorId: session.user.id } })
    if (!patient) return reply.status(404).send({ error: 'Patient not found' })

    const where: Record<string, unknown> = { patientId: id }
    const query = request.query as Record<string, string> | undefined
    const status = query?.status || undefined
    if (status) where.status = status

    const visits = await db.visit.findMany({ where, orderBy: [{ visitDate: 'desc' }, { visitTime: 'desc' }] })
    return reply.status(200).send(visits)
  })

  // ─── Upload Document (streamed multipart) ───────────
  server.post('/api/patients/:id/documents', { preHandler: [requireAuth, requirePermission('document:upload'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id: patientId } = request.params as { id: string }

      const patient = await db.patient.findFirst({ where: { id: patientId, doctorId: session.user.id } })
      if (!patient) return reply.status(404).send({ error: 'Patient not found' })

      const data = await request.file()
      if (!data) return reply.status(400).send({ error: 'No file provided' })

      const file = data.file
      const fields = data.fields as Record<string, { value?: string }>
      const title = fields?.title?.value || null
      const category = fields?.category?.value || 'General'
      const docNotes = fields?.notes?.value || null

      // Stream-based encryption — no full file in memory
      const storage = getStorageService()
      const inputStream = file
      const storeResult = await storage.storeStream(
        inputStream,
        data.filename,
        data.mimetype || 'application/octet-stream',
      )

      const { sha256, encryptedPath, header, deduplicated, chunkCount, chunkSize } = storeResult
      if (!isValidSha256(sha256)) {
        return reply.status(500).send({ error: 'Internal error: invalid hash computed' })
      }

      const document = await db.$transaction(async (tx) => {
        let storedObject = await tx.storedObject.findUnique({ where: { sha256Hash: sha256 } })
        if (!storedObject) {
          try {
            storedObject = await tx.storedObject.create({
              data: { sha256Hash: sha256, encryptedPath, plaintextSize: data.file.bytesRead, encryptionFormatVersion: FORMAT_VERSION, keyId: header.keyId, chunkCount, chunkSize, verifiedAt: new Date() },
            })
          } catch (createErr: unknown) {
            if (typeof createErr === 'object' && createErr !== null && 'code' in createErr && (createErr as { code: string }).code === 'P2002') {
              storedObject = await tx.storedObject.findUnique({ where: { sha256Hash: sha256 } })
              if (!storedObject) throw createErr
            } else throw createErr
          }
        }

        return tx.document.create({
          data: {
            patientId, fileName: data.filename, filePath: encryptedPath, fileSize: data.file.bytesRead,
            mimeType: data.mimetype || 'application/octet-stream', title: title || data.filename.replace(/\.[^/.]+$/, ''),
            category, notes: docNotes, sha256Hash: sha256, storedObjectId: storedObject.id,
          },
        })
      })

      return reply.status(201).send(document)
    } catch (error) {
      console.error('Upload document error:', error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // ─── List Patient Documents ─────────────────────────
  server.get('/api/patients/:id/documents', { preHandler: [requireAuth, requirePermission('document:view')] }, async (request, reply) => {
    const session = request.session!
    const { id: patientId } = request.params as { id: string }

    const patient = await db.patient.findFirst({ where: { id: patientId, doctorId: session.user.id } })
    if (!patient) return reply.status(404).send({ error: 'Patient not found' })

    const where: Record<string, unknown> = { patientId }
    const query = request.query as Record<string, string> | undefined
    const category = query?.category || undefined
    if (category && category !== 'All') where.category = category

    const documents = await db.document.findMany({ where, orderBy: { scannedAt: 'desc' } })
    return reply.status(200).send(documents)
  })

  // ─── Export Patients (CSV) ────────────────────────────
  server.get('/api/patients/export', { preHandler: [requireAuth, requirePermission('patient:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const patients = await db.patient.findMany({
        where: { doctorId: session.user.id },
        include: { _count: { select: { documents: true } } },
        orderBy: { createdAt: 'desc' },
      })

      const headers = ['First Name', 'Last Name', 'DOB', 'Phone', 'Email', 'Address', 'Notes', 'Document Count', 'Created Date']
      const rows = patients.map((p) => [
        escapeCsv(p.firstName), escapeCsv(p.lastName), escapeCsv(p.dateOfBirth || ''),
        escapeCsv(p.phone || ''), escapeCsv(p.email || ''), escapeCsv(p.address || ''),
        escapeCsv(p.notes || ''), String(p._count.documents),
        escapeCsv(p.createdAt.toISOString().split('T')[0]),
      ].join(','))

      const csv = [headers.join(','), ...rows].join('\n')
      return reply
        .status(200)
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="medivault-patients-${new Date().toISOString().split('T')[0]}.csv"`)
        .send(csv)
    } catch (error) {
      console.error('Export patients error:', error)
      return reply.status(500).send({ error: 'Failed to export patients' })
    }
  })

  // ─── Import Patients (CSV) ────────────────────────────
  server.post('/api/patients/import', { preHandler: [requireAuth, requirePermission('patient:create'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const data = await request.file()
      if (!data) return reply.status(400).send({ error: 'No file provided' })

      if (!data.filename.endsWith('.csv')) {
        return reply.status(400).send({ error: 'Only CSV files are accepted' })
      }

      const chunks: Buffer[] = []
      for await (const chunk of data.file) { chunks.push(Buffer.from(chunk as Buffer)) }
      const text = Buffer.concat(chunks).toString('utf-8')
      const lines = text.split(/\r?\n/).filter((l: string) => l.trim())
      if (lines.length < 2) return reply.status(400).send({ error: 'CSV must have a header row and at least one data row' })

      const headers = parseCSVLine(lines[0]).map((h: string) => h.trim().toLowerCase())
      const requiredCols = ['firstname', 'lastname']
      const missingCols = requiredCols.filter((c: string) => !headers.includes(c))
      if (missingCols.length > 0) {
        return reply.status(400).send({ error: `Missing required columns: ${missingCols.join(', ')}` })
      }

      const firstNameIdx = headers.indexOf('firstname')
      const lastNameIdx = headers.indexOf('lastname')
      const dobIdx = headers.indexOf('dateofbirth')
      const phoneIdx = headers.indexOf('phone')
      const emailIdx = headers.indexOf('email')
      const addressIdx = headers.indexOf('address')
      const notesIdx = headers.indexOf('notes')

      let imported = 0
      let skipped = 0
      const errors: string[] = []

      for (let i = 1; i < Math.min(lines.length, 1001); i++) {
        const cols = parseCSVLine(lines[i])
        const firstName = cols[firstNameIdx]?.trim()
        const lastName = cols[lastNameIdx]?.trim()
        if (!firstName || !lastName) { skipped++; errors.push(`Row ${i + 1}: Missing firstName or lastName`); continue }

        try {
          await db.patient.create({
            data: {
              doctorId: session.user.id, firstName, lastName,
              dateOfBirth: dobIdx >= 0 && cols[dobIdx]?.trim() ? cols[dobIdx].trim() : null,
              phone: phoneIdx >= 0 && cols[phoneIdx]?.trim() ? cols[phoneIdx].trim() : null,
              email: emailIdx >= 0 && cols[emailIdx]?.trim() ? cols[emailIdx].trim() : null,
              address: addressIdx >= 0 && cols[addressIdx]?.trim() ? cols[addressIdx].trim() : null,
              notes: notesIdx >= 0 && cols[notesIdx]?.trim() ? cols[notesIdx].trim() : null,
            },
          })
          imported++
        } catch (err: unknown) {
          skipped++
          errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
      }

      return reply.status(200).send({ success: true, imported, skipped, errors: errors.slice(0, 10), totalErrors: errors.length })
    } catch (error) {
      console.error('Import error:', error)
      return reply.status(500).send({ error: 'Failed to import patients' })
    }
  })
}

function escapeCsv(value: string): string {
  if (!value) return '""'
  return `"${value.replace(/"/g, '""')}`
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') { if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++ } else { inQuotes = false } }
      else { current += char }
    } else {
      if (char === '"') { inQuotes = true }
      else if (char === ',') { result.push(current); current = '' }
      else { current += char }
    }
  }
  result.push(current)
  return result
}

function csrfPreHandler(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, done: () => void): void {
  try { validateCsrf(request); done() } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) { reply.status((error as { statusCode: number }).statusCode).send({ error: (error as unknown as { message: string }).message }) }
    else { reply.status(403).send({ error: 'CSRF validation failed' }) }
  }
}
