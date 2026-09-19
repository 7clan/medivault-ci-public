/**
 * DATAIO_IMPORT_NO_DEDUPE — API-integration coverage for the CSV import
 * duplicate contract (POST /api/patients/import).
 *
 * In-process harness mirroring tests/api-route-integration.test.ts: the REAL
 * Fastify app (error-handler / cookie / CORS / multipart / auth plugins +
 * registerRoutes) is exercised through app.inject() — no real HTTP
 * connections. There is NO reachable PostgreSQL in this sandbox, so the
 * api-service Prisma db module is replaced by an in-memory double via
 * vi.mock: the JWT auth hook, requirePermission('patient:create') through
 * getUserPermissions, the CSRF Origin/cookie/header gauntlet, multipart
 * parsing, CSV parsing, and the dedupe logic all run the REAL shipped code;
 * only persistence is faked.
 *
 * Contract under test (conservative — no fuzzy identity, no merging, skips
 * always reported):
 *   (a) within-file exact duplicates are skipped and counted;
 *   (b) re-importing the same file is idempotent (exact-identity match
 *       against the doctor's existing patients — never a merge);
 *   (c) a single differing field (different DOB) disambiguates — both rows
 *       are created;
 *   (d) present-on-one-side / missing-on-the-other is NOT a match — a row
 *       equal to an existing patient except phone (empty in file, set on
 *       record) is CREATED.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import crypto from 'node:crypto'

// ─── In-memory db double ─────────────────────────────
// The vi.mock factory must be self-contained (it is hoisted above every
// module-scope binding), so the whole test state lives inside the mocked
// module and is read back through __importDedupeTestState below.

interface MockPatient {
  id: string
  doctorId: string
  firstName: string
  lastName: string
  dateOfBirth: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  createdAt: Date
  deletedAt: Date | null
}

interface FindManyArgs {
  where?: { doctorId?: string }
  select?: Record<string, boolean>
}

interface CreateArgs {
  data: Record<string, unknown>
}

interface ImportDedupeTestState {
  doctorId: string
  /** Patients that "already exist" for the doctor (never created via the route). */
  existing: MockPatient[]
  /** Patients the route created (asserted, in order). */
  created: MockPatient[]
  findManyCalls: FindManyArgs[]
  createCalls: CreateArgs[]
}

vi.mock('../mini-services/api-service/src/lib/db.js', () => {
  const doctorId = 'import-dedupe-doctor-1'
  const user = {
    id: doctorId,
    email: 'doctor@example.com',
    name: 'Dr Import Dedupe',
    isActive: true,
    mustChangePassword: false,
    sessionVersion: 0,
    role: {
      id: 'role-doctor-1',
      rolePermissions: [
        { permission: { name: 'patient:view' } },
        { permission: { name: 'patient:create' } },
      ],
    },
  }

  const state: ImportDedupeTestState = {
    doctorId,
    existing: [],
    created: [],
    findManyCalls: [],
    createCalls: [],
  }

  const db = {
    patient: {
      findMany: async (args: FindManyArgs): Promise<MockPatient[]> => {
        state.findManyCalls.push(args)
        const wanted = args?.where?.doctorId
        return [...state.existing, ...state.created].filter((p) => !wanted || p.doctorId === wanted)
      },
      create: async (args: CreateArgs): Promise<MockPatient> => {
        state.createCalls.push(args)
        const data = args.data as Omit<MockPatient, 'id' | 'createdAt' | 'deletedAt'>
        const record: MockPatient = {
          ...data,
          id: `created-${state.created.length + 1}`,
          createdAt: new Date(),
          deletedAt: null,
        }
        state.created.push(record)
        return record
      },
    },
    user: {
      findUnique: async (args: { where?: { id?: string } }) =>
        args?.where?.id === doctorId ? user : null,
    },
  }

  return { db, disconnectDb: async () => {}, __importDedupeTestState: state }
})

// ─── Fastify plugins & routes (real shipped code) ─────
import { errorHandlerPlugin } from '../mini-services/api-service/src/plugins/error-handler.js'
import { corsPlugin } from '../mini-services/api-service/src/plugins/cors.js'
import { multipartPlugin } from '../mini-services/api-service/src/plugins/multipart.js'
import { fastifyAuthPlugin } from '../mini-services/api-service/src/plugins/auth.js'
import { registerRoutes } from '../mini-services/api-service/src/routes/index.js'
import { generateAccessToken, generateCsrfToken } from '@medivault/auth'
import * as dbModule from '../mini-services/api-service/src/lib/db.js'

// ─── Environment ──────────────────────────────────────
Object.assign(process.env, { NODE_ENV: 'test' })
process.env.AUTH_JWT_SECRET =
  'c282f12b700adbb6745aedb01641cdf35b80b90ad940e74f4781283b064118ac'
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://medivault:placeholder@localhost:5432/medivault'
process.env.MEDIVAULT_MASTER_KEY = 'a'.repeat(64)

// ─── Constants & shared state ─────────────────────────
const ALLOWED_ORIGIN = 'http://localhost:3000'
const CSV_HEADER = 'firstName,lastName,dateOfBirth,phone,email,address,notes'
const testState = (dbModule as unknown as { __importDedupeTestState: ImportDedupeTestState })
  .__importDedupeTestState

interface ImportResponse {
  success?: boolean
  imported?: number
  skipped?: number
  duplicatesInFile?: number
  duplicatesExisting?: number
  errors?: string[]
  totalErrors?: number
  error?: string
}

let app: FastifyInstance
let doctorToken: string
let csrfToken: string

// ─── Setup / teardown ─────────────────────────────────

beforeAll(async () => {
  app = Fastify({
    logger: false,
    trustProxy: '127.0.0.1',
    genReqId: () => crypto.randomUUID(),
    routerOptions: { ignoreTrailingSlash: false, maxParamLength: 100 },
  })

  await app.register(errorHandlerPlugin)
  await app.register(cookie)
  await app.register(corsPlugin)
  await app.register(multipartPlugin)
  await app.register(fastifyAuthPlugin)
  await registerRoutes(app as unknown as FastifyInstance)

  csrfToken = generateCsrfToken()
  doctorToken = await generateAccessToken(
    {
      sub: testState.doctorId,
      email: 'doctor@example.com',
      name: 'Dr Import Dedupe',
      roleId: 'role-doctor-1',
      isActive: true,
      sessionVersion: 0,
    },
    process.env.AUTH_JWT_SECRET!,
  )
})

afterAll(async () => {
  await app.close()
})

// ─── Helpers ──────────────────────────────────────────

/** POST a CSV file to /api/patients/import through app.inject (Bearer + CSRF gauntlet). */
async function importCsv(csv: string): Promise<{ status: number; body: ImportResponse }> {
  const boundary = `----importdedupe-${crypto.randomUUID()}`
  const content = Buffer.from(csv, 'utf-8')
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="patients.csv"\r\n' +
        'Content-Type: text/csv\r\n' +
        '\r\n',
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const res = await app.inject({
    method: 'POST',
    url: '/api/patients/import',
    headers: {
      Authorization: `Bearer ${doctorToken}`,
      Origin: ALLOWED_ORIGIN,
      Cookie: `mvlt_csrf=${csrfToken}`,
      'x-csrf-token': csrfToken,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  })
  return { status: res.statusCode, body: res.json() as ImportResponse }
}

// ─── Scenarios ────────────────────────────────────────

describe('(a) within-file exact duplicates', () => {
  it('same row twice + one distinct row => imported=2, duplicatesInFile=1, exactly 2 patients created, error names the dup row', async () => {
    const findManyBefore = testState.findManyCalls.length
    const csv = [
      CSV_HEADER,
      'John,Smith,1990-01-01,555-0100,john@example.com,1 Main St,',
      'John,Smith,1990-01-01,555-0100,john@example.com,1 Main St,',
      'Jane,Doe,1985-05-05,555-0200,jane@example.com,2 Oak St,',
    ].join('\n')

    const { status, body } = await importCsv(csv)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.imported).toBe(2)
    expect(body.duplicatesInFile).toBe(1)
    expect(body.duplicatesExisting).toBe(0)
    expect(body.skipped).toBe(1)
    expect(body.totalErrors).toBe(1)
    expect(body.errors).toContain('Row 3: exact duplicate of row 2 in this file — skipped')

    // one patient per unique tuple — the in-file duplicate created nothing
    expect(testState.createCalls).toHaveLength(2)
    expect(
      testState.created.map((p) => `${p.firstName} ${p.lastName} (${p.dateOfBirth})`),
    ).toEqual(['John Smith (1990-01-01)', 'Jane Doe (1985-05-05)'])

    // owner binding: every created patient belongs to the importing doctor
    for (const call of testState.createCalls) {
      expect(call.data.doctorId).toBe(testState.doctorId)
    }

    // the doctor's patients were loaded ONCE for this import
    expect(testState.findManyCalls.length).toBe(findManyBefore + 1)
    expect(testState.findManyCalls.at(-1)?.where?.doctorId).toBe(testState.doctorId)
  })
})

describe('(b) re-import idempotence (dedupe against existing patients)', () => {
  it('the same file again => imported=0, duplicatesExisting=2, still only 2 patients', async () => {
    const csv = [
      CSV_HEADER,
      'John,Smith,1990-01-01,555-0100,john@example.com,1 Main St,',
      'John,Smith,1990-01-01,555-0100,john@example.com,1 Main St,',
      'Jane,Doe,1985-05-05,555-0200,jane@example.com,2 Oak St,',
    ].join('\n')

    const { status, body } = await importCsv(csv)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.imported).toBe(0)
    expect(body.duplicatesExisting).toBe(2)
    expect(body.skipped).toBe(3)
    expect(body.errors).toContain('Row 2: identical to existing patient "John Smith" — skipped as duplicate')
    expect(body.errors).toContain('Row 4: identical to existing patient "Jane Doe" — skipped as duplicate')

    // The repeated row 3 stays attributed to the file (it points back at its
    // first occurrence, which was itself skipped as an existing duplicate) —
    // each unique identity is evaluated against the existing roster exactly once.
    expect(body.duplicatesInFile).toBe(1)
    expect(body.errors).toContain('Row 3: exact duplicate of row 2 in this file — skipped')

    // nothing new created — the roster is unchanged (idempotent re-import)
    expect(testState.createCalls).toHaveLength(2)
    expect(testState.created.filter((p) => p.doctorId === testState.doctorId)).toHaveLength(2)
  })
})

describe('(c) a single differing field disambiguates', () => {
  it('same NAME with a different DOB is NOT a duplicate — both patients are created', async () => {
    const csv = [CSV_HEADER, 'John,Smith,1991-02-02,555-0100,john@example.com,1 Main St,'].join('\n')

    const { status, body } = await importCsv(csv)

    expect(status).toBe(200)
    expect(body.imported).toBe(1)
    expect(body.duplicatesExisting).toBe(0)
    expect(body.duplicatesInFile).toBe(0)
    expect(body.errors).toEqual([])

    // both Johns exist — the DOB disambiguated them (no skip, no merge)
    expect(testState.createCalls).toHaveLength(3)
    expect(testState.created[2]?.dateOfBirth).toBe('1991-02-02')
    const dobs = testState.created
      .filter((p) => p.firstName === 'John')
      .map((p) => p.dateOfBirth)
      .sort()
    expect(dobs).toEqual(['1990-01-01', '1991-02-02'])
  })
})

describe('(d) present-on-one-side / missing-on-the-other is NOT a match', () => {
  it('a row equal to an existing patient except phone (empty in file, set on record) is CREATED', async () => {
    // Seed an existing patient that was NOT created through the route
    testState.existing.push({
      id: 'existing-alex-1',
      doctorId: testState.doctorId,
      firstName: 'Alex',
      lastName: 'Brown',
      dateOfBirth: '1980-03-03',
      phone: '+1-555-0300',
      email: 'alex@example.com',
      address: '3 Pine St',
      notes: null,
      createdAt: new Date(),
      deletedAt: null,
    })
    const csv = [CSV_HEADER, 'Alex,Brown,1980-03-03,,alex@example.com,3 Pine St,'].join('\n')

    const { status, body } = await importCsv(csv)

    expect(status).toBe(200)
    expect(body.imported).toBe(1)
    expect(body.duplicatesExisting).toBe(0)
    expect(body.errors).toEqual([])
    expect(testState.createCalls).toHaveLength(4)
    expect(testState.created[3]?.phone).toBeNull() // empty cell stored as missing, per the import contract
  })
})
