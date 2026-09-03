#!/usr/bin/env node
/**
 * Build: tsc-emit native ES modules + copy static shell, then VERIFY the
 * module graph — every relative import in every emitted file must resolve to
 * a real file, starting from the entry the page loads. The v8 line shipped
 * "alive but unwired" pages from a filename-prefix concat build; this build
 * fails loudly instead.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

console.log('tsc: emitting ES modules …');
// Windows-safe compiler launch (owner hit `spawnSync tsc ENOENT` there): the
// local devDependency's tsc.js run with THIS node binary works on every OS —
// no .cmd shims, no PATH guessing. A bare `tsc` on PATH is the fallback for
// environments that install TypeScript globally instead.
{
  const { createRequire } = await import('node:module');
  let tscJs = null;
  try { tscJs = createRequire(import.meta.url).resolve('typescript/lib/tsc.js'); } catch { /* not installed locally */ }
  if (tscJs !== null) {
    execFileSync(process.execPath, [tscJs, '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
  } else {
    try {
      execFileSync('tsc', ['-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.error('build: TypeScript not found — run `npm install` in this folder first, then re-run the build.');
        process.exit(1);
      }
      throw e;
    }
  }
}

console.log('copy: static shell …');
cpSync(join(root, 'static'), dist, { recursive: true });

// --- version stamping (the skin's #buildBadge and the ESI User-Agent) ------
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
let sha = 'dev';
try { sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { /* no git */ }
const today = new Date().toISOString().slice(0, 10);
const VERSION = `v9.0.0-proto · ${sha} · ${today}`;
const UA_VERSION = '9.0.0-proto';
for (const rel of ['index.html', 'legacy/01-data.js']) {
  const p = join(dist, rel);
  if (!existsSync(p)) continue;
  const src = readFileSync(p, 'utf8')
    .replaceAll('@build:version', VERSION)
    .replaceAll('@build:uaversion', UA_VERSION);
  writeFileSync(p, src);
}
console.log(`version: stamped "${VERSION}"`);

// --- module graph verification -------------------------------------------
const entryMatch = /src="\.\/(js\/[^"]+)"/.exec(readFileSync(join(dist, 'index.html'), 'utf8'));
if (entryMatch === null) throw new Error('build-check: index.html has no module entry script');
const entry = join(dist, entryMatch[1]);
if (!existsSync(entry)) throw new Error(`build-check: entry ${entryMatch[1]} was not emitted`);

const seen = new Set();
const queue = [entry];
while (queue.length > 0) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) throw new Error(`build-check: ${file} imports missing module ${m[1]}`);
    queue.push(target);
  }
}
console.log(`build-check: module graph OK — ${seen.size} modules reachable from the entry.`);

// Emitted-but-unreachable files are fine (data/ modules the UI does not use
// yet), but count them so drift is visible.
let emitted = 0;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) emitted++;
  }
};
walk(join(dist, 'js'));
console.log(`build: ${emitted} modules emitted, ${seen.size} in the page graph. dist/ ready.`);
