import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'packages/crypto/tests/**/*.test.ts', 'windows/tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 10_000,
    env: {
      // Vitest loads Prisma at import time; DATABASE_URL must be available before setupFiles run.
      // TEST_DATABASE_URL takes priority; if absent, falls back to DATABASE_URL;
      // if both are absent, uses a CI-safe placeholder that will fail on real DB ops.
      DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://medivault:placeholder@localhost:5432/medivault',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@medivault/auth': path.resolve(__dirname, './packages/auth/src/index.ts'),
      '@medivault/crypto': path.resolve(__dirname, './packages/crypto/src/index.ts'),
      '@medivault/db': path.resolve(__dirname, './packages/db/src/client.ts'),
    },
  },
})
