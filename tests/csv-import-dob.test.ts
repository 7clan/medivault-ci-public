/**
 * DATAIO_IMPORT_BAD_DOB — API-integration coverage for the CSV import route
 * (POST /api/patients/import): invalid/impossible dates of birth must NOT
 * silently become accepted patient records.
 *
 * Harness: the repo's in-process Fastify pattern (app.inject() with the REAL
 * plugins — error-handler, cookie, CORS, multipart, auth — and the REAL route
 * code, mirroring tests/api-route-integration.test.ts's createTestApp), with
 * one deviation: this sandbox has NO reachable PostgreSQL (the CI suite's
 * DB-backed tests like tests/db-schema.test.ts fail here with connection
 * refused), so the Prisma `db` module of the api-service is replaced by an
 * in-memory double via vi.mock. Everything else — JWT auth, permission
 * checks, CSRF, multipart parsing, the CSV parser, and the DOB validation
 * under test — runs the REAL shipped code.
 *
 * The contract under test:
 *   - a row with a VALID DOB is created (imported count reflects it),
 *   - every row with an invalid/impossible DOB is skipped with a clear
 *     per-row error and NO patient record is created for it,
 *   - a legitimate historical DOB (1920-02-29 — a real leap year) imports and
 *     round-trips verbatim,
 *   - an empty DOB cell stays null (DOB is optional — unchanged behavior).
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import crypto from 'node:crypto'

// ─── The in-memory db double (hoisted so vi.mock can use it before imports) ───
type PatientRecord = Record<string, unknown> & { dateOfBirth: string | null }

const harness = vi.hoisted(() => {
  const patients: PatientRecord[] = []
  const createCalls: Array<{ data: Record<string, unknown> }> = []
  const TEST_USER_ID = '00000000-0000-4000-8000-0000000000ee'
  const TEST_ROLE_ID = '00000000-0000-4000-8000-0000000000ff'

  const db = {
    patient: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createCalls.push({ data: { ...data } })
        const record: PatientRecord = {
          id: crypto.randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          ...(data as PatientRecord),
        }
        patients.push(record)
        return record
      },
      findMany: async () => [...patients],
    },
    user: {
      // Two call shapes hit this double:
      //  1. the auth plugin's onRequest hook — `select` shape
      //     { id, isActive, mustChangePassword, sessionVersion }
      //  2. getUserPermissions (requirePermission) — `include` shape with
      //     role -> rolePermissions -> permission
      findUnique: async ({ where, include }: { where?: { id?: string }; include?: unknown }) => {
        if (where?.id !== TEST_USER_ID) return null
        if (include) {
          return {
            id: TEST_USER_ID,
            email: 'dob-test@example.com',
            name: 'DOB Test Doctor',
            isActive: true,
            mustChangePassword: false,
            sessionVersion: 0,
            role: {
              id: TEST_ROLE_ID,
              name: 'Admin',
              rolePermissions: [
                { permission: { name: 'patient:view' } },
                { permission: { name: 'patient:create' } },
              ],
            },
          }
        }
        return { id: TEST_USER_ID, isActive: true, mustChangePassword: false, sessionVersion: 0 }
      },
    },
  }

  return { patients, createCalls, db, TEST_USER_ID, TEST_ROLE_ID }
})

vi.mock('../mini-services/api-service/src/lib/db.js', () => ({
  db: harness.db,
  disconnectDb: async () => {},
}))

// ─── Fastify plugins & routes (real, the api-route-integration harness) ───
import { errorHandlerPlugin } from '../mini-services/api-service/src/plugins/error-handler.js'
import { corsPlugin } from '../mini-services/api-service/src/plugins/cors.js'
import { multipartPlugin } from '../mini-services/api-service/src/plugins/multipart.js'
import { fastifyAuthPlugin } from '../mini-services/api-service/src/plugins/auth.js'
import { registerRoutes } from '../mini-services/api-service/src/routes/index.js'
import { generateAccessToken, generateCsrfToken } from '@medivault/auth'

// ─── Environment (before anything reads it at request time) ───
Object.assign(process.env, { NODE_ENV: 'test' })
process.env.AUTH_JWT_SECRET =
  'c282f12b700adbb6745aedb01641cdf35b80b90ad940e74f4781283b064118ac'
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://medivault:placeholder@localhost:5432/medivault'
process.env.MEDIVAULT_MASTER_KEY = 'a'.repeat(64)

const ALLOWED_ORIGIN = 'http://localhost:3000'
const BOUNDARY = 'MediVaultDobCsvBoundary'

// ─── Shared state ─────────────────────────────────────
let app: FastifyInstance
let accessToken: string
let csrfToken: string

// ─── Helpers ───────────────────────────────────────────

/** A date safely in the future for the whole test run (today + 1 year, UTC). */
function futureDobUtc(): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

/** Build a multipart/form-data payload carrying the CSV as the `file` field. */
function buildMultipartCsv(csv: string): Buffer {
  const header =
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="patients.csv"\r\n` +
    `Content-Type: text/csv\r\n` +
    `\r\n`
  const footer = `\r\n--${BOUNDARY}--\r\n`
  return Buffer.concat([Buffer.from(header), Buffer.from(csv, 'utf-8'), Buffer.from(footer)])
}

/** POST the CSV to the real import route (Bearer + CSRF, like the dialog). */
async function importCsv(csv: string): Promise<{ statusCode: number; body: any }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/patients/import',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Origin: ALLOWED_ORIGIN,
      Cookie: `mvlt_csrf=${csrfToken}`,
      'x-csrf-token': csrfToken,
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
    },
    payload: buildMultipartCsv(csv),
  })
  return { statusCode: res.statusCode, body: res.json() }
}

// ─── Setup / teardown ─────────────────────────────────

beforeAll(async () => {
  const instance = Fastify({
    logger: false,
    trustProxy: '127.0.0.1',
    genReqId: () => crypto.randomUUID(),
    routerOptions: { ignoreTrailingSlash: false, maxParamLength: 100 },
  })

  await instance.register(errorHandlerPlugin)
  await instance.register(cookie)
  await instance.register(corsPlugin)
  await instance.register(multipartPlugin)
  await instance.register(fastifyAuthPlugin)
  await registerRoutes(instance as unknown as FastifyInstance)

  app = instance

  const secret = process.env.AUTH_JWT_SECRET!
  csrfToken = generateCsrfToken()
  accessToken = await generateAccessToken(
    {
      sub: harness.TEST_USER_ID,
      email: 'dob-test@example.com',
      name: 'DOB Test Doctor',
      roleId: harness.TEST_ROLE_ID,
      isActive: true,
      sessionVersion: 0,
    },
    secret,
  )
})

beforeEach(() => {
  harness.patients.length = 0
  harness.createCalls.length = 0
})

afterAll(async () => {
  await app.close()
})

// ─── Tests ─────────────────────────────────────────────

describe('DATAIO_IMPORT_BAD_DOB — POST /api/patients/import (in-process API)', () => {
  it('rejects invalid/impossible DOBs without creating patients; valid rows (incl. the 1920-02-29 historical leap DOB) import', async () => {
    const future = futureDobUtc()
    const csv = [
      'firstName,lastName,dateOfBirth,phone,email,address,notes',
      'Valid,Normal,1985-03-25,555-0101,valid@example.com,,row one',
      'Historical,Leap,1920-02-29,555-0102,leap@example.com,,row two',
      'No,Dob,,,,row three',
      'Bad,Century,1900-02-29,555-0104,bad1@example.com,,row four',
      'Bad,Feb,2023-02-30,555-0105,bad2@example.com,,row five',
      'Bad,Impossible,1990-13-45,555-0106,bad3@example.com,,row six',
      `Bad,Future,${future},555-0107,bad4@example.com,,row seven`,
    ].join('\n')

    const { statusCode, body } = await importCsv(csv)
    expect(statusCode).toBe(200)
    expect(body.success).toBe(true)

    // The 3 valid rows (1985-03-25, 1920-02-29, empty->null) were created.
    expect(body.imported).toBe(3)
    // Every invalid row was skipped and reported.
    expect(body.skipped).toBe(4)
    expect(body.totalErrors).toBe(4)
    expect(body.errors).toHaveLength(4)

    // Each invalid DOB is named in the errors with the clear guidance.
    for (const bad of ['1900-02-29', '2023-02-30', '1990-13-45', future]) {
      const msg = body.errors.find((e: string) => e.includes(`"${bad}"`))
      expect(msg).toBeDefined()
      expect(msg).toMatch(/^Row \d+: Invalid date of birth /)
      expect(msg).toContain(
        'expected a real calendar date in YYYY-MM-DD format, year 1900 or later, not in the future',
      )
    }

    // The per-row messages carry the CSV row number (header = row 1).
    expect(body.errors).toContain(
      `Row 5: Invalid date of birth "1900-02-29" — expected a real calendar date in YYYY-MM-DD format, year 1900 or later, not in the future`,
    )

    // NO patient was created with any of the invalid DOBs.
    const storedDobs = harness.patients.map((p) => p.dateOfBirth)
    expect(storedDobs).not.toContain('1900-02-29')
    expect(storedDobs).not.toContain('2023-02-30')
    expect(storedDobs).not.toContain('1990-13-45')
    expect(storedDobs).not.toContain(future)
    expect(harness.patients).toHaveLength(3)
    expect(harness.createCalls).toHaveLength(3)

    // The valid rows round-trip: exact DOB strings persisted verbatim.
    expect(storedDobs).toContain('1985-03-25')
    expect(storedDobs).toContain('1920-02-29') // the historical leap-year DOB survives import
    expect(storedDobs).toContain(null) // empty DOB cell stays null (allowed)

    const leap = harness.patients.find((p) => p.dateOfBirth === '1920-02-29')!
    expect(leap.firstName).toBe('Historical')
    expect(leap.lastName).toBe('Leap')
    expect(leap.doctorId).toBe(harness.TEST_USER_ID) // owner binding preserved

    const noDob = harness.patients.find((p) => p.dateOfBirth === null)!
    expect(noDob.firstName).toBe('No')
  })

  it('a loose-format DOB ("1990-1-5") is rejected too — strict YYYY-MM-DD only', async () => {
    const csv = [
      'firstName,lastName,dateOfBirth',
      'Loose,Format,1990-1-5',
      'Slash,Format,1990/01/05',
      'Euro,Order,05-06-1990',
    ].join('\n')

    const { statusCode, body } = await importCsv(csv)
    expect(statusCode).toBe(200)
    expect(body.imported).toBe(0)
    expect(body.skipped).toBe(3)
    expect(body.totalErrors).toBe(3)
    expect(harness.patients).toHaveLength(0) // nothing silently created

    for (const bad of ['1990-1-5', '1990/01/05', '05-06-1990']) {
      const msg = body.errors.find((e: string) => e.includes(`"${bad}"`))
      expect(msg).toBeDefined()
    }
  })

  it('all-valid CSV imports cleanly with no errors (the happy path is unchanged)', async () => {
    const csv = [
      'firstName,lastName,dateOfBirth,phone,email,address,notes',
      'Happy,Path,2000-02-29,555-0111,happy@example.com,,leap century ok',
      'Plain,Date,1900-01-01,555-0112,plain@example.com,,minimum supported date',
    ].join('\n')

    const { statusCode, body } = await importCsv(csv)
    expect(statusCode).toBe(200)
    expect(body.success).toBe(true)
    expect(body.imported).toBe(2)
    expect(body.skipped).toBe(0)
    expect(body.errors).toEqual([])
    expect(body.totalErrors).toBe(0)
    expect(harness.patients.map((p) => p.dateOfBirth).sort()).toEqual(['1900-01-01', '2000-02-29'])
  })
})
