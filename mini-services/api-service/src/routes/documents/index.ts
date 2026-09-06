/**
 * MediVault Fastify — Document Routes
 *
 * Full document CRUD with encrypted streaming download, range support,
 * owner validation, reference counting for deferred deletion.
 */

import type { FastifyInstance } from 'fastify'
import { Readable } from 'node:stream'
import { requireAuth, requirePermission } from '../../plugins/auth.js'
import { validateCsrf } from '../../plugins/csrf.js'
import { db } from '../../lib/db.js'
import { getStorageService, isValidSha256 } from '../../lib/crypto-helpers.js'
import {
  StoredObjectIntegrityError,
  EncryptedFileNotFoundError,
  RangeNotSatisfiableError,
  InvalidRangeError,
} from '@medivault/crypto'

export async function registerDocumentRoutes(server: FastifyInstance): Promise<void> {
  // ─── Get Document (download with range support) ───────
  server.get('/api/documents/:id', { preHandler: [requireAuth, requirePermission('document:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const document = await db.document.findUnique({
        where: { id },
        include: { patient: true, storedObject: true },
      })

      if (!document || document.patient.doctorId !== session.user.id || document.deletedAt) {
        return reply.status(404).send({ error: 'Document not found' })
      }

      if (!document.storedObjectId || !document.storedObject) {
        return reply.status(410).send({ error: 'Document has no encrypted storage' })
      }

      if (document.storedObject.pendingDeletionAt) {
        return reply.status(410).send({ error: 'Document data no longer available' })
      }

      const { sha256Hash } = document.storedObject
      const totalSize = document.storedObject.plaintextSize
      if (!sha256Hash) {
        return reply.status(500).send({ error: 'Document has no hash' })
      }

      const storage = getStorageService()
      const rangeHeader = request.headers.range as string | undefined
      const sanitized = document.fileName.replace(/[/\\]/g, '_').substring(0, 255)

      if (rangeHeader) {
        if (rangeHeader.includes(',')) {
          return reply.status(400).send({ error: 'Multiple ranges not supported' })
        }
        const rangeMatch = rangeHeader.match(/^bytes=(\d+)-(\d*)$/)
        if (!rangeMatch) {
          return reply.status(400).send({ error: 'Invalid range format' })
        }

        const start = parseInt(rangeMatch[1], 10)
        const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : totalSize - 1
        if (isNaN(start) || (rangeMatch[2] !== '' && isNaN(end))) {
          return reply.status(400).send({ error: 'Invalid range values' })
        }
        if (start > end) {
          return reply.status(400).send({ error: 'Start exceeds end in range' })
        }
        if (start >= totalSize) {
          return reply.status(416).header('Content-Range', `bytes */${totalSize}`).send()
        }

        const clampedEnd = Math.min(end, totalSize - 1)
        const rangeResult = await storage.retrieveRangeStream(sha256Hash, start, clampedEnd + 1)

        return reply
          .status(206)
          .header('Content-Type', document.mimeType || 'application/octet-stream')
          .header('Content-Disposition', `attachment; filename="${sanitized}"`)
          .header('Content-Length', String(rangeResult.data.length))
          .header('Content-Range', `bytes ${start}-${clampedEnd}/${rangeResult.totalSize}`)
          .header('Accept-Ranges', 'bytes')
          .header('Cache-Control', 'private, no-store')
          .header('Pragma', 'no-cache')
          .header('X-Content-Type-Options', 'nosniff')
          .send(rangeResult.data)
      }

      // Full file download — streaming
      const result = await storage.retrieveStream(sha256Hash)
      return reply
        .status(200)
        .header('Content-Type', document.mimeType || 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${sanitized}"`)
        .header('Content-Length', String(result.originalSize))
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', 'private, no-store')
        .header('Pragma', 'no-cache')
        .header('X-Content-Type-Options', 'nosniff')
        .send(Readable.toWeb(result.stream))
    } catch (error) {
      if (error instanceof RangeNotSatisfiableError) {
        return reply.status(416).header('Content-Range', `bytes */${error.totalSize}`).send()
      }
      if (error instanceof StoredObjectIntegrityError) {
        return reply.status(500).send({ error: 'Server integrity error' })
      }
      if (error instanceof EncryptedFileNotFoundError) {
        return reply.status(404).send({ error: 'Document data not found' })
      }
      console.error('Get document error:', error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // ─── Update Document Metadata ───────────────────────
  server.put('/api/documents/:id', { preHandler: [requireAuth, requirePermission('document:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }
      const body = request.body as { title?: string; category?: string; notes?: string }

      const document = await db.document.findUnique({
        where: { id },
        include: { patient: true },
      })
      if (!document || document.patient.doctorId !== session.user.id) {
        return reply.status(404).send({ error: 'Document not found' })
      }

      const updated = await db.document.update({
        where: { id },
        data: {
          title: body.title ?? document.title,
          category: body.category ?? document.category,
          notes: body.notes ?? document.notes,
        },
      })
      return reply.status(200).send(updated)
    } catch (error) {
      console.error('Update document error:', error)
      return reply.status(500).send({ error: 'Failed to update document' })
    }
  })

  // ─── Delete Document (soft, with ref counting) ────────
  server.delete('/api/documents/:id', { preHandler: [requireAuth, requirePermission('document:delete'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const document = await db.document.findUnique({
        where: { id },
        include: { patient: true, storedObject: true },
      })
      if (!document || document.patient.doctorId !== session.user.id) {
        return reply.status(404).send({ error: 'Document not found' })
      }

      await db.document.update({ where: { id }, data: { deletedAt: new Date() } })

      // Check reference counts for deferred deletion
      if (document.storedObjectId) {
        const [activeRefs, versionRefs, currentVersionRefs] = await Promise.all([
          db.document.count({ where: { storedObjectId: document.storedObjectId, deletedAt: null, id: { not: document.id } } }),
          db.documentVersion.count({ where: { storedObjectId: document.storedObjectId } }),
          db.document.count({ where: { documentVersionId: document.storedObjectId, deletedAt: null } }),
        ])

        if (activeRefs === 0 && versionRefs === 0 && currentVersionRefs === 0) {
          await db.storedObject.update({
            where: { id: document.storedObjectId },
            data: { pendingDeletionAt: new Date(), purgeState: 'PENDING_DELETION' },
          })
        }
      }

      return reply.status(200).send({ success: true })
    } catch (error) {
      console.error('Delete document error:', error)
      return reply.status(500).send({ error: 'Failed to delete document' })
    }
  })

  // ─── View Document (inline) ──────────────────────────
  server.get('/api/documents/:id/view', { preHandler: [requireAuth, requirePermission('document:view')] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const document = await db.document.findUnique({
        where: { id },
        include: { patient: true, storedObject: true },
      })

      if (!document || document.patient.doctorId !== session.user.id || document.deletedAt) {
        return reply.status(404).send({ error: 'Document not found' })
      }
      if (!document.storedObjectId || !document.storedObject) {
        return reply.status(410).send({ error: 'Document has no encrypted storage' })
      }
      if (document.storedObject.pendingDeletionAt) {
        return reply.status(410).send({ error: 'Document data no longer available' })
      }

      const { sha256Hash } = document.storedObject
      if (!sha256Hash) {
        return reply.status(500).send({ error: 'Document has no hash' })
      }

      const storage = getStorageService()
      const result = await storage.retrieveStream(sha256Hash)
      const sanitized = document.fileName.replace(/[/\\]/g, '_').substring(0, 255)

      return reply
        .status(200)
        .header('Content-Type', document.mimeType || 'application/pdf')
        .header('Content-Disposition', `inline; filename="${sanitized}"`)
        .header('Content-Length', String(result.originalSize))
        .header('Cache-Control', 'private, no-store')
        .header('Pragma', 'no-cache')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Accept-Ranges', 'bytes')
        .send(Readable.toWeb(result.stream))
    } catch (error) {
      if (error instanceof StoredObjectIntegrityError) {
        return reply.status(500).send({ error: 'Server integrity error' })
      }
      if (error instanceof EncryptedFileNotFoundError) {
        return reply.status(404).send({ error: 'Document data not found' })
      }
      console.error('View document error:', error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // ─── List Annotations ────────────────────────────────
  server.get('/api/documents/:id/annotations', { preHandler: [requireAuth, requirePermission('notes:view')] }, async (request, reply) => {
    const session = request.session!
    const { id } = request.params as { id: string }

    const document = await db.document.findUnique({ where: { id }, include: { patient: true } })
    if (!document || document.patient.doctorId !== session.user.id) {
      return reply.status(404).send({ error: 'Document not found' })
    }

    const annotations = await db.annotation.findMany({
      where: { documentId: id },
      orderBy: { createdAt: 'desc' },
    })
    return reply.status(200).send(annotations)
  })

  // ─── Create Annotation ──────────────────────────────
  server.post('/api/documents/:id/annotations', { preHandler: [requireAuth, requirePermission('notes:create'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }
      const body = request.body as { content?: string; x?: number; y?: number; color?: string; page?: number }

      if (!body.content || typeof body.x !== 'number' || typeof body.y !== 'number') {
        return reply.status(400).send({ error: 'content, x, and y are required' })
      }

      const document = await db.document.findUnique({ where: { id }, include: { patient: true } })
      if (!document || document.patient.doctorId !== session.user.id) {
        return reply.status(404).send({ error: 'Document not found' })
      }

      const annotation = await db.annotation.create({
        data: {
          documentId: id,
          doctorId: session.user.id,
          content: body.content,
          x: body.x,
          y: body.y,
          color: body.color || '#10b981',
          page: body.page || 1,
        },
      })
      return reply.status(201).send(annotation)
    } catch (error) {
      console.error('Create annotation error:', error)
      return reply.status(500).send({ error: 'Failed to create annotation' })
    }
  })

  // ─── Restore Document ────────────────────────────────
  server.post('/api/documents/:id/restore', { preHandler: [requireAuth, requirePermission('backup:restore'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const document = await db.document.findUnique({
        where: { id },
        include: { patient: true, storedObject: true },
      })
      if (!document || document.patient.doctorId !== session.user.id) {
        return reply.status(404).send({ error: 'Document not found' })
      }
      if (!document.deletedAt) {
        return reply.status(400).send({ error: 'Document is not deleted' })
      }

      // Check retention
      if (document.storedObject?.pendingDeletionAt) {
        const retentionMs = (document.storedObject.retentionDays || 30) * 86400_000
        if (Date.now() - document.storedObject.pendingDeletionAt.getTime() > retentionMs) {
          return reply.status(410).send({ error: 'Retention period expired, cannot restore' })
        }
      }

      const restored = await db.document.update({ where: { id }, data: { deletedAt: null } })

      if (document.storedObjectId) {
        await db.storedObject.update({
          where: { id: document.storedObjectId },
          data: { pendingDeletionAt: null, purgeState: 'ACTIVE' },
        })
      }

      return reply.status(200).send(restored)
    } catch (error) {
      console.error('Restore document error:', error)
      return reply.status(500).send({ error: 'Failed to restore document' })
    }
  })
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
