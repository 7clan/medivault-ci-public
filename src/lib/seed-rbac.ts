/**
 * MediVault — RBAC Seed Data
 *
 * Creates roles and permissions if they don't exist.
 * Idempotent — safe to run multiple times.
 */

import { db } from './db'
import { PERMISSIONS, ROLES } from '@medivault/auth'

/**
 * Extract category from a permission key (e.g. 'patient:view' → 'patient')
 */
function extractCategory(permKey: string): string {
  const colonIndex = permKey.indexOf(':')
  return colonIndex > 0 ? permKey.substring(0, colonIndex) : 'other'
}

/**
 * Seed roles and permissions into the database.
 * This is idempotent — safe to run multiple times.
 */
export async function seedRolesAndPermissions(): Promise<void> {
  // ─── Seed Permissions ─────────────────────────────
  for (const [name, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({
      where: { name },
      update: { description },
      create: {
        name,
        description,
        category: extractCategory(name),
      },
    })
  }

  // ─── Seed Roles & Sync Permissions ────────────────
  for (const [roleName, permissionKeys] of Object.entries(ROLES)) {
    const role = await db.role.upsert({
      where: { name: roleName },
      update: {},
      create: {
        name: roleName,
        description: `${roleName} role`,
      },
    })

    // Get current permission IDs for this role
    const existingRolePerms = await db.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true },
    })
    const existingPermIds = new Set(existingRolePerms.map((rp) => rp.permissionId))

    // Find permission records for each key
    const targetPermissions = await db.permission.findMany({
      where: { name: { in: permissionKeys } },
      select: { id: true, name: true },
    })
    const targetPermIds = new Set(targetPermissions.map((p) => p.id))
    const targetPermMap = new Map(targetPermissions.map((p) => [p.name, p.id]))

    // Delete extras (permissions no longer in the role definition)
    // Node 20 compatible: Set.prototype.difference() requires Node 22+
    const toDelete = new Set<string>()
    for (const id of existingPermIds) {
      if (!targetPermIds.has(id)) {
        toDelete.add(id)
      }
    }
    if (toDelete.size > 0) {
      await db.rolePermission.deleteMany({
        where: {
          roleId: role.id,
          permissionId: { in: Array.from(toDelete) },
        },
      })
    }

    // Add missing permissions
    for (const permKey of permissionKeys) {
      const permId = targetPermMap.get(permKey)
      if (permId && !existingPermIds.has(permId)) {
        await db.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId: permId,
          },
        })
      }
    }
  }
}
