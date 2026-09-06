import { existsSync, cpSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const copies = [
  {
    src: resolve(projectRoot, '.next/static'),
    dest: resolve(projectRoot, '.next/standalone/.next/static'),
    label: '.next/static',
  },
  {
    src: resolve(projectRoot, 'public'),
    dest: resolve(projectRoot, '.next/standalone/public'),
    label: 'public',
  },
];

let failed = false;

for (const { src, dest, label } of copies) {
  if (!existsSync(src)) {
    console.error(`Error: Required source path missing: ${src}`);
    process.exitCode = 1;
    failed = true;
    continue;
  }

  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${label} -> ${dest}`);
}

if (failed) {
  console.error('Aborting: one or more required source paths are missing.');
  process.exit(1);
}
