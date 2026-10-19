import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Standalone toolchain installed by npm run setup:tools.
const candidates = [
  new URL('../.local/toolchain/node_modules/typescript/lib/tsc.js', import.meta.url),
];
const compiler = candidates.find(p => existsSync(p));
if (!compiler) {
  console.error('TypeScript compiler missing. Install only inside hidden .local/:');
  console.error('npm install --prefix .local/toolchain --cache .local/npm-cache --ignore-scripts --no-audit --no-fund --save-dev --save-exact typescript@6.0.3');
  process.exit(1);
}
const version = JSON.parse(readFileSync(new URL('../package.json', compiler), 'utf8')).version;
console.log(`TypeScript ${version}: ${fileURLToPath(compiler)} (read-only; --noEmit)`);
const result = spawnSync(process.execPath, [fileURLToPath(compiler), '--project', fileURLToPath(new URL('../tsconfig.json', import.meta.url))], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
