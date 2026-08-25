#!/usr/bin/env node
/**
 * Real-browser smoke test: serve dist/, load the page in headless Chromium,
 * and read the DOM the page stamps about itself:
 *   data-smoke="ok"        — module graph executed to the end
 *   data-selftest="pass"   — an end-to-end solve (world → judge → result) ran
 * A page that throws during load stamps neither and the build FAILS.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  const path = join(dist, req.url === '/' ? 'index.html' : req.url);
  if (!existsSync(path)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});

await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const chromium = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';

let dom = '';
try {
  // MUST be async spawn: a sync child would block this process's event loop
  // and the HTTP server above could never answer Chromium's request (found
  // the hard way). Chromium is also noisy in bare containers — judge the
  // dumped DOM, not the exit code.
  dom = await new Promise((resolveDom, reject) => {
    const child = spawn(chromium, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--no-first-run', '--disable-component-update', '--disable-background-networking',
      '--virtual-time-budget=8000', '--dump-dom', `http://127.0.0.1:${port}/`,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('smoke: chromium timed out')); }, 90000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => { clearTimeout(timer); resolveDom(out); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
} finally {
  server.close();
}

const checks = [
  ['module graph executed', dom.includes('data-smoke="ok"')],
  ['end-to-end self-test solve passed', dom.includes('data-selftest="pass"')],
  ['UI rendered (Solve button present)', dom.includes('>Solve<')],
  ['operation section rendered', dom.includes('1 · Operation')],
];
let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) failed = true;
}
if (failed) {
  const m = /data-selftest="fail:[^"]*"/.exec(dom);
  if (m) console.error(`selftest detail: ${m[0]}`);
  console.error('smoke: page did not prove itself — failing the build.');
  process.exit(1);
}
console.log('smoke: green.');
