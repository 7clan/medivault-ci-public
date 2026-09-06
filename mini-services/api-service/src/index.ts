/**
 * MediVault API — Entry Point
 *
 * Re-exports the main server module.
 * The Windows service wrapper loads this file as the API entrypoint.
 * The server auto-starts when this module is imported.
 */

export { server } from './server.js'
