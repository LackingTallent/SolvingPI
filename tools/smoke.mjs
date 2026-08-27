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
let consoleLog = '';
try {
  // MUST be async spawn: a sync child would block this process's event loop
  // and the HTTP server above could never answer Chromium's request (found
  // the hard way). Chromium is also noisy in bare containers — judge the
  // dumped DOM plus the js console, not the exit code.
  const result = await new Promise((resolveDom, reject) => {
    const child = spawn(chromium, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--no-first-run', '--disable-component-update', '--disable-background-networking',
      '--enable-logging=stderr', '--v=0',
      '--virtual-time-budget=8000', '--dump-dom', `http://127.0.0.1:${port}/`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('smoke: chromium timed out')); }, 90000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', () => { clearTimeout(timer); resolveDom({ out, err }); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  dom = result.out;
  consoleLog = result.err;
} finally {
  server.close();
}

// Audit #9: a page that throws anywhere is a failed build — dump-dom alone
// cannot see it. Chromium relays page console errors into its own stderr
// as CONSOLE(...) lines; network noise from the sandbox is filtered out.
const jsErrors = consoleLog.split('\n').filter((l) =>
  /Uncaught (SyntaxError|ReferenceError|TypeError|RangeError|Error)/.test(l) &&
  !/net::|ssl_client|dbus|ERR_INTERNET|Failed to load resource/.test(l));

const checks = [
  ['module graph executed', dom.includes('data-smoke="ok"')],
  ['end-to-end self-test solve passed', dom.includes('data-selftest="pass"')],
  ['UI rendered (Solve button present)', dom.includes('>Solve<')],
  ['operation section rendered by v9', dom.includes('Add character')],
  ['v8 skin hero present', dom.includes('The All-In-One PI Tool')],
  // Audit #9: assert on RENDERED OUTPUT, never on static mount ids that are
  // present even when the feature is a parse-time corpse.
  ['market grid rendered rows', dom.includes('selector-item') && dom.includes('legend-col')],
  ['templates library rendered rows', dom.includes('tpl-row') && dom.includes('tpl-group')],
  ['template count populated', /id="tplCount"[^>]*>[^<]+</.test(dom)],
  ['version stamped (no literal build token)', !dom.includes('@build:version')],
  ['batch import panel present', dom.includes('batchInput')],
  ['system search rendered', dom.includes('sysSearch') && dom.includes('Load its planets')],
  ['goal section is step 1 and the only one expanded',
    dom.includes('class="card" id="sec3"')
    && ['sec0', 'sec1', 'sec2', 'sec4'].every((id) => dom.includes(`class="card collapsed" id="${id}"`))
    && dom.indexOf('id="sec3"') < dom.indexOf('id="sec0"')],
  // The default world is deliberately solvable (missing ores default to buy
  // sourcing), so the gate is proven by the in-page self-test instead: it must
  // block a no-planet world and an unscanned-ore world, and pass a scanned one.
  ['solve gate blocks/passes correctly incl. accuracy ladder (in-page check)', dom.includes('data-gate="pass"')],
  ['every planner section has a reset button',
    ['sec3', 'sec0', 'sec1', 'sec2', 'sec4'].every((id) => dom.includes(`data-reset="${id}"`))],
  // Owner defaults: Compare pre-selected (A-Z listing), so no product
  // dropdown and no sourcing controls render on a fresh visit.
  ['compare is the pre-selected default goal',
    /name="v9mode" value="compare" checked/.test(dom)
    && !dom.includes('<label>Product <')
    && !dom.includes('Adjust sourcing (default')],
  ['planets load at the 70% default density', dom.includes('= 70%')],
  ['systems panel headings are caps, explainer removed',
    dom.includes('ADD A SOLAR SYSTEM') && dom.includes('FLAT DENSITY')
    && !dom.includes('what ESI does <b>not</b> publish')],
  ['planet completion checkbox rendered', dom.includes('class="v9-done"')],
  ['security-band density buttons present', dom.includes('data-band="nullsec"')],
  ['cost presets + confirm-own-rates rendered', dom.includes('These are my real rates')],
  ['price fetch can resolve type ids beyond the partial registry (legacy fallback)', dom.includes('data-typeids="pass"')],
  ['no uncaught page errors in console', jsErrors.length === 0],
];
let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) failed = true;
}
if (failed) {
  const m = /data-selftest="fail:[^"]*"/.exec(dom);
  if (m) console.error(`selftest detail: ${m[0]}`);
  if (jsErrors.length > 0) console.error(`console errors:\n${jsErrors.slice(0, 8).join('\n')}`);
  console.error('smoke: page did not prove itself — failing the build.');
  process.exit(1);
}
console.log('smoke: green.');
