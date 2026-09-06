/**
 * m2-schema.test.ts — Comprehensive schema validation tests
 * Validates the expanded MediVault schema with 16 models.
 *
 * Tag: @integration — requires a live PostgreSQL instance.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const db = prisma // alias for RBAC tests

// Helper: query information_schema.columns
const getColumns = async (table: string) =>
  prisma.$queryRawUnsafe<
    Array<{ column_name: string; data_type: string; is_nullable: string }>
  >(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position`
  )

// Helper: get all index names for a table
const getIndexes = async (table: string) =>
  prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='${table}' ORDER BY indexname`
  )

// Helper: get foreign key constraints for a table
const getForeignKeys = async (table: string) =>
  prisma.$queryRawUnsafe<
    Array<{
      constraint_name: string
      column_name: string
      references_table: string
      references_column: string
      on_delete: string
    }>
  >(
    `SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS references_table,
      ccu.column_name AS references_column,
      rc.delete_rule AS on_delete
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = '${table}'`
  )

// Helper: get unique indexes (Prisma creates UNIQUE INDEX, not UNIQUE CONSTRAINT)
const getUniqueIndexes = async (table: string) =>
  prisma.$queryRawUnsafe<
    Array<{ indexname: string; indexdef: string }>
  >(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = '${table}'
       AND indexdef LIKE 'CREATE UNIQUE%'
     ORDER BY indexname`
  )

// Extract column names from a pg index definition like:
//   CREATE UNIQUE INDEX "Role_name_key" ON public."Role" USING btree (name)
//   CREATE UNIQUE INDEX "..." ON public."RolePermission" USING btree ("roleId", "permissionId")
const extractColumnsFromIndexDef = (indexdef: string): string[] => {
  const match = indexdef.match(/\((.+)\)\s*$/)
  if (!match) return []
  return match[1].split(',').map((c) => c.trim().replace(/"/g, ''))
}

const hasColumn = (cols: Array<{ column_name: string }>, name: string) =>
  cols.some((c) => c.column_name === name)

const hasIndex = (idxs: Array<{ indexname: string }>, pattern: RegExp | string) => {
  const re = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern
  return idxs.some((i) => re.test(i.indexname))
}

describe('M2 Schema — Table existence (16+ tables)', () => {
  it('should have 24 application tables + 1 migration table', async () => {
    const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\_prisma%' ORDER BY tablename`
    )
    const names = tables.map((t) => t.tablename)
    expect(names).toHaveLength(24)
    const expected = [
      'Annotation', 'AuditLog', 'AuthSession', 'BackupHistory', 'BackupObjectEntry',
      'ClinicalNote', 'Configuration', 'DeviceChallenge', 'DevicePairingCode', 'DeviceRegistration', 'Document',
      'DocumentVersion', 'LoginHistory', 'Patient', 'Permission',
      'Prescription', 'PurgeTombstone', 'RefreshToken', 'Role',
      'RolePermission', 'StoredObject', 'SyncQueue', 'User', 'Visit',
    ]
    expect(names).toEqual(expect.arrayContaining(expected))
  })
})

describe('M2 Schema — Role/Permission/RBAC', () => {
  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "RolePermission", "Permission", "Role" CASCADE')
  })

  it('Role table should have id, name (unique), description, timestamps (no JSON permissions)', async () => {
    const cols = await getColumns('Role')
    expect(hasColumn(cols, 'id')).toBe(true)
    expect(hasColumn(cols, 'name')).toBe(true)
    expect(hasColumn(cols, 'description')).toBe(true)
    expect(hasColumn(cols, 'createdAt')).toBe(true)
    expect(hasColumn(cols, 'updatedAt')).toBe(true)

    // name unique index
    const uniqueIdxs = await getUniqueIndexes('Role')
    const nameUniqueIdx = uniqueIdxs.find((i) =>
      extractColumnsFromIndexDef(i.indexdef).includes('name')
    )
    expect(nameUniqueIdx).toBeDefined()
  })

  it('A role can have multiple permissions via RolePermission', async () => {
    const role = await db.role.create({ data: { name: `multi-perm-role-${Date.now()}` } })
    const p1 = await db.permission.create({ data: { name: `perm.A.${Date.now()}`, category: 'test' } })
    const p2 = await db.permission.create({ data: { name: `perm.B.${Date.now()}`, category: 'test' } })
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: p1.id } })
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: p2.id } })
    const rps = await db.rolePermission.findMany({ where: { roleId: role.id }, include: { permission: true } })
    expect(rps).toHaveLength(2)
    const permNames = rps.map((r) => r.permission.name).sort()
    expect(permNames).toHaveLength(2)
    expect(permNames[0]).toContain('perm.A')
    expect(permNames[1]).toContain('perm.B')
  })

  it('A permission can belong to multiple roles', async () => {
    const perm = await db.permission.create({ data: { name: `shared-perm.${Date.now()}`, category: 'test' } })
    const r1 = await db.role.create({ data: { name: `role-alpha.${Date.now()}` } })
    const r2 = await db.role.create({ data: { name: `role-beta.${Date.now()}` } })
    await db.rolePermission.create({ data: { roleId: r1.id, permissionId: perm.id } })
    await db.rolePermission.create({ data: { roleId: r2.id, permissionId: perm.id } })
    const rps = await db.rolePermission.findMany({ where: { permissionId: perm.id }, include: { role: true } })
    expect(rps).toHaveLength(2)
    const roleNames = rps.map((r) => r.role.name).sort()
    expect(roleNames).toHaveLength(2)
    expect(roleNames[0]).toContain('role-alpha')
    expect(roleNames[1]).toContain('role-beta')
  })

  it('Duplicate role-permission assignments are rejected', async () => {
    const role = await db.role.create({ data: { name: `dup-role.${Date.now()}` } })
    const perm = await db.permission.create({ data: { name: `dup-perm.${Date.now()}`, category: 'test' } })
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } })
    await expect(
      db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } })
    ).rejects.toThrow()
  })

  it('Authorization reads only from the normalized RolePermission relationship', async () => {
    const role = await db.role.create({ data: { name: `auth-role.${Date.now()}` } })
    const p1 = await db.permission.create({ data: { name: `auth-read.${Date.now()}`, category: 'auth' } })
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: p1.id } })
    const roleWithPerms = await db.role.findUnique({
      where: { id: role.id },
      include: { rolePermissions: { include: { permission: true } } },
    })
    const permNames = roleWithPerms!.rolePermissions.map((rp) => rp.permission.name)
    expect(permNames).toHaveLength(1)
    expect(permNames[0]).toContain('auth-read')
    // Verify there is no JSON field to accidentally read from
    expect('permissions' in (roleWithPerms as Record<string, unknown>)).toBe(false)
  })

  it('Permission table should have id, name (unique), description, category, createdAt', async () => {
    const cols = await getColumns('Permission')
    expect(hasColumn(cols, 'id')).toBe(true)
    expect(hasColumn(cols, 'name')).toBe(true)
    expect(hasColumn(cols, 'description')).toBe(true)
    expect(hasColumn(cols, 'category')).toBe(true)
    expect(hasColumn(cols, 'createdAt')).toBe(true)
    // No updatedAt — permissions are relatively static
    const uniqueIdxs = await getUniqueIndexes('Permission')
    const nameUniqueIdx = uniqueIdxs.find((i) =>
      extractColumnsFromIndexDef(i.indexdef).includes('name')
    )
    expect(nameUniqueIdx).toBeDefined()
  })

  it('RolePermission junction table should have unique [roleId, permissionId]', async () => {
    const cols = await getColumns('RolePermission')
    expect(hasColumn(cols, 'roleId')).toBe(true)
    expect(hasColumn(cols, 'permissionId')).toBe(true)
    expect(hasColumn(cols, 'createdAt')).toBe(true)

    // Composite unique index on [roleId, permissionId]
    const uniqueIdxs = await getUniqueIndexes('RolePermission')
    const compositeIdx = uniqueIdxs.find((i) => {
      const cols = extractColumnsFromIndexDef(i.indexdef)
      return cols.includes('roleId') && cols.includes('permissionId')
    })
    expect(compositeIdx).toBeDefined()

    // Foreign keys
    const fks = await getForeignKeys('RolePermission')
    expect(fks.length).toBeGreaterThanOrEqual(2)
    const fkTables = fks.map((f) => f.references_table)
    expect(fkTables).toContain('Role')
    expect(fkTables).toContain('Permission')
  })
})

describe('M2 Schema — User (formerly Doctor)', () => {
  it('should have all expected columns including roleId, isActive, lastLoginAt', async () => {
    const cols = await getColumns('User')
    expect(hasColumn(cols, 'id')).toBe(true)
    expect(hasColumn(cols, 'email')).toBe(true)
    expect(hasColumn(cols, 'password')).toBe(true)
    expect(hasColumn(cols, 'name')).toBe(true)
    expect(hasColumn(cols, 'phone')).toBe(true)
    expect(hasColumn(cols, 'specialty')).toBe(true)
    expect(hasColumn(cols, 'roleId')).toBe(true)
    expect(hasColumn(cols, 'isActive')).toBe(true)
    expect(hasColumn(cols, 'lastLoginAt')).toBe(true)
    expect(hasColumn(cols, 'createdAt')).toBe(true)
    expect(hasColumn(cols, 'updatedAt')).toBe(true)
  })

  it('should have email unique and isActive index', async () => {
    const uniqueIdxs = await getUniqueIndexes('User')
    expect(uniqueIdxs.some((i) => extractColumnsFromIndexDef(i.indexdef).includes('email'))).toBe(true)

    const idxs = await getIndexes('User')
    expect(hasIndex(idxs, /isActive/)).toBe(true)
  })

  it('roleId should FK to Role with ON DELETE SET NULL', async () => {
    const fks = await getForeignKeys('User')
    const roleFk = fks.find((f) => f.column_name === 'roleId')
    expect(roleFk).toBeDefined()
    expect(roleFk!.references_table).toBe('Role')
    expect(roleFk!.on_delete).toBe('SET NULL')
  })
})

describe('M2 Schema — Patient', () => {
  it('should have soft-delete and sync columns', async () => {
    const cols = await getColumns('Patient')
    expect(hasColumn(cols, 'deletedAt')).toBe(true)
    expect(hasColumn(cols, 'revision')).toBe(true)
    expect(hasColumn(cols, 'originDeviceId')).toBe(true)
  })

  it('should have all required indexes', async () => {
    const idxs = await getIndexes('Patient')
    expect(hasIndex(idxs, /doctorId_idx/)).toBe(true)
    expect(hasIndex(idxs, /firstName_idx/)).toBe(true)
    expect(hasIndex(idxs, /lastName_idx/)).toBe(true)
    expect(hasIndex(idxs, /deletedAt_idx/)).toBe(true)
    expect(hasIndex(idxs, /doctorId_deletedAt_idx/)).toBe(true)
  })
})

describe('M2 Schema — Document', () => {
  it('should have sha256Hash, storedObjectId, mimeType, pageCount, sourceDeviceId, documentVersionId', async () => {
    const cols = await getColumns('Document')
    expect(hasColumn(cols, 'sha256Hash')).toBe(true)
    expect(hasColumn(cols, 'storedObjectId')).toBe(true)
    // encryptedFileName and encryptionMetadata were removed in M3 (replaced by StoredObject)
    expect(hasColumn(cols, 'encryptedFileName')).toBe(false)
    expect(hasColumn(cols, 'encryptionMetadata')).toBe(false)
    expect(hasColumn(cols, 'mimeType')).toBe(true)
    expect(hasColumn(cols, 'pageCount')).toBe(true)
    expect(hasColumn(cols, 'sourceDeviceId')).toBe(true)
    expect(hasColumn(cols, 'documentVersionId')).toBe(true)
    // fileType should NOT exist (renamed to mimeType)
    expect(hasColumn(cols, 'fileType')).toBe(false)
  })

  it('should have soft-delete and sync columns', async () => {
    const cols = await getColumns('Document')
    expect(hasColumn(cols, 'deletedAt')).toBe(true)
    expect(hasColumn(cols, 'revision')).toBe(true)
  })

  it('storedObjectId should FK to StoredObject', async () => {
    const fks = await getForeignKeys('Document')
    const soFk = fks.find((f) => f.column_name === 'storedObjectId')
    expect(soFk).toBeDefined()
    expect(soFk!.references_table).toBe('StoredObject')
    expect(soFk!.on_delete).toBe('SET NULL')
  })

  it('should have all required indexes', async () => {
    const idxs = await getIndexes('Document')
    expect(hasIndex(idxs, /patientId_idx/)).toBe(true)
    expect(hasIndex(idxs, /scannedAt_idx/)).toBe(true)
    expect(hasIndex(idxs, /category_idx/)).toBe(true)
    expect(hasIndex(idxs, /deletedAt_idx/)).toBe(true)
    expect(hasIndex(idxs, /sha256Hash_idx/)).toBe(true)
  })
})

describe('M2 Schema — DocumentVersion', () => {
  it('should exist with documentId FK, versionNumber, sha256Hash, storedObjectId, createdBy', async () => {
    const cols = await getColumns('DocumentVersion')
    expect(hasColumn(cols, 'id')).toBe(true)
    expect(hasColumn(cols, 'documentId')).toBe(true)
    expect(hasColumn(cols, 'versionNumber')).toBe(true)
    expect(hasColumn(cols, 'sha256Hash')).toBe(true)
    expect(hasColumn(cols, 'storedObjectId')).toBe(true)
    // encryptedFileName was removed in M3 (replaced by StoredObject)
    expect(hasColumn(cols, 'encryptedFileName')).toBe(false)
    expect(hasColumn(cols, 'fileSize')).toBe(true)
    expect(hasColumn(cols, 'createdBy')).toBe(true)
    expect(hasColumn(cols, 'createdAt')).toBe(true)
    // No updatedAt — versions are immutable
    expect(hasColumn(cols, 'updatedAt')).toBe(false)
  })

  it('should FK to Document (CASCADE) and User (RESTRICT)', async () => {
    const fks = await getForeignKeys('DocumentVersion')
    const docFk = fks.find((f) => f.column_name === 'documentId')
    expect(docFk).toBeDefined()
    expect(docFk!.references_table).toBe('Document')
    expect(docFk!.on_delete).toBe('CASCADE')

    const userFk = fks.find((f) => f.column_name === 'createdBy')
    expect(userFk).toBeDefined()
    expect(userFk!.references_table).toBe('User')
    expect(userFk!.on_delete).toBe('RESTRICT')
  })
})

describe('M2 Schema — Visit', () => {
  it('should have soft-delete and sync columns', async () => {
    const cols = await getColumns('Visit')
    expect(hasColumn(cols, 'deletedAt')).toBe(true)
    expect(hasColumn(cols, 'revision')).toBe(true)
  })
})

describe('M2 Schema — Prescription', () => {
  it('should have soft-delete and sync columns', async () => {
    const cols = await getColumns('Prescription')
    expect(hasColumn(cols, 'deletedAt')).toBe(true)
    expect(hasColumn(cols, 'revision')).toBe(true)
  })
})

describe('M2 Schema — ClinicalNote', () => {
  it('should have soft-delete, sync columns, and isPinned/deletedAt indexes', async () => {
    const cols = await getColumns('ClinicalNote')
    expect(hasColumn(cols, 'deletedAt')).toBe(true)
    expect(hasColumn(cols, 'revision')).toBe(true)

    const idxs = await getIndexes('ClinicalNote')
    expect(hasIndex(idxs, /patientId_idx/)).toBe(true)
    expect(hasIndex(idxs, /doctorId_idx/)).toBe(true)
    expect(hasIndex(idxs, /isPinned_idx/)).toBe(true)
    expect(hasIndex(idxs, /deletedAt_idx/)).toBe(true)
  })
})

describe('M2 Schema — Annotation', () => {
  it('should have deletedAt but no revision (not synchronizable)', async () => {
    const cols = await getColumns('Annotation')
    expect(hasColumn(cols, 'deletedAt')).toBe(true)
    expect(hasColumn(cols, 'revision')).toBe(false)
    expect(hasColumn(cols, 'originDeviceId')).toBe(false)
  })
})

describe('M2 Schema — AuditLog (immutability)', () => {
  it('should NOT have an updatedAt column (immutable)', async () => {
    const cols = await getColumns('AuditLog')
    expect(hasColumn(cols, 'updatedAt')).toBe(false)
    expect(hasColumn(cols, 'createdAt')).toBe(true)
  })

  it('should have actorId FK, action, entityType, entityId, details (JsonB), ipAddress, userAgent', async () => {
    const cols = await getColumns('AuditLog')
    expect(hasColumn(cols, 'actorId')).toBe(true)
    expect(hasColumn(cols, 'action')).toBe(true)
    expect(hasColumn(cols, 'entityType')).toBe(true)
    expect(hasColumn(cols, 'entityId')).toBe(true)
    expect(hasColumn(cols, 'details')).toBe(true)
    expect(hasColumn(cols, 'ipAddress')).toBe(true)
    expect(hasColumn(cols, 'userAgent')).toBe(true)

    const detailCol = cols.find((c) => c.column_name === 'details')
    expect(detailCol?.data_type).toBe('jsonb')
  })

  it('should have required indexes', async () => {
    const idxs = await getIndexes('AuditLog')
    expect(hasIndex(idxs, /actorId_idx/)).toBe(true)
    expect(hasIndex(idxs, /entityType_entityId_idx/)).toBe(true)
    expect(hasIndex(idxs, /createdAt_idx/)).toBe(true)
  })
})

describe('M2 Schema — DeviceRegistration', () => {
  it('should have userId FK, deviceName, deviceType, platform, appVersion, isActive', async () => {
    const cols = await getColumns('DeviceRegistration')
    expect(hasColumn(cols, 'userId')).toBe(true)
    expect(hasColumn(cols, 'deviceName')).toBe(true)
    expect(hasColumn(cols, 'deviceType')).toBe(true)
    expect(hasColumn(cols, 'platform')).toBe(true)
    expect(hasColumn(cols, 'appVersion')).toBe(true)
    expect(hasColumn(cols, 'isActive')).toBe(true)
    expect(hasColumn(cols, 'lastSyncedAt')).toBe(true)
    expect(hasColumn(cols, 'lastIp')).toBe(true)
  })

  it('should have userId and isActive indexes', async () => {
    const idxs = await getIndexes('DeviceRegistration')
    expect(hasIndex(idxs, /userId_idx/)).toBe(true)
    expect(hasIndex(idxs, /isActive_idx/)).toBe(true)
  })
})

describe('M2 Schema — SyncQueue', () => {
  it('should have entityType, entityId, operation, payload (JsonB), deviceId, status, attempts', async () => {
    const cols = await getColumns('SyncQueue')
    expect(hasColumn(cols, 'entityType')).toBe(true)
    expect(hasColumn(cols, 'entityId')).toBe(true)
    expect(hasColumn(cols, 'operation')).toBe(true)
    expect(hasColumn(cols, 'payload')).toBe(true)
    expect(hasColumn(cols, 'deviceId')).toBe(true)
    expect(hasColumn(cols, 'status')).toBe(true)
    expect(hasColumn(cols, 'attempts')).toBe(true)
    expect(hasColumn(cols, 'lastAttemptAt')).toBe(true)
    expect(hasColumn(cols, 'completedAt')).toBe(true)

    const payloadCol = cols.find((c) => c.column_name === 'payload')
    expect(payloadCol?.data_type).toBe('jsonb')
  })

  it('should have required indexes', async () => {
    const idxs = await getIndexes('SyncQueue')
    expect(hasIndex(idxs, /status_idx/)).toBe(true)
    expect(hasIndex(idxs, /deviceId_idx/)).toBe(true)
    expect(hasIndex(idxs, /entityType_entityId_idx/)).toBe(true)
  })

  it('deviceId should FK to DeviceRegistration (CASCADE)', async () => {
    const fks = await getForeignKeys('SyncQueue')
    const deviceFk = fks.find((f) => f.column_name === 'deviceId')
    expect(deviceFk).toBeDefined()
    expect(deviceFk!.references_table).toBe('DeviceRegistration')
    expect(deviceFk!.on_delete).toBe('CASCADE')
  })
})

describe('M2 Schema — BackupHistory', () => {
  it('should have triggeredBy FK, backupType, filePath, fileSize, checksum, status', async () => {
    const cols = await getColumns('BackupHistory')
    expect(hasColumn(cols, 'triggeredBy')).toBe(true)
    expect(hasColumn(cols, 'backupType')).toBe(true)
    expect(hasColumn(cols, 'filePath')).toBe(true)
    expect(hasColumn(cols, 'fileSize')).toBe(true)
    expect(hasColumn(cols, 'checksum')).toBe(true)
    expect(hasColumn(cols, 'status')).toBe(true)
    expect(hasColumn(cols, 'errorMessage')).toBe(true)
    expect(hasColumn(cols, 'completedAt')).toBe(true)
  })
})

describe('M2 Schema — LoginHistory', () => {
  it('should have userId FK, success, failureReason and required indexes', async () => {
    const cols = await getColumns('LoginHistory')
    expect(hasColumn(cols, 'userId')).toBe(true)
    expect(hasColumn(cols, 'success')).toBe(true)
    expect(hasColumn(cols, 'failureReason')).toBe(true)

    const idxs = await getIndexes('LoginHistory')
    expect(hasIndex(idxs, /userId_idx/)).toBe(true)
    expect(hasIndex(idxs, /createdAt_idx/)).toBe(true)
  })
})

describe('M2 Schema — Configuration', () => {
  it('should have key (unique), value (text), description, updatedAt', async () => {
    const cols = await getColumns('Configuration')
    expect(hasColumn(cols, 'key')).toBe(true)
    expect(hasColumn(cols, 'value')).toBe(true)
    expect(hasColumn(cols, 'description')).toBe(true)
    expect(hasColumn(cols, 'updatedAt')).toBe(true)
    // No createdAt — configs are upserted
    expect(hasColumn(cols, 'createdAt')).toBe(false)

    const uniqueIdxs = await getUniqueIndexes('Configuration')
    expect(uniqueIdxs.some((i) => extractColumnsFromIndexDef(i.indexdef).includes('key'))).toBe(true)
  })
})

describe('M2 Schema — Foreign key constraints work (end-to-end)', () => {
  let testUserId: string
  let testPatientId: string

  beforeAll(async () => {
    // Create a test user
    const user = await prisma.user.create({
      data: {
        email: `schema-fk-test-${Date.now()}@medivault.test`,
        password: 'hashed-pw',
        name: 'Schema FK Test User',
      },
    })
    testUserId = user.id

    // Create a test patient
    const patient = await prisma.patient.create({
      data: {
        doctorId: testUserId,
        firstName: 'FK',
        lastName: 'Test',
      },
    })
    testPatientId = patient.id
  })

  it('should enforce FK — inserting document with non-existent patientId should fail', async () => {
    await expect(
      prisma.document.create({
        data: {
          patientId: '00000000-0000-4000-8000-000000000000',
          fileName: 'test.pdf',
          filePath: '/tmp/test.pdf',
          fileSize: 100,
        },
      })
    ).rejects.toThrow()
  })

  it('should enforce FK — inserting visit with non-existent userId should fail', async () => {
    await expect(
      prisma.visit.create({
        data: {
          patientId: testPatientId,
          doctorId: '00000000-0000-4000-8000-000000000000',
          visitDate: new Date(),
          visitType: 'Checkup',
        },
      })
    ).rejects.toThrow()
  })

  it('should allow valid FK inserts', async () => {
    const visit = await prisma.visit.create({
      data: {
        patientId: testPatientId,
        doctorId: testUserId,
        visitDate: new Date(),
        visitType: 'Checkup',
      },
    })
    expect(visit.id).toBeDefined()

    await prisma.visit.delete({ where: { id: visit.id } })
  })

  // Cleanup
  afterAll(async () => {
    await prisma.document.deleteMany({ where: { patientId: testPatientId } })
    await prisma.patient.delete({ where: { id: testPatientId } })
    await prisma.user.delete({ where: { id: testUserId } })
  })
})

describe('M2 Schema — Unique constraints work', () => {
  it('should prevent duplicate User emails', async () => {
    const email = `unique-test-${Date.now()}@medivault.test`
    await prisma.user.create({
      data: { email, password: 'hash', name: 'Unique Test' },
    })
    await expect(
      prisma.user.create({
        data: { email, password: 'hash2', name: 'Duplicate' },
      })
    ).rejects.toThrow()
    await prisma.user.deleteMany({ where: { email } })
  })

  it('should prevent duplicate Role names', async () => {
    const name = `Role-${Date.now()}`
    await prisma.role.create({ data: { name } })
    await expect(
      prisma.role.create({ data: { name } })
    ).rejects.toThrow()
    await prisma.role.deleteMany({ where: { name } })
  })

  it('should prevent duplicate Permission names', async () => {
    const name = `Perm-${Date.now()}`
    await prisma.permission.create({ data: { name } })
    await expect(
      prisma.permission.create({ data: { name } })
    ).rejects.toThrow()
    await prisma.permission.deleteMany({ where: { name } })
  })

  it('should prevent duplicate Configuration keys', async () => {
    const key = `cfg-${Date.now()}`
    await prisma.configuration.create({ data: { key, value: 'v1' } })
    await expect(
      prisma.configuration.create({ data: { key, value: 'v2' } })
    ).rejects.toThrow()
    await prisma.configuration.deleteMany({ where: { key } })
  })

  it('should prevent duplicate RolePermission [roleId, permissionId]', async () => {
    const role = await prisma.role.create({ data: { name: `RP-Role-${Date.now()}` } })
    const perm = await prisma.permission.create({ data: { name: `RP-Perm-${Date.now()}` } })
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: perm.id },
    })
    await expect(
      prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: perm.id },
      })
    ).rejects.toThrow()
    // Cleanup
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } })
    await prisma.role.delete({ where: { id: role.id } })
    await prisma.permission.delete({ where: { id: perm.id } })
  })
})
