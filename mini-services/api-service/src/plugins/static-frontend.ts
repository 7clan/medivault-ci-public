/**
 * MediVault Fastify — Static Frontend Plugin (desktop-local serving)
 *
 * Fixes the D2 finding of acceptance/FIRST-RUN-ROOT-CAUSE.md: the shipped
 * web frontend used relative `/api/*` fetches that cannot reach the
 * loopback API from the Tauri custom-protocol origin. When the desktop
 * supervisor sets `MEDIVAULT_STATIC_DIR` (the app bundle's copy of the
 * static export, `Contents/Resources/frontend`), the API serves that
 * export at its own origin (`http://127.0.0.1:3001/`). The desktop
 * webview navigates there once healthy — every existing relative `/api`
 * call becomes same-origin, so the cookie/session/CSRF model works
 * unmodified.
 *
 * Behavior:
 *  - Only active when `MEDIVAULT_STATIC_DIR` is set AND exists (dev and
 *    non-desktop deployments are byte-identical to before: plugin no-ops).
 *  - `/api/*` unknown routes keep returning JSON 404 (never index.html).
 *  - Unknown GET paths fall back to index.html (SPA shape; the app is a
 *    single-view store, the URL stays `/`).
 *  - Serves a Content-Security-Policy mirroring the Tauri shell's CSP.
 *  - index.html is served `Cache-Control: no-cache`; hashed assets use
 *    the plugin default.
 *
 * The frontend is static, public-by-content (identical to the embedded
 * Tauri assets) — all sensitive data stays behind the authenticated
 * `/api/*` routes. This adds no new authenticated surface.
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Mirrors src-tauri/tauri.conf.json app.security.csp. */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; connect-src 'self' http://localhost:* http://127.0.0.1:* https://*; " +
  "font-src 'self' data:; object-src 'none'"

const STATIC_DIR_ENV = 'MEDIVAULT_STATIC_DIR'

export const staticFrontendPlugin: FastifyPluginAsync = async (fastify) => {
  const dir = process.env[STATIC_DIR_ENV]
  if (!dir) return
  const root = resolve(dir)
  if (!existsSync(root)) {
    throw new Error(
      `[MediVault] FATAL: ${STATIC_DIR_ENV} is set but the directory does not exist: ${root}`,
    )
  }

  await fastify.register(fastifyStatic, {
    root,
    prefix: '/',
    index: 'index.html',
    // Non-file GETs fall through to the not-found handler below.
    wildcard: false,
    // VERSION CONTRACT (PFT run 34692245479 first-red): @fastify/static v8
    // invokes setHeaders with the RAW http.ServerResponse (`.setHeader`),
    // v10+ with the FastifyReply (`.header`) — the api-service package
    // range resolved v8 on the staged prod tree while the dev/test tree
    // ran v10, so `reply.header` threw `TypeError: reply.header is not a
    // function` and GET / answered 500 `{"error":"Internal server error"}`
    // (the hand-off screen). Support BOTH shapes; a drift guard test pins
    // the dev/prod version alignment.
    setHeaders(res, pathname) {
      if (typeof pathname === 'string' && pathname.endsWith('.html')) {
        const noCache = 'no-cache'
        if (typeof (res as { setHeader?: unknown }).setHeader === 'function') {
          // @fastify/static v8 shape: the raw Node response.
          ;(
            res as unknown as import('node:http').ServerResponse
          ).setHeader('Cache-Control', noCache)
        } else {
          // @fastify/static v10+ shape: the FastifyReply.
          ;(res as unknown as FastifyReply).header('Cache-Control', noCache)
        }
      }
    },
  })

  // CSP on every served HTML document (the Tauri shell injects the same
  // policy into its embedded copy; the API-served copy must match).
  fastify.addHook('onSend', async (_request, reply, payload) => {
    const contentType = reply.getHeader('content-type')
    if (
      typeof contentType === 'string' &&
      contentType.includes('text/html')
    ) {
      reply.header('Content-Security-Policy', CSP)
    }
    return payload
  })

  // SPA fallback: unknown GETs → index.html. Unknown /api/* stays JSON 404.
  fastify.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.status(200).sendFile('index.html')
    }
    return reply.status(404).send({ error: 'Not found' })
  })

  fastify.log.info(
    { staticDir: root },
    'MediVault API serving the desktop frontend at its own origin',
  )
}

export default fp(staticFrontendPlugin, {
  name: 'medivault-static-frontend',
})
