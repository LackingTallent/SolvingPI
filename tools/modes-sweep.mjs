#!/usr/bin/env node
/**
 * MODES SWEEP — every goal driven through its FINAL step in the real UI:
 * max/quota/qol as single products AND as blends, compare's rank→pick→plan
 * on a product that only ranks via an intermediate-buy cut, and profit
 * end-to-end. Born from the 2026-08-31 sweep finding: Compare ranked
 * "Integrity Response Drones" via the second-chance direct-input cut, but
 * "Plan this →" dead-ended because the pick pinned extract-everything /
 * make-everything defaults that could not reproduce the cut. The world here
 * (six planet types, no Temperate → no Autotrophs anywhere) recreates that
 * exact trap on purpose; this suite fails if the pick ever dead-ends again.
 *
 * Run: node tools/modes-sweep.mjs   (after node tools/build.mjs)
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const shots = resolve(here, '..', '..', 'shots');
mkdirSync(shots, { recursive: true });

// Game truth from the built engine — the sweep computes its own expectations.
const { resourcesOf } = await import(join(dist, 'js/world/planets.js'));
const { SCHEMATICS, tierOf } = await import(join(dist, 'js/spec/schematics.js'));
const { p1InputsOf, oreOf } = await import(join(dist, 'js/engine/chain.js'));
const { character, operation } = await import(join(dist, 'js/world/characters.js'));
const { comparative } = await import(join(dist, 'js/engine/modes.js'));
const { wFromDensityPct } = await import(join(dist, 'js/world/density.js'));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(path)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// The trap world: 6 planets at 85%, three maxed characters, and NO Temperate
// planet — so Autotrophs exists nowhere and every chain that needs it can
// only rank through a buy cut. Prices are the deterministic ui-matrix board.
// ---------------------------------------------------------------------------
const PLANET_TYPES = ['Storm', 'Gas', 'Barren', 'Lava', 'Plasma', 'Oceanic'];
const w85 = Math.round(wFromDensityPct(85));

const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const tierMid = [6, 550, 9500, 72000, 1350000];
const prices = {};
for (const name of SCHEMATICS.keys()) {
  const add = (n) => {
    const mid = tierMid[tierOf(n)] * (0.75 + (hash(n) % 50) / 100);
    prices[n] = { bid: Math.round(mid * 0.965), ask: Math.round(mid * 1.035), dailyVolume: 200000 + (hash(n) % 90) * 10000 };
  };
  add(name);
  for (const p1 of p1InputsOf(name)) { add(p1); try { add(oreOf(p1)); } catch { /* not a P1 */ } }
}

const uiPlanets = PLANET_TYPES.map((t, i) => ({
  name: `Sweep ${'IV V VI VII VIII IX'.split(' ')[i]}`, type: t, system: 'Sweepstakes',
  resources: resourcesOf(t).map((p0) => ({ p0, w: w85 })),
  scannedAt: '2026-08-30T12:00:00Z',
}));
const chars = [
  { name: 'Main', icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 },
  { name: 'Alt One', icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 },
  { name: 'Alt Two', icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 },
];
const baseState = {
  characters: chars,
  planets: uiPlanets,
  prices,
  priceNote: 'sweep board',
  fees: { salesTaxPct: 3.375, brokerPct: 1.5, customsPct: 5, hisecNpc: false },
  freight: { outPerM3: 10, inPerM3: 10 },
  sellBasis: 'immediate', buyBasis: 'immediate',
  programHours: 6,
  mode: 'max', modeChosen: true,
  detailLevel: 'refined', spaceBand: null, costsSource: 'user',
  product: 'Coolant', quotaPerWeek: 5000, qolSessions: 7,
  sourcingOverrides: {}, mix: [],
};

// Engine-side expectation: what SHOULD compare rank first, and is it a cut?
const expectWorld = {
  operation: operation(chars.map((c) => character(c))),
  planets: uiPlanets.map((p) => ({ name: p.name, type: p.type, resources: Object.fromEntries(p.resources.map((r) => [r.p0, r.w])) })),
  programHours: 6,
};
const expectMarket = {
  prices, sellBasis: 'immediate', buyBasis: 'immediate',
  fees: { salesTaxRate: 0.03375, brokerRate: 0.015 },
  customs: { ownerRate: 0.05, hisecNpc: false, customsCodeLevel: 5 },
  freightOutPerM3: 10, freightInPerM3: 10,
};
const { ranked: expectedRanked } = comparative(expectWorld, expectMarket, undefined, {});
const cutRow = expectedRanked.slice(0, 15).find((r) =>
  Object.entries(r.result.sourcing).some(([k, v]) => v === 'buy' && tierOf(k) >= 2));
if (cutRow === undefined) { console.error('sweep precondition broken: no cut-ranked product in the top 15 — rebuild the trap world'); process.exit(1); }
const cutInters = Object.entries(cutRow.result.sourcing).filter(([k, v]) => v === 'buy' && tierOf(k) >= 2).map(([k]) => k);
console.log(`trap armed: "${cutRow.product}" ranks #${expectedRanked.indexOf(cutRow) + 1} only via buy cut on ${cutInters.join(', ')}`);

// ---------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
page.on('dialog', (d) => d.accept());
// Keep the sweep hermetic: no real ESI / image traffic.
await page.route('https://esi.evetech.net/**', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
await page.route('https://images.evetech.net/**', (r) => r.abort());

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); };

const seed = async (patch) => {
  await page.goto(base);
  await page.evaluate((s) => localStorage.setItem('solving-pi-v9-state', JSON.stringify(s)), { ...baseState, ...patch });
  await page.reload();
  await page.waitForSelector('body[data-smoke="ok"]', { timeout: 60000 });
};
const solveAndWait = async () => {
  await page.click('#stickyCalcBtn');
  await page.waitForFunction(() => {
    const p = document.getElementById('resultsPanel');
    return p && p.childElementCount > 0 && !/^Solving/.test(p.textContent ?? '');
  }, { timeout: 120000 });
};
const panelText = () => page.locator('#resultsPanel').textContent();
const noRefusal = async () => (await page.locator('#resultsPanel .v9-refusal-msg').count()) === 0;
const hasPlan = async () => (await page.locator('#resultsPanel .v9-big').count()) >= 1;

// 1 ── MAX, single product.
await seed({ mode: 'max', product: 'Coolant' });
await solveAndWait();
check('MAX single: full plan, no refusal', await hasPlan() && await noRefusal());

// 2 ── QUOTA, single product.
await seed({ mode: 'quota', product: 'Coolant', quotaPerWeek: 5000 });
await solveAndWait();
check('QUOTA single: quota met, no refusal', await noRefusal() && /5,?000|5000/.test(await panelText()));

// 3 ── QOL, single product.
await seed({ mode: 'qol', product: 'Coolant', qolSessions: 7 });
await solveAndWait();
check('QOL single: cadence plan, no refusal', await hasPlan() && await noRefusal());

// 4 ── MAX, blend (60/40) — bundle table + both product lines.
const mix = [{ product: 'Coolant', pct: 60 }, { product: 'Mechanical Parts', pct: 40 }];
await seed({ mode: 'max', mix });
await solveAndWait();
const maxMixText = await panelText();
check('MAX blend: bundle plan names both products, no refusal',
  await noRefusal() && maxMixText.includes('Coolant') && maxMixText.includes('Mechanical Parts'));

// 5 ── QUOTA, blend.
await seed({ mode: 'quota', mix, quotaPerWeek: 2000 });
await solveAndWait();
check('QUOTA blend: bundle quota met, no refusal', await noRefusal() && (await panelText()).includes('Mechanical Parts'));

// 6 ── QOL, blend.
await seed({ mode: 'qol', mix, qolSessions: 7 });
await solveAndWait();
check('QOL blend: cadence bundle, no refusal', await noRefusal() && (await panelText()).includes('Coolant'));

// 7 ── COMPARE: ranked table, and the engine-predicted cut product is IN it.
await seed({ mode: 'compare' });
await solveAndWait();
check('COMPARE: ranked table with pick buttons',
  (await page.locator('#resultsPanel table tr').count()) > 3
  && (await page.locator('#resultsPanel button', { hasText: 'Plan this' }).count()) > 3);
const compareText = await panelText();
check(`COMPARE: cut-ranked product "${cutRow.product}" appears in the ranking`, compareText.includes(cutRow.product));

// 8 ── COMPARE → pick the cut-ranked product: the plan must REPRODUCE the cut,
//      not dead-end at a scan gate or an infeasible refusal (2026-08-31 bug).
const row = page.locator('#resultsPanel table tr', { hasText: cutRow.product }).first();
await row.locator('button', { hasText: 'Plan this' }).click();
await page.waitForFunction((product) => {
  const p = document.getElementById('resultsPanel');
  const t = p?.textContent ?? '';
  return p && p.childElementCount > 0 && !/^Solving/.test(t) && !t.startsWith('Comparison');
}, cutRow.product, { timeout: 120000 });
const pickText = await panelText();
check('COMPARE pick (cut-ranked product): full plan, no dead end',
  await hasPlan() && await noRefusal() && !/Not ready to solve/.test(pickText));
check('COMPARE pick: the buy cut survives into the plan (intermediate imported)',
  cutInters.some((i) => pickText.includes(i)));
check('COMPARE pick: goal switched to max of the picked product',
  await page.evaluate((product) => {
    const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
    return s.mode === 'max' && s.product === product;
  }, cutRow.product));
await page.screenshot({ path: join(shots, 'sweep-compare-pick.png'), fullPage: false });

// 9 ── PROFIT: product AND sourcing chosen automatically, end to end.
await seed({ mode: 'profit' });
await solveAndWait();
const profitText = await panelText();
check('PROFIT: headline winner + full plan, no refusal', await hasPlan() && await noRefusal()
  && profitText.includes(expectedRanked[0].product));

// 10 ── Zero page errors across every leg.
check('no console/page errors across the sweep', consoleErrors.length === 0);
if (consoleErrors.length > 0) console.error(consoleErrors.slice(0, 5).join('\n'));

await browser.close();
server.close();
console.log(`\nmodes-sweep: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.error('FAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
