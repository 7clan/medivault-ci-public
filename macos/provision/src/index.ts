/**
 * mediavault provisioner CLI (Node 22, zero runtime deps).
 *
 * Usage:
 *   node dist/index.js classify --config <supervisor-config.json>
 *   node dist/index.js provision --config <supervisor-config.json>
 *
 * Exit codes:
 *   0  success
 *   2  usage error
 *   4  config missing/invalid
 *   5  INCOMPLETE_EXISTING (fail closed; nothing altered)
 *   6  VALID_EXISTING verification failure (credentials inconsistent)
 *   7  provisioning step failure (initdb/psql/migrations)
 *   8  missing required secret environment variable
 */
import { cmdClassify, cmdProvision } from './provision.js';
import { EXIT_USAGE } from './types.js';

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const configIdx = args.indexOf('--config');
  if (configIdx === -1 || !args[configIdx + 1]) {
    console.error('usage: index.js <classify|provision> --config <supervisor-config.json>');
    process.exit(EXIT_USAGE);
  }
  const configPath = args[configIdx + 1] as string;

  switch (cmd) {
    case 'classify':
      process.exit(cmdClassify(configPath));
    case 'provision':
      process.exit(cmdProvision(configPath));
    default:
      console.error(`unknown subcommand: ${String(cmd)} (expected classify|provision)`);
      process.exit(EXIT_USAGE);
  }
}

main();
