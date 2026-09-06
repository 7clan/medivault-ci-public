/**
 * MediVault Fastify — Role Routes
 *
 * List roles with permissions and update role permissions transactionally.
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth, requirePermission } from '../../plugins/auth.js'
import { validateCsrf } from '../../plugins/csrf.js'
import { db } from '../../lib/db.js'

export async function registerRoleRoutes(server: FastifyInstance): Promise<void> {
  // ─── List Roles ──────────────────────────────────────
  server.get('/api/roles', { preHandler: [requireAuth, requirePermission('users:view')] }, async (_request, reply) => {
    try {
      const roles = await db.role.findMany({
        include: {
          rolePermissions: {
            include: { permission: { select: { name: true, category: true } } },
          },
        },
        orderBy: { name: 'asc' },
      })

      return reply.status(200).send({
        roles: roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          permissions: r.rolePermissions.map((rp) => rp.permission),
        })),
      })
    } catch (error) {
      console.error('List roles error:', error)
      return reply.status(500).send({ error: 'Failed to list roles' })
    }
  })

  // ─── Update Role Permissions ─────────────────────────
  server.put('/api/roles/:id/permissions', { preHandler: [requireAuth, requirePermission('users:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const { id: roleId } = request.params as { id: string }
      const body = request.body as { permissionIds?: string[] }

      if (!Array.isArray(body.permissionIds)) {
        return reply.status(400).send({ error: 'permissionIds array is required' })
      }

      await db.$transaction([
        db.rolePermission.deleteMany({ where: { roleId } }),
        ...body.permissionIds.map((permId) =>
          db.rolePermission.create({
            data: { roleId, permissionId: permId },
          }),
        ),
      ])

      return reply.status(200).send({ success: true })
    } catch (error) {
      console.error('Update role permissions error:', error)
      return reply.status(500).send({ error: 'Failed to update role permissions' })
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