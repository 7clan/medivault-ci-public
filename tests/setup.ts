/**
 * Vitest global setup
 * Ensures DATABASE_URL is available for integration tests.
 * Tests that touch the database will use the live PostgreSQL instance.
 */
import { beforeAll, afterAll } from 'vitest'

beforeAll(() => {
  // Use TEST_DATABASE_URL from env; never hardcode credentials in source.
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://medivault:placeholder@localhost:5432/medivault'
  }
})

afterAll(() => {
  // Cleanup if needed
})
