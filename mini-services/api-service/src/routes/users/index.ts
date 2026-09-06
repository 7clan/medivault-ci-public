/**
 * MediVault Fastify — User Routes
 *
 * User management with RBAC. Includes CRUD, enable, disable, and reset-password.
 * Password creation validates strength. Delete does soft-disable (isActive: false).
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth, requirePermission } from '../../plugins/auth.js'
import { validateCsrf } from '../../plugins/csrf.js'
import { db } from '../../lib/db.js'
import { hashPassword, validatePasswordStrength } from '@medivault/auth'
import { disableUser, enableUser, resetUserPassword } from '../../lib/auth-service.js'

const USER_SELECT = {
  id: true, email: true, name: true, phone: true, specialty: true,
  isActive: true, mustChangePassword: true, lastLoginAt: true,
  failedLoginAttempts: true, lockedUntil: true,
  role: { select: { id: true, name: true } },
  createdAt: true,
} as const

export async function registerUserRoutes(server: FastifyInstance): Promise<void> {
  // ─── List Users ──────────────────────────────────────
  server.get('/api/users', { preHandler: [requireAuth, requirePermission('users:view')] }, async (_request, reply) => {
    try {
      const users = await db.user.findMany({
        select: USER_SELECT,
        orderBy: { createdAt: 'desc' },
      })
      return reply.status(200).send({ users })
    } catch (error) {
      console.error('List users error:', error)
      return reply.status(500).send({ error: 'Failed to list users' })
    }
  })

  // ─── Create User ──────────────────────────────────────
  server.post('/api/users', { preHandler: [requireAuth, requirePermission('users:create'), csrfPreHandler] }, async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>
      const { email, name, password, roleId, phone, specialty } = body

      if (!email || !name || !password) {
        return reply.status(400).send({ error: 'Email, name, and password are required' })
      }

      const validation = validatePasswordStrength(password as string)
      if (!validation.valid) {
        return reply.status(400).send({ error: validation.errors.join('; ') })
      }

      const hashed = await hashPassword(password as string)

      const user = await db.user.create({
        data: {
          email: (email as string).toLowerCase(),
          password: hashed,
          name: name as string,
          phone: (phone as string) || null,
          specialty: (specialty as string) || null,
          roleId: (roleId as string) || null,
        },
        select: { id: true, email: true, name: true, role: { select: { name: true } } },
      })

      return reply.status(201).send(user)
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
        return reply.status(409).send({ error: 'A user with this email already exists' })
      }
      console.error('Create user error:', error)
      return reply.status(500).send({ error: 'Failed to create user' })
    }
  })

  // ─── Get User ─────────────────────────────────────────
  server.get('/api/users/:id', { preHandler: [requireAuth, requirePermission('users:view')] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const user = await db.user.findUnique({ where: { id }, select: USER_SELECT })
      if (!user) return reply.status(404).send({ error: 'User not found' })
      return reply.status(200).send(user)
    } catch (error) {
      console.error('Get user error:', error)
      return reply.status(500).send({ error: 'Failed to get user' })
    }
  })

  // ─── Update User (PATCH) ────────────────────────────
  server.patch('/api/users/:id', { preHandler: [requireAuth, requirePermission('users:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, unknown>

      const updateData: Record<string, unknown> = {}
      if (body.name !== undefined) updateData.name = body.name
      if (body.phone !== undefined) updateData.phone = body.phone
      if (body.specialty !== undefined) updateData.specialty = body.specialty
      if (body.roleId !== undefined) updateData.roleId = body.roleId

      const user = await db.user.update({
        where: { id },
        data: updateData,
        select: { id: true, email: true, name: true, role: { select: { name: true } } },
      })

      return reply.status(200).send(user)
    } catch (error) {
      console.error('Update user error:', error)
      return reply.status(500).send({ error: 'Failed to update user' })
    }
  })

  // ─── Delete User (soft-disable) ────────────────────
  server.delete('/api/users/:id', { preHandler: [requireAuth, requirePermission('users:delete'), csrfPreHandler] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const user = await db.user.update({
        where: { id },
        data: { isActive: false },
        select: { id: true, email: true, name: true },
      })
      return reply.status(200).send(user)
    } catch (error) {
      console.error('Delete user error:', error)
      return reply.status(500).send({ error: 'Failed to delete user' })
    }
  })

  // ─── Reset User Password ──────────────────────────────
  server.post('/api/users/:id/reset-password', { preHandler: [requireAuth, requirePermission('users:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const ipAddress = (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || request.ip
      const userAgent = request.headers['user-agent'] as string | undefined

      const { tempPassword } = await resetUserPassword(
        session.user.id,
        id,
        ipAddress,
        userAgent,
      )

      return reply.status(200).send({
        message: 'Temporary password generated. User must change on next login.',
        tempPassword,
      })
    } catch (error) {
      console.error('Reset password error:', error)
      return reply.status(500).send({ error: 'Failed to reset password' })
    }
  })

  // ─── Enable User ────────────────────────────────────
  server.post('/api/users/:id/enable', { preHandler: [requireAuth, requirePermission('users:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const ipAddress = (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || request.ip
      const userAgent = request.headers['user-agent'] as string | undefined

      await enableUser(session.user.id, id, ipAddress, userAgent)

      return reply.status(200).send({ success: true, message: 'User account enabled' })
    } catch (error) {
      console.error('Enable user error:', error)
      return reply.status(500).send({ error: 'Failed to enable user' })
    }
  })

  // ─── Disable User ────────────────────────────────────
  server.post('/api/users/:id/disable', { preHandler: [requireAuth, requirePermission('users:edit'), csrfPreHandler] }, async (request, reply) => {
    try {
      const session = request.session!
      const { id } = request.params as { id: string }

      const ipAddress = (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || request.ip
      const userAgent = request.headers['user-agent'] as string | undefined

      await disableUser(session.user.id, id, ipAddress, userAgent)

      return reply.status(200).send({ success: true, message: 'User account disabled' })
    } catch (error) {
      console.error('Disable user error:', error)
      return reply.status(500).send({ error: 'Failed to disable user' })
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