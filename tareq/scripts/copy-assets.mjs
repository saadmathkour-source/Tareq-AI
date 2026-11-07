import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// tsc emits only .ts -> .js, so static assets the server reads at runtime must
// be copied alongside the compiled output.
const files = [['src/app/dashboard.html', 'dist/src/app/dashboard.html']];
for (const [from, to] of files) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  console.log(`copied ${from} -> ${to}`);
}
