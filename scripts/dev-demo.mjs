#!/usr/bin/env node
// `npm run dev:demo`: runs `next dev` with NUVA_DEMO=1, so the console serves
// generated sample calls (see src/lib/demo.ts). No Retell needed. Extra args pass through, e.g. `npm run dev:demo -- --port 3100`.

import { spawn } from 'node:child_process';

// A single command string (not an args array) keeps Node from warning about
// unescaped args under `shell: true`; args are simple flags like --port.
const child = spawn(['next', 'dev', ...process.argv.slice(2)].join(' '), {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NUVA_DEMO: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
