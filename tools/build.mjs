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
execFileSync('tsc', ['-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });

console.log('copy: static shell …');
cpSync(join(root, 'static'), dist, { recursive: true });

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
