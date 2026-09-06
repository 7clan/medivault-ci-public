/**
 * MediVault Fastify — Misc Routes
 *
 * Stats (dashboard analytics), patient reports,
 * backup creation, restore preview/execution,
 * and garbage collection dry-run / approve / purge.
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth, requirePermission } from '../../plugins/auth.js'
import { validateCsrf } from '../../plugins/csrf.js'
import { db } from '../../lib/db.js'

// ─── Helpers ──────────────────────────────────────────

function getMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function getMonthRange(monthsBack: number) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

function csrfPreHandler(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  done: () => void,
): void {
  try {
    validateCsrf(request)
    done()
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      reply.status((error as { statusCode: number }).statusCode).send({ error: (error as unknown as { message: string }).message })
    } else {
      reply.status(403).send({ error: 'CSRF validation failed' })
    }
  }
}

// ─── Route Registration ───────────────────────────────

export async function registerMiscRoutes(server: FastifyInstance): Promise<void> {
  // ─── Stats ────────────────────────────────────────────
  server.get('/api/stats', { preHandler: [requireAuth, requirePermission('patient:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const userId = session.user.id

      const { period, include: includeParam } = request.query as { period?: string; include?: string }
      const analyticsPeriod = period || '12months'
      const includeToday = includeParam === 'today'

      const [patientCount, documentCount, recentPatients] = await Promise.all([
        db.patient.count({ where: { doctorId: userId } }),
        db.document.count({ where: { patient: { doctorId: userId } } }),
        db.patient.findMany({
          where: { doctorId: userId },
          include: {
            documents: { orderBy: { scannedAt: 'desc' }, take: 1, select: { id: true, fileName: true, scannedAt: true } },
            _count: { select: { documents: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 8,
        }),
      ])

      // Calculate storage used
      let totalStorage = 0
      const uploadsDir = process.env.MEDIVAULT_DATA_DIR
        ? `${process.env.MEDIVAULT_DATA_DIR}/objects`
        : 'data/objects'
      try {
        const { readdirSync, statSync } = await import('node:fs')
        const { join } = await import('node:path')
        if (readdirSync) {
          const prefixDirs = readdirSync(uploadsDir, { withFileTypes: true })
          for (const dir of prefixDirs) {
            if (!dir.isDirectory()) continue
            const dirPath = join(uploadsDir, dir.name)
            const files = readdirSync(dirPath)
            for (const file of files) {
              try {
                totalStorage += statSync(join(dirPath, file)).size
              } catch { /* skip */ }
            }
          }
        }
      } catch { /* no storage dir */ }

      // Recent documents across all patients
      const recentDocuments = await db.document.findMany({
        where: { patient: { doctorId: userId } },
        include: { patient: { select: { firstName: true, lastName: true, id: true } } },
        orderBy: { scannedAt: 'desc' },
        take: 5,
      })

      // Category distribution
      const categoryDistribution = await db.document.groupBy({
        by: ['category'],
        where: { patient: { doctorId: userId } },
        _count: { category: true },
        orderBy: { _count: { category: 'desc' } },
      })

      const categoryBreakdown = categoryDistribution.map((c: { category: string; _count: { category: number } }) => ({
        category: c.category,
        count: c._count.category,
      }))

      // Analytics
      const monthsBack = analyticsPeriod === '30days' ? 1 : analyticsPeriod === '6months' ? 6 : 12
      const { start, end } = getMonthRange(monthsBack)

      const allPatients = await db.patient.findMany({
        where: { doctorId: userId, createdAt: { lte: end } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      })

      const patientsByMonth: { month: string; count: number }[] = []
      const now = new Date()
      for (let i = monthsBack - 1; i >= 0; i--) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999)
        const label = getMonthLabel(monthDate)
        const count = allPatients.filter((p) => new Date(p.createdAt) <= monthEnd).length
        patientsByMonth.push({ month: label, count })
      }

      const allDocuments = await db.document.findMany({
        where: { patient: { doctorId: userId }, scannedAt: { gte: start, lte: end } },
        select: { scannedAt: true },
        orderBy: { scannedAt: 'asc' },
      })

      const documentsByMonth: { month: string; count: number }[] = []
      for (let i = monthsBack - 1; i >= 0; i--) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const monthStart = new Date(monthDate)
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999)
        const label = getMonthLabel(monthDate)
        const count = allDocuments.filter((d) => {
          const date = new Date(d.scannedAt)
          return date >= monthStart && date <= monthEnd
        }).length
        documentsByMonth.push({ month: label, count })
      }

      const documentsByCategory = categoryBreakdown

      const storageByMonth: { month: string; size: number }[] = []
      let runningStorage = 0
      for (let i = monthsBack - 1; i >= 0; i--) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const monthStart = new Date(monthDate)
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999)
        const label = getMonthLabel(monthDate)

        const monthDocs = await db.document.findMany({
          where: { patient: { doctorId: userId }, createdAt: { gte: monthStart, lte: monthEnd } },
          select: { fileSize: true },
        })
        for (const doc of monthDocs) {
          runningStorage += doc.fileSize
        }

        storageByMonth.push({ month: label, size: runningStorage })
      }

      // Recent activity (last 30 days)
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const [recentUploads, recentNewPatients] = await Promise.all([
        db.document.findMany({
          where: { patient: { doctorId: userId }, scannedAt: { gte: thirtyDaysAgo } },
          select: { scannedAt: true },
        }),
        db.patient.findMany({
          where: { doctorId: userId, createdAt: { gte: thirtyDaysAgo } },
          select: { createdAt: true },
        }),
      ])

      const recentActivity: { date: string; uploads: number; newPatients: number }[] = []
      for (let d = 29; d >= 0; d--) {
        const dayDate = new Date()
        dayDate.setDate(dayDate.getDate() - d)
        const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate())
        const dayEnd = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 23, 59, 59, 999)
        const dateLabel = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

        const uploads = recentUploads.filter((r) => {
          const date = new Date(r.scannedAt)
          return date >= dayStart && date <= dayEnd
        }).length

        const newPats = recentNewPatients.filter((r) => {
          const date = new Date(r.createdAt)
          return date >= dayStart && date <= dayEnd
        }).length

        recentActivity.push({ date: dateLabel, uploads, newPatients: newPats })
      }

      // Today's overview
      let todayData: Record<string, unknown> | null = null
      if (includeToday) {
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const todayEnd = new Date()
        todayEnd.setHours(23, 59, 59, 999)
        const twoHoursFromNow = new Date()
        twoHoursFromNow.setHours(twoHoursFromNow.getHours() + 2)

        const [todayVisits, todayDocuments, todayPatientsSeen, nextAppointmentResult] = await Promise.all([
          db.visit.count({
            where: {
              doctorId: userId,
              visitDate: { gte: todayStart, lte: todayEnd },
              status: { in: ['scheduled', 'completed'] },
            },
          }),
          db.document.count({
            where: { patient: { doctorId: userId }, scannedAt: { gte: todayStart, lte: todayEnd } },
          }),
          db.visit.groupBy({
            by: ['patientId'],
            where: { doctorId: userId, visitDate: { gte: todayStart, lte: todayEnd }, status: 'completed' },
          }),
          db.visit.findFirst({
            where: {
              doctorId: userId,
              visitDate: { gte: todayStart, lte: twoHoursFromNow },
              status: 'scheduled',
            },
            include: { patient: { select: { firstName: true, lastName: true, id: true } } },
            orderBy: [{ visitDate: 'asc' }, { visitTime: 'asc' }],
          }),
        ])

        todayData = {
          todayVisits,
          todayDocuments,
          todayPatientsSeen: todayPatientsSeen.length,
          nextAppointment: nextAppointmentResult
            ? {
                id: nextAppointmentResult.id,
                visitDate: nextAppointmentResult.visitDate.toISOString(),
                visitTime: nextAppointmentResult.visitTime,
                visitType: nextAppointmentResult.visitType,
                chiefComplaint: nextAppointmentResult.chiefComplaint,
                patient: nextAppointmentResult.patient,
              }
            : null,
        }
      }

      return reply.status(200).send({
        patientCount,
        documentCount,
        totalStorage,
        recentPatients,
        recentDocuments,
        categoryBreakdown,
        patientsByMonth,
        documentsByMonth,
        documentsByCategory,
        storageByMonth,
        recentActivity,
        ...(includeToday ? { todayData } : {}),
      })
    } catch (error) {
      server.log.error({ err: error }, 'Stats error')
      return reply.status(500).send({ error: 'Failed to get statistics' })
    }
  })

  // ─── Reports (patient summary) ──────────────────────
  server.post('/api/reports', { preHandler: [requireAuth, requirePermission('reports:generate'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const userId = session.user.id
      const body = request.body as { patientId?: string; format?: string }
      const { patientId, format } = body

      if (!patientId) {
        return reply.status(400).send({ error: 'patientId is required' })
      }

      const patient = await db.patient.findUnique({
        where: { id: patientId },
        include: { doctor: true },
      })

      if (!patient || patient.doctorId !== userId) {
        return reply.status(404).send({ error: 'Patient not found' })
      }

      const [documents, visits, prescriptions, clinicalNotes, annotations] = await Promise.all([
        db.document.findMany({ where: { patientId }, orderBy: { scannedAt: 'desc' } }),
        db.visit.findMany({ where: { patientId }, orderBy: { visitDate: 'desc' } }),
        db.prescription.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } }),
        db.clinicalNote.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } }),
        db.annotation.findMany({
          where: { document: { patientId } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { document: { select: { title: true, fileName: true } } },
        }),
      ])

      const documentCategories: Record<string, number> = {}
      let totalStorage = 0
      for (const doc of documents) {
        documentCategories[doc.category] = (documentCategories[doc.category] || 0) + 1
        totalStorage += doc.fileSize
      }

      const visitStatuses: Record<string, number> = {}
      const upcomingVisits = visits.filter(
        (v) => new Date(v.visitDate) >= new Date() && v.status !== 'cancelled',
      )
      for (const v of visits) {
        visitStatuses[v.status] = (visitStatuses[v.status] || 0) + 1
      }
      const nextUpcoming = upcomingVisits.length > 0
        ? upcomingVisits.sort((a, b) => new Date(a.visitDate).getTime() - new Date(b.visitDate).getTime())[0]
        : null

      const activePrescriptions = prescriptions.filter((p) => p.status === 'active')
      const pinnedNotes = clinicalNotes.filter((n) => n.isPinned)

      const recentActivity = annotations.map((a) => ({
        type: 'annotation' as const,
        content: a.content,
        documentName: a.document.title || a.document.fileName,
        createdAt: a.createdAt,
      }))

      const summary = {
        generatedAt: new Date().toISOString(),
        format,
        doctor: {
          name: patient.doctor.name,
          email: patient.doctor.email,
          specialty: patient.doctor.specialty,
        },
        patient: {
          id: patient.id,
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth,
          phone: patient.phone,
          email: patient.email,
          address: patient.address,
          notes: patient.notes,
          createdAt: patient.createdAt,
        },
        documents: {
          total: documents.length,
          byCategory: documentCategories,
          totalStorage,
          latestDocument: documents[0] || null,
        },
        visits: {
          total: visits.length,
          byStatus: visitStatuses,
          upcoming: upcomingVisits.length,
          nextUpcoming,
        },
        prescriptions: {
          total: prescriptions.length,
          active: activePrescriptions.length,
        },
        clinicalNotes: {
          total: clinicalNotes.length,
          pinned: pinnedNotes.length,
        },
        recentActivity,
      }

      return reply.status(200).send(summary)
    } catch (error) {
      server.log.error({ err: error }, 'Generate report error')
      return reply.status(500).send({ error: 'Failed to generate report' })
    }
  })

  // ─── Backup: Create (full system backup) ────────────
  // Creates BackupHistory + BackupObjectEntry records, verifies each
  // encrypted file checksum, generates manifest with integrity hash.
  server.post('/api/backups', { preHandler: [requireAuth, requirePermission('backup:create'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const body = request.body as { backupType?: string }
      const { createBackup } = await import('../../services/backup-service.js')
      const result = await createBackup(session.user.id, body.backupType || 'full')
      return reply.status(201).send(result)
    } catch (error) {
      server.log.error({ err: error }, 'Backup creation error')
      return reply.status(500).send({ error: 'Failed to create backup' })
    }
  })

  // ─── Backup: List ────────────────────────────────────
  server.get('/api/backups', { preHandler: [requireAuth, requirePermission('backup:view')] }, async (_request, reply) => {
    try {
      const backups = await db.backupHistory.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          objectEntries: {
            select: { id: true, checksumVerified: true, status: true },
          },
        },
      })
      return reply.status(200).send(backups)
    } catch (error) {
      server.log.error({ err: error }, 'List backups error')
      return reply.status(500).send({ error: 'Failed to list backups' })
    }
  })

  // ─── Restore: Preview ────────────────────────────────
  server.get('/api/backups/:id/restore-preview', { preHandler: [requireAuth, requirePermission('backup:restore')] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const { restorePreview } = await import('../../services/backup-service.js')
      const result = await restorePreview(id)
      return reply.status(200).send(result)
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return reply.status(404).send({ error: error.message })
      }
      server.log.error({ err: error }, 'Restore preview error')
      return reply.status(500).send({ error: 'Failed to preview restore' })
    }
  })

  // ─── Restore: Execute ────────────────────────────────
  server.post('/api/backups/:id/restore', { preHandler: [requireAuth, requirePermission('backup:restore'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }
      const { executeRestore } = await import('../../services/backup-service.js')
      const result = await executeRestore(id, session.user.id)
      return reply.status(200).send(result)
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return reply.status(404).send({ error: error.message })
      }
      server.log.error({ err: error }, 'Restore execution error')
      return reply.status(500).send({ error: 'Failed to execute restore' })
    }
  })

  // ─── Garbage Collection: Dry Run ─────────────────────
  server.post('/api/gc/dry-run', { preHandler: [requireAuth, requirePermission('backup:restore'), csrfPreHandler] }, async (_request, reply) => {
    try {
      const { gcDryRun } = await import('../../lib/garbage-collection.js')
      const result = await gcDryRun()
      return reply.status(200).send(result)
    } catch (error) {
      server.log.error({ err: error }, 'GC dry-run error')
      return reply.status(500).send({ error: 'Failed to run GC dry-run' })
    }
  })

  // ─── Garbage Collection: Purge (explicit approval) ───
  // The caller MUST have called dry-run first, reviewed the candidates,
  // and sends only the IDs they explicitly approve for purging.
  server.post('/api/gc/purge', { preHandler: [requireAuth, requirePermission('backup:restore'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const body = request.body as { approvedIds: string[] }

      if (!Array.isArray(body.approvedIds) || body.approvedIds.length === 0) {
        return reply.status(400).send({ error: 'approvedIds is required and must be a non-empty array of StoredObject IDs' })
      }

      if (body.approvedIds.length > 1000) {
        return reply.status(400).send({ error: 'Maximum 1000 objects per purge request' })
      }

      const { gcPurgeApproved } = await import('../../lib/garbage-collection.js')
      const result = await gcPurgeApproved(session.user.id, body.approvedIds)
      return reply.status(200).send(result)
    } catch (error) {
      server.log.error({ err: error }, 'GC purge error')
      return reply.status(500).send({ error: 'Failed to run GC purge' })
    }
  })

  // ─── Legacy backup export (ZIP) — kept for backward compat ──
  server.get('/api/backup', { preHandler: [requireAuth, requirePermission('backup:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const userId = session.user.id

      const patients = await db.patient.findMany({
        where: { doctorId: userId },
        include: { documents: true },
        orderBy: { lastName: 'asc' },
      })

      const userRecord = await db.user.findUnique({ where: { id: userId } })

      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      const manifest = {
        exportDate: new Date().toISOString(),
        user: userRecord ? { name: userRecord.name, email: userRecord.email, specialty: userRecord.specialty } : null,
        patientsCount: patients.length,
        documentsCount: patients.reduce((sum, p) => sum + p.documents.length, 0),
        patients: patients.map((p) => ({
          id: p.id, firstName: p.firstName, lastName: p.lastName,
          dateOfBirth: p.dateOfBirth, phone: p.phone, email: p.email,
          address: p.address, notes: p.notes,
          documents: p.documents.map((d) => ({
            id: d.id, fileName: d.fileName, fileSize: d.fileSize,
            mimeType: d.mimeType, title: d.title, category: d.category,
            notes: d.notes, scannedAt: d.scannedAt,
          })),
        })),
      }

      zip.file('manifest.json', JSON.stringify(manifest, null, 2))

      const { getStorageService: getStorage } = await import('../../lib/crypto-helpers.js')
      const storage = getStorage()

      for (const patient of patients) {
        for (const doc of patient.documents) {
          if (doc.storedObjectId) {
            const docObj = await db.storedObject.findUnique({ where: { id: doc.storedObjectId } })
            if (docObj && storage.exists(docObj.sha256Hash)) {
              const { createReadStream } = await import('node:fs')
              const folderName = `${patient.lastName}_${patient.firstName}_${patient.id.slice(0, 6)}`
              zip.file(`documents/${folderName}/${doc.fileName}`, createReadStream(storage.objectPath(docObj.sha256Hash)))
            }
          }
        }
      }

      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })

      const date = new Date().toISOString().split('T')[0]
      const fileName = `MediVault_Export_${date}.zip`

      return reply
        .status(200)
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${fileName}"`)
        .header('Content-Length', String(zipBuffer.length))
        .send(zipBuffer)
    } catch (error) {
      server.log.error({ err: error }, 'Backup export error')
      return reply.status(500).send({ error: 'Failed to create backup export' })
    }
  })

  // ─── Root API ──────────────────────────────────────────
  server.get('/api', async (_request, reply) => {
    return reply.status(200).send({
      name: 'MediVault API',
      version: '1.0.0',
      status: 'ok',
    })
  })
}
