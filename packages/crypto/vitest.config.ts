import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@medivault/crypto': path.resolve(__dirname, './src'),
    },
  },
})
