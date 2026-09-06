/**
 * Legacy schema smoke tests — updated for M2 schema.
 * These tests verify basic connectivity and that the core models exist.
 * Comprehensive schema validation is in m2-schema.test.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { db } from '@/lib/db'

describe('Database connectivity', () => {
  beforeAll(async () => {
    await db.$connect()
  })

  it('should connect to PostgreSQL successfully', async () => {
    const result = await db.$queryRaw<Array<{ now: Date }>>`
      SELECT now() as now
    `
    expect(result).toHaveLength(1)
    expect(result[0].now).toBeInstanceOf(Date)
  })
})

describe('Core models exist (M2)', () => {
  const coreModels = [
    'User', 'Patient', 'Document', 'DocumentVersion',
    'Visit', 'Prescription', 'ClinicalNote', 'Annotation',
  ]

  for (const model of coreModels) {
    it(`should have ${model} table`, async () => {
      const cols = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='${model}'
         ORDER BY column_name`
      )
      expect(cols.length).toBeGreaterThan(0)
    })
  }

  it('User table should have email and password', async () => {
    const cols = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='User'
       ORDER BY column_name`
    )
    const names = cols.map((c) => c.column_name)
    expect(names).toContain('email')
    expect(names).toContain('password')
    expect(names).toContain('name')
  })

  it('Patient table should have doctorId FK', async () => {
    const cols = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='Patient'
       ORDER BY column_name`
    )
    const names = cols.map((c) => c.column_name)
    expect(names).toContain('doctorId')
    expect(names).toContain('firstName')
    expect(names).toContain('lastName')
  })

  it('Document table should have mimeType (not fileType)', async () => {
    const cols = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='Document'
       ORDER BY column_name`
    )
    const names = cols.map((c) => c.column_name)
    expect(names).toContain('mimeType')
    expect(names).not.toContain('fileType')
  })

  it('should have expected indexes on Patient', async () => {
    const indexes = await db.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname='public' AND tablename='Patient'
       ORDER BY indexname`
    )
    const indexNames = indexes.map((i) => i.indexname)
    expect(indexNames.length).toBeGreaterThanOrEqual(5)
  })
})
