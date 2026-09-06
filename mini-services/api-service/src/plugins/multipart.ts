/**
 * MediVault Fastify — Multipart Upload Handling
 *
 * Configures @fastify/multipart for file upload support.
 * - Max file size: 500MB
 * - Max files per request: 50
 * - Temp directory from MEDIVAULT_UPLOAD_TEMP_DIR or OS default
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import path from 'node:path'
import os from 'node:os'

export const multipartPlugin: FastifyPluginAsync = async (fastify) => {
  const tempDir = process.env.MEDIVAULT_UPLOAD_TEMP_DIR || path.join(os.tmpdir(), 'medivault-uploads')

  await fastify.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB
      files: 50,
    },
    attachFieldsToBody: false,
  })

  // Store temp dir for use by routes
  fastify.decorate('uploadTempDir', tempDir)
}

export default fp(multipartPlugin, {
  name: 'medivault-multipart',
})
