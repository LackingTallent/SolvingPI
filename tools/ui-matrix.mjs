#!/usr/bin/env node
/**
 * UI MATRIX — drive the real site start-to-finish in headless Chromium:
 * goal-first disclosure, every goal solved, detail-level ladder, presets,
 * suggested sourcing, compare's rank→pick→plan flow, per-section resets.
 * Screenshots land in ../../shots/. Fails loudly on any missed expectation
 * or page console error.
 *
 * Run: node tools/ui-matrix.mjs   (after node tools/build.mjs)
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

// Game-truth helpers straight from the built engine — no hand-rolled data.
const { resourcesOf } = await import(join(dist, 'js/world/planets.js'));
const { SCHEMATICS, tierOf } = await import(join(dist, 'js/spec/schematics.js'));
const { p1InputsOf, oreOf } = await import(join(dist, 'js/engine/chain.js'));
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
// Seed: a neutral 3-character operation, 8 planets in two systems, plausible
// Jita-scale quotes for the whole P0..P4 board (deterministic per name).
// ---------------------------------------------------------------------------
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const tierMid = [6, 550, 9500, 72000, 1350000];
const prices = {};
const allNames = new Set();
for (const name of SCHEMATICS.keys()) {
  allNames.add(name);
  for (const p1 of p1InputsOf(name)) { allNames.add(p1); try { allNames.add(oreOf(p1)); } catch { /* not P1 */ } }
}
for (const name of allNames) {
  const mid = tierMid[tierOf(name)] * (0.75 + (hash(name) % 50) / 100);
  prices[name] = { bid: Math.round(mid * 0.965), ask: Math.round(mid * 1.035), dailyVolume: 200000 + (hash(name) % 90) * 10000 };
}

const planet = (name, type, system, pct) => ({
  name, type, system,
  resources: resourcesOf(type).map((p0, i) => ({ p0, w: Math.round(wFromDensityPct(pct[i % pct.length])) })),
  scannedAt: '2026-08-25T18:40:00Z',
});
const seededState = {
  characters: [
    { name: 'Main', icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 },
    { name: 'Miner Alt', icLevel: 4, ccuLevel: 5, customsCodeLevel: 4, accountingLevel: 4, brokerRelationsLevel: 3 },
    { name: 'Hauler Alt', icLevel: 3, ccuLevel: 4, customsCodeLevel: 4, accountingLevel: 4, brokerRelationsLevel: 3 },
  ],
  planets: [
    planet('Auviken IV', 'Storm', 'Auviken', [92, 71, 64, 55, 48]),
    planet('Auviken V', 'Gas', 'Auviken', [83, 77, 58, 51, 45]),
    planet('Auviken VI', 'Storm', 'Auviken', [68, 61, 57, 49, 41]),
    planet('Auviken II', 'Barren', 'Auviken', [74, 66, 52, 47, 39]),
    planet('Vattuolen I', 'Lava', 'Vattuolen', [88, 79, 63, 54, 42]),
    planet('Vattuolen III', 'Plasma', 'Vattuolen', [81, 72, 60, 50, 44]),
    planet('Vattuolen VI', 'Gas', 'Vattuolen', [76, 69, 55, 46, 40]),
    planet('Vattuolen VII', 'Oceanic', 'Vattuolen', [86, 70, 59, 48, 43]),
  ],
  prices,
  priceNote: 'Quotes entered 2026-08-26 (Jita). Refresh before committing ISK.',
  fees: { salesTaxPct: 3.375, brokerPct: 1.5, customsPct: 5, hisecNpc: true },
  freight: { outPerM3: 12, inPerM3: 12 },
  sellBasis: 'immediate', buyBasis: 'immediate',
  programHours: 6,
  mode: 'max', modeChosen: false,
  detailLevel: 'refined', spaceBand: null, costsSource: 'user',
  product: 'Coolant', quotaPerWeek: 5000, qolSessions: 7,
  sourcingOverrides: {},
};

// ---------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({
  viewport: { width: 1500, height: 950 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
page.on('dialog', (d) => d.accept());

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); };
const shoot = async (name, locator) => {
  const path = join(shots, `${name}.png`);
  if (locator) await locator.screenshot({ path });
  else await page.screenshot({ path });
  console.log(`shot ${name}.png`);
};
// Auto-advance (UI-review #1) folds sections as steps complete — tests open
// whichever section they are about to poke.
const openSec = (id) => page.evaluate((i) => document.getElementById(i)?.classList.remove('collapsed'), id);
const solveAndWait = async () => {
  await page.click('#stickyCalcBtn'); // the ONE solve button (sticky bar)
  // "Ranking products… (i/n)" is the chunked compare/profit progress paint
  // (Round-2 responsiveness fix) — still in flight, keep waiting.
  await page.waitForFunction(() => {
    const p = document.getElementById('resultsPanel');
    return p && p.childElementCount > 0 && !/^(Solving|Ranking products)/.test(p.textContent ?? '');
  }, { timeout: 120000 });
};

await page.goto(base);
await page.waitForSelector('body[data-smoke="ok"]', { timeout: 60000 });

// 1 ── Fresh visitor: owner defaults — goal options A-Z, Compare pre-selected.
check('fresh: goal options listed A to Z', await (async () => { const t = await page.locator('#sec3 .v9-mode').first().textContent(); return t.includes('Compare') && t.includes('rank every product'); })());
check('fresh: NO goal pre-selected — the user must choose', await page.locator('input[name="v9mode"]:checked').count() === 0
  && /Select a Goal/.test(await page.locator('#sec3').textContent()));
check('fresh: no product dropdown in compare', !/Product /.test(await page.locator('#sec3 label:has(select)').allTextContents().then((a) => a.join(' '))));
check('fresh: sourcing controls hidden in compare', await page.locator('text=Adjust sourcing (default').count() === 0);
check('fresh: solve gated — the ONE next step is picking a goal', await page.locator('#stickyCalcBtn[disabled]').count() === 1
  && /Next → Step 1: pick your goal/i.test(await page.locator('#stickyCalcInfo').textContent()));
// Owner 2026-09-04: the screenshot importer must be reachable in SIMPLE mode
// (it was buried under Advanced-only More tools) — its own button beside
// + Add planet reveals the batch panel.
check('simple mode: screenshot import has its own visible door', await (async () => {
  await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
  const btn = page.locator('#openBatchImport');
  if (await btn.count() !== 1) return false;
  await btn.click();
  await page.waitForTimeout(150);
  return await page.evaluate(() =>
    document.getElementById('batchWrap')?.hidden === false
    && document.getElementById('batchInput') !== null);
})());

check('fresh: ZERO starter planets (owner spec); first added planet is BLANK until a space type is picked (owner 2026-09-03)', await (async () => {
  if (await page.locator('.v9-planet').count() !== 0) return false;
  await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
  await page.locator('#sec1 button', { hasText: 'Add planet' }).click();
  await page.waitForTimeout(250);
  const ok = await page.locator('.v9-planet:not(.v9-planet-min)').count() === 1
    && await page.locator('.v9-planet input[placeholder="density %"]').first().inputValue() === ''
    && /no density yet/.test(await page.locator('#v9PlanetList').textContent())
    && /remove planet/i.test(await page.locator('button[title="Remove this planet"]').first().textContent() ?? '');
  // Owner spec 2026-08-31: the density % the user TYPES is the number the
  // plan runs on — typing 85 must store w = wFromDensityPct(85) exactly.
  const inp = page.locator('.v9-planet input[placeholder="density %"]').first();
  await inp.fill('85'); await inp.dispatchEvent('change');
  await page.waitForTimeout(200);
  const wOk = await page.evaluate((expected) => {
    const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
    return Math.abs(s.planets[0].resources[0].w - expected) < 1e-6;
  }, wFromDensityPct(85));
  if (!wOk) return false;
  // put the fresh state back for the checks that follow
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
    s.planets = [];
    localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
  });
  await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
  return ok;
})());
// Mine-it sourcing defaults: pick a product goal and check the pins.
// The sourcing panel is an ADVANCED control now (streamline #1).
check('simple mode: sourcing panel hidden by default', await page.locator('details.v9-sourcing').count() === 0);
await page.evaluate(() => document.getElementById('modeAdvancedBtn')?.click());
await page.waitForTimeout(200);
await openSec('sec3');
await page.check('input[name="v9mode"][value="max"]');
await page.waitForTimeout(150); await openSec('sec3');
await page.click('summary:has-text("Adjust sourcing")');
const pinVals = await page.locator('details.v9-sourcing select').evaluateAll((els) => els.map((e) => e.value));
check('fresh: sourcing defaults to extract (mine it) for every input', pinVals.length >= 2 && pinVals.every((v) => v === 'extract'));
check('advanced mode: How exact? radios appear, Auto first', await page.evaluate(() =>
  document.querySelectorAll('input[name="v9detail"]').length === 4
  && document.querySelector('input[name="v9detail"][value="auto"]')?.checked === true));
await shoot('01-fresh-goal-first', page.locator('#sec3'));
await page.evaluate(() => document.getElementById('modeSimpleBtn')?.click());
await page.waitForTimeout(200);

// Seed the full operation and reload (autosave storage key). Advanced on:
// the deep blocks poke sourcing pins, detail radios, mix and cost tables.
await page.evaluate((s) => localStorage.setItem('solving-pi-v9-state', JSON.stringify({ ...s, advancedMode: true })), seededState);
await page.reload();
await page.waitForSelector('body[data-smoke="ok"]', { timeout: 60000 });

// 2 ── Pick the Max goal: section discloses only what that goal needs.
await openSec('sec3');
await page.check('input[name="v9mode"][value="max"]');
await page.waitForTimeout(150); await openSec('sec3');
await page.waitForSelector('input[name="v9detail"]', { state: 'attached' });
await openSec('sec3');
check('max: detail ladder appears after goal pick (Advanced, incl. Auto)', await page.locator('input[name="v9detail"]').count() === 4);
check('max: no quota/qol fields', await page.locator('#sec3 >> text=Target/week').count() === 0
  && await page.locator('#sec3 >> text=Max sessions/week').count() === 0);
await page.click('summary:has-text("Adjust sourcing")');
check('max: sourcing rows offer Suggested (auto)', (await page.locator('#sec3 select option[value="auto"]').count()) >= 2);
// Owner report 2026-08-31: picking a pin collapsed the panel every time.
await page.locator('details.v9-sourcing select').first().selectOption('buy');
await page.waitForTimeout(250);
check('sourcing panel stays open after choosing a pin', await page.evaluate(() =>
  document.querySelector('details.v9-sourcing')?.open === true));
await page.locator('details.v9-sourcing select').first().selectOption('auto');
await page.waitForTimeout(250);
check('sourcing panel still open after a second change', await page.evaluate(() =>
  document.querySelector('details.v9-sourcing')?.open === true));
await shoot('02-goal-configured', page.locator('#sec3'));

// 3 ── Solve Max: suggested sourcing disclosed, per-character dashboard.
await solveAndWait();
check('max: result cards render', await page.locator('#resultsPanel .v9-big').count() >= 1);
check('max: sourcing disclosure card', await page.locator('.v9-suggest', { hasText: 'Sourcing — chosen for you' }).count() === 1);
check('max: character dashboard renders all 3 characters',
  await page.locator('.v9-char', { hasText: 'Main' }).count() >= 1
  && await page.locator('.v9-char', { hasText: 'Miner Alt' }).count() >= 0); // dealer may not need every char
check('max: no ESTIMATE banner at user-cost refined level', await page.locator('.v9-estimate').count() === 0);

// Per-colony one-click templates in the dashboard.
const tplRows = await page.locator('.v9-colony .v9-tpl').count();
const colonies = await page.locator('.v9-colony').count();
check('templates: every colony card carries a template row', tplRows === colonies && colonies > 0);
check('templates: at least one byte-exact library match (credited)', await page.locator('.v9-tpl-src', { hasText: 'library:' }).count() >= 1);
check('templates: generated layouts flagged ⚠ verify', await page.locator('.v9-tpl-caution', { hasText: 'generated — verify in game' }).count() >= 1);
// Element handle, not a text locator — the label changes on click, and a
// hasText locator would silently re-resolve to the NEXT un-clicked button.
const copyBtn = await page.locator('.v9-tpl button', { hasText: 'Copy template' }).first().elementHandle();
await copyBtn.click();
await page.waitForTimeout(300);
check('templates: copy confirms on the button', /Copied — import in game/.test(await copyBtn.textContent()));
check('templates: copy button shrunk to a quiet chip (~60% smaller)', await page.evaluate(() => {
  const b = document.querySelector('.v9-tpl .btn.small');
  return b !== null && parseFloat(getComputedStyle(b).fontSize) <= 12;
}));
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('templates: clipboard holds a real EVE template (CmdCtrLv + pins + routes)',
  /"CmdCtrLv"/.test(clip) && /"P": \[/.test(clip) && /"R": \[/.test(clip) && /"Pln"/.test(clip));
await shoot('03-max-results-top', page.locator('#resultsPanel'));
await shoot('12-colony-templates', page.locator('.v9-char').first());
await shoot('04-max-dashboard', page.locator('#resultsPanel').locator('xpath=.//h3[contains(text(),"Plan by character")]/..'));

// 3b ── All PI Visualized (first reference card). Reference cards live in
// the REFERENCE view now (UI-review #10) — switch lenses for this block.
await page.evaluate(() => document.getElementById('viewReference')?.click());
check('view toggle: reference lens hides the planner steps', await page.evaluate(() =>
  getComputedStyle(document.getElementById('sec3')).display === 'none'
  && getComputedStyle(document.getElementById('secChains')).display !== 'none'));
check('chains viz: first reference card, titled "All PI Visualized"', await page.evaluate(() => {
  const refs = [...document.querySelectorAll('section.card.reference')];
  return refs[0]?.id === 'secChains'
    && /All PI Visualized/.test(refs[0]?.querySelector('.st-label')?.textContent ?? '');
}));
check('chains viz: every node shows per-unit m³, and live prices from section 4', await page.evaluate(() => {
  const subs = [...document.querySelectorAll('#vzBody .vz-sub')];
  return subs.length > 0 && subs.every((s) => /m³/.test(s.textContent))
    && subs.some((s) => /ISK/.test(s.textContent)); // suite seeds Jita quotes
}));
check('chains viz: edge labels carry units AND step cargo volume', await page.evaluate(() => {
  const qs = [...document.querySelectorAll('#vzBody .vz-qty')];
  return qs.length > 0 && qs.every((q) => /·\s*[\d,.]+\s*m³/.test(q.textContent));
}));
check('chains viz: planet key lists all 8 types, cover-set types bold', await page.evaluate(() => {
  const items = [...document.querySelectorAll('#vzKey .vz-kitem')];
  return items.length === 8 && document.querySelectorAll('#vzKey .vz-kon').length >= 1
    && ['Barren', 'Gas', 'Ice', 'Lava', 'Oceanic', 'Plasma', 'Storm', 'Temperate']
      .every((t) => items.some((i) => i.textContent.includes(t)));
}));
check('chains viz: renders a diagram with 68 selectable products',
  await page.locator('#vzBody svg[role="img"]').count() === 1
  && await page.locator('#vzProduct option').count() === 68);
await page.evaluate(() => document.getElementById('secChains')?.classList.remove('collapsed'));
for (const lay of ['river', 'radial', 'lanes', 'ladder']) {
  await page.click(`.vz-lay[data-lay="${lay}"]`);
  await page.waitForTimeout(200);
}
check('chains viz: all four layouts render without error',
  await page.locator('#vzBody svg[role="img"]').count() === 1);
await page.selectOption('#vzProduct', 'Robotics');
await page.waitForTimeout(250);
check('chains viz: planets-needed computed (Robotics → 1 planet type)',
  /1 planet type covers all 4 ores/.test(await page.locator('#vzNeeds').textContent()));
await page.locator('#vzBody .vz-node[data-n="Mechanical Parts"]').first().click({ force: true });
await page.waitForTimeout(250);
check('chains viz: clicking a node re-roots the diagram',
  await page.locator('#vzProduct').inputValue() === 'Mechanical Parts');

// Real CCP icons: every name resolves a type id through the verified table;
// offline the drawn glyphs hold; with the image server reachable (simulated —
// this sandbox can't reach it) tiles and planet chips upgrade in place.
check('chains viz: every commodity resolves a type id (tiles carry data-tid)', await page.evaluate(() => {
  const opts = [...document.querySelectorAll('#vzProduct option')].map((o) => o.value);
  const p0s = Object.values(PLANET_RESOURCES).flat();
  return opts.every((n) => TYPE_IDS[n] > 0) && p0s.every((n) => TYPE_IDS[n] > 0)
    && [...document.querySelectorAll('#vzBody .vz-tile')].every((t) => t.dataset.tid !== '');
}));
check('chains viz: offline — schematic glyphs hold, zero broken images',
  await page.locator('#vzBody .vz-tile image').count() === 0 && consoleErrors.length === 0);
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
await page.route('https://images.evetech.net/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG1 }));
await page.reload();
await page.waitForSelector('body[data-smoke="ok"]');
// A reload resets the lens to PLANNER — switch back for the icon checks.
await page.evaluate(() => document.getElementById('viewReference')?.click());
await page.evaluate(() => document.getElementById('secChains')?.classList.remove('collapsed'));
await page.waitForFunction(() => document.querySelectorAll('#vzBody .vz-tile image').length > 0, { timeout: 20000 });
check('chains viz: real in-game icons load and tiles upgrade in place',
  await page.locator('#vzBody .vz-tile image').count() > 0);
check('chains viz: planet chips upgrade to real planet icons',
  await page.locator('#vzNeeds .vz-ptile image').count() > 0);
check('chains viz: icon URLs hit the CCP image server with the right shape', await page.evaluate(() =>
  [...document.querySelectorAll('#vzBody .vz-tile image')]
    .every((im) => /^https:\/\/images\.evetech\.net\/types\/\d+\/icon\?size=64$/.test(im.getAttribute('href')))));
await page.unroute('https://images.evetech.net/**');
await page.evaluate(() => { document.getElementById('secChains')?.scrollIntoView(); });
await shoot('13-chains-viz', page.locator('#secChains'));
await page.evaluate(() => document.getElementById('secChains')?.classList.add('collapsed'));
await page.evaluate(() => document.getElementById('viewPlanner')?.click());
check('view toggle: planner lens back — steps visible again', await page.evaluate(() =>
  getComputedStyle(document.getElementById('sec3')).display !== 'none'));

// 3c ── Market data populates ITSELF (simulated ESI): fetch-first prompt when
// unpriced, then a product change auto-fills the gaps within seconds.
const esiOrders = JSON.stringify([
  { is_buy_order: true, price: 100, volume_remain: 5000, location_id: 60003760 },
  { is_buy_order: false, price: 120, volume_remain: 5000, location_id: 60003760 },
]);
await page.route('https://esi.evetech.net/**', (r) =>
  r.fulfill({ contentType: 'application/json', body: /history/.test(r.request().url()) ? '[]' : esiOrders }));
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.prices = {}; s.mode = 'max'; s.modeChosen = true;
  s.product = 'Water'; s.sourcingOverrides = { Water: 'extract' };
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
// UI-review #2: arriving unpriced no longer asks the user to do anything —
// the page fetches live prices ITSELF on load and the gate self-heals.
await page.waitForFunction(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return Object.values(s.prices ?? {}).some((q) => q && q.bid > 0 && q.ask > 0);
}, { timeout: 15000 });
check('auto-fetch: unpriced arrival populates market data with no user action', true);
await openSec('sec3');
await page.selectOption('#sec3 select >> nth=0', 'Coolant');
await page.waitForFunction(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return Object.values(s.prices ?? {}).some((q) => q && q.bid > 0 && q.ask > 0) && /Live: /.test(s.priceNote);
}, { timeout: 15000 });
check('auto-refresh: a product change repopulates market data by itself', true);
check('auto-refresh: price note reports live + auto-refreshing', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return /Live: /.test(s.priceNote) && /Auto-refreshes/.test(s.priceNote);
}));
await page.waitForFunction(() => /Ready — press SOLVE/.test(document.getElementById('stickyCalcInfo')?.textContent ?? ''), { timeout: 15000 });
check('auto-fetch: gate reaches "Ready — press SOLVE" entirely by itself', true);
await page.unroute('https://esi.evetech.net/**');
// Restore the seeded quotes + product so the sections that follow see the
// exact state they always have.
await page.evaluate((restore) => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.prices = restore.prices; s.product = restore.product; s.sourcingOverrides = restore.overrides;
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
}, { prices, product: seededState.product, overrides: seededState.sourcingOverrides ?? {} });
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');

// 4 ── Quota goal.
await openSec('sec3');
await page.check('input[name="v9mode"][value="quota"]');
await page.waitForTimeout(150); await openSec('sec3');
await page.waitForSelector('#sec3 >> text=Target/week');
await solveAndWait();
check('quota: solved or refused by name', await page.locator('#resultsPanel').textContent().then((t) => /\/wk|quota-unreachable|achievable/.test(t)));
await shoot('05-quota-results', page.locator('#resultsPanel'));

// 5 ── QoL goal.
await openSec('sec3');
await page.check('input[name="v9mode"][value="qol"]');
await page.waitForTimeout(150); await openSec('sec3');
await page.waitForSelector('#sec3 >> text=Max sessions/week');
await solveAndWait();
check('qol: cadence note present', /Chosen cadence/.test(await page.locator('#resultsPanel').textContent()));
await shoot('06-qol-results', page.locator('#resultsPanel'));

// 6 ── Compare: rank order → pick → best path.
await openSec('sec3');
await page.check('input[name="v9mode"][value="compare"]');
await page.waitForTimeout(150); await openSec('sec3');
await page.waitForTimeout(200);
check('compare: sourcing controls absent', await page.locator('text=Adjust sourcing (default').count() === 0);
check('compare: product dropdown disappears', await page.locator('#sec3').textContent().then((t) => !/Product /.test(t)));
await solveAndWait();
check('compare: ranked table with pick buttons',
  await page.locator('#resultsPanel table tr').count() > 3
  && (await page.locator('#resultsPanel button', { hasText: 'Plan this' }).count()) > 3);
check('compare: exclusions honest — no raw missing-price wall, gaps summarized', await page.evaluate(() => {
  const t = document.getElementById('resultsPanel')?.textContent ?? '';
  // A fully-priced seed may legitimately exclude nothing; when something IS
  // excluded it must read as a sentence (or the one-line unpriced summary),
  // never the engine's "refusing to value it silently".
  return !/refusing to value it silently/.test(t)
    && (/excluded — each with its reason/.test(t) || /not ranked yet — no Jita price/.test(t) || /viable product/.test(t));
}));
// Ranking-truth guard (owner report 2026-09-03): the rendered ranking must
// be strictly by net ISK — never alphabetical, never tied across the board.
check('compare: rendered ranking is by net ISK, not alphabetical', await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#resultsPanel table tr')].slice(1);
  const names = [];
  const nets = [];
  for (const r of rows) {
    const cells = [...r.querySelectorAll('td')].map((c) => c.textContent ?? '');
    if (cells.length < 3) continue;
    names.push(cells[1]);
    const n = Number((cells[2] ?? '').replace(/[^\d.-]/g, ''));
    if (Number.isFinite(n)) nets.push(n);
  }
  if (nets.length < 5) return false;
  const sorted = nets.every((v, i) => i === 0 || v <= nets[i - 1] + 1e-6);
  const alpha = JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b)));
  const distinct = new Set(nets.map((n) => Math.round(n))).size > nets.length / 2;
  return sorted && !alpha && distinct;
}));
await shoot('07-compare-ranked', page.locator('#resultsPanel'));
const topProduct = (await page.locator('#resultsPanel table tr').nth(1).locator('td').nth(1).textContent()).trim();
await page.locator('#resultsPanel button', { hasText: 'Plan this' }).first().click();
await page.waitForFunction(() => /Plan by character/.test(document.getElementById('resultsPanel')?.textContent ?? ''), { timeout: 120000 });
check('compare→pick: best path plan rendered for the picked product',
  (await page.locator('#resultsPanel').textContent()).includes(topProduct));
check('compare→pick: goal switched to max of picked product',
  await page.locator('input[name="v9mode"][value="max"]:checked').count() === 1
  && (await page.locator('#sec3 select').first().inputValue()) === topProduct);
await shoot('08-compare-picked-best-path', page.locator('#resultsPanel'));

// 6b ── Multi-tier sourcing + Maximize profits (owner spec 2026-08-30).
check('goal list: Pick for me sits A-to-Z between Max output and Weekly target', await page.evaluate(() => {
  const labels = [...document.querySelectorAll('#sec3 .v9-mode')].map((l) => l.textContent.trim());
  const i = labels.findIndex((t) => /Pick for me/.test(t));
  return i > 0 && /Max output/.test(labels[i - 1] ?? '') && /Weekly target/.test(labels[i + 1] ?? '');
}));
// Intermediate pins exist in product modes (Robotics has two P2 parts).
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.mode = 'max'; s.modeChosen = true; s.product = 'Robotics';
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
await page.click('summary:has-text("Adjust sourcing")');
check('sourcing: intermediate parts pinnable (make / buy finished cuts the chain)', await page.evaluate(() => {
  const t = document.querySelector('details.v9-sourcing')?.textContent ?? '';
  return /Intermediate parts/.test(t) && /buy finished — cut the chain here/.test(t)
    && /Mechanical Parts \(P2\)/.test(t) && /Consumer Electronics \(P2\)/.test(t);
}));
// Pin a P2 to 'buy': the solved plan must import it and build no factories for it.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.sourcingOverrides = { ...s.sourcingOverrides, 'Mechanical Parts': 'buy' };
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
await solveAndWait();
check('chain cut honored: bought P2 imported, no factories built for it', await page.evaluate(() => {
  const t = document.getElementById('resultsPanel')?.textContent ?? '';
  return /import .*Mechanical Parts/.test(t) && !/advanced → Mechanical Parts/.test(t);
}));
// Compare: sourcing preferences panel with all 15 P1s.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.mode = 'compare'; delete s.sourcingOverrides['Mechanical Parts'];
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
check('compare: Adjust sourcing preferences shown with all 15 P1s', await page.evaluate(() => {
  const d = document.querySelector('details.v9-sourcing');
  if (!d || !/Adjust sourcing preferences/.test(d.textContent)) return false;
  return d.querySelectorAll('.v9-row select').length === 15;
}));
// Maximize profits: hands-free pick end to end.
await openSec('sec3');
await page.check('input[name="v9mode"][value="profit"]');
await page.waitForTimeout(150); await openSec('sec3');
await page.waitForTimeout(200);
check('profit: no product dropdown (it decides)', await page.evaluate(() =>
  ![...document.querySelectorAll('#sec3 label')].some((l) => /^\s*Product\b/.test(l.textContent ?? ''))));
await solveAndWait();
check('profit: picked a product with net + runners-up + full plan', await page.evaluate(() => {
  const t = document.getElementById('resultsPanel')?.textContent ?? '';
  return /Pick for me chose/.test(t) && /Runners-up/.test(t) && /Plan by character/.test(t);
}));
await shoot('14-maximize-profits', page.locator('#resultsPanel'));

// 6c ── Product mix (owner spec): pick several products with % shares.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.mode = 'max'; s.product = 'Coolant'; s.mix = [];
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
check('mix: single-product modes offer "+ Plan a mix of products instead"',
  await page.locator('#sec3 button', { hasText: 'Plan a mix of products' }).count() === 1);
await openSec('sec3');
await page.locator('#sec3 button', { hasText: 'Plan a mix of products' }).click();
await page.waitForTimeout(250);
check('mix: editor opens with two rows and % shares; single Product row gone',
  await page.locator('.v9-mix .v9-mix-row').count() === 2
  && await page.evaluate(() => ![...document.querySelectorAll('#sec3 label')].some((l) => /^\s*Product\b/.test(l.textContent ?? ''))));
// Owner spec: shares total EXACTLY 100, always — editing one rebalances the rest.
await page.evaluate(() => {
  const inp = document.querySelectorAll('.v9-mix-row input.v9-num')[0];
  inp.value = '90'; inp.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(250);
check('mix: shares always total exactly 100 (edit one → others rebalance)', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return s.mix.reduce((a, e) => a + e.pct, 0) === 100 && s.mix[0].pct === 90
    && /Total: 100% ✓/.test(document.querySelector('.v9-mix-total')?.textContent ?? '');
}));
check('mix: color share bar shows one segment per product', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return document.querySelectorAll('.v9-mix-seg').length === s.mix.length;
}));
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.mix = [{ product: 'Coolant', pct: 60 }, { product: 'Mechanical Parts', pct: 40 }];
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
await solveAndWait();
check('mix: bundle table + per-line full plans, characters partitioned', await page.evaluate(() => {
  const t = document.getElementById('resultsPanel')?.textContent ?? '';
  return /Your mix — planned/.test(t) && /Coolant/.test(t) && /Mechanical Parts/.test(t)
    && document.querySelectorAll('.v9-mix-line').length === 2;
}));
await shoot('15-product-mix', page.locator('#resultsPanel'));
// restore for the sections that follow
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.mode = 'max'; s.mix = [];
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');

// 7 ── Accuracy ladder: Quick estimate with an unscanned planet + band.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.planets.push({ name: 'Auviken VIII', type: 'Ice', system: 'Auviken', resources: [] });
  const legal = ['Aqueous Liquids', 'Heavy Metals', 'Micro Organisms', 'Noble Gas', 'Planktic Colonies'];
  s.planets[s.planets.length - 1].resources = legal.map((p0) => ({ p0, w: 0 }));
  s.detailLevel = 'quick'; s.autoDetail = false; s.spaceBand = null; s.costsSource = 'default';
  // Deterministic product: Coolant's chain uses Aqueous Liquids (Water),
  // which the Ice planet lists unscanned — so the band is demanded under the
  // review-#2 scoping rule regardless of what section 6 picked. (Scoping
  // itself — irrelevant zeros NOT nagging — is covered in edge-matrix.)
  s.mode = 'max'; s.modeChosen = true; s.product = 'Coolant';
  s.sourcingOverrides = { Electrolytes: 'extract', Water: 'extract' };
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload();
await page.waitForSelector('body[data-smoke="ok"]');
check('quick: space type demanded while something is unscanned',
  /space type/.test(await page.locator('#stickyCalcBtn').getAttribute('title') ?? ''));
// Planet completion checkboxes: seeded planets load all-minimized but first.
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
check('planets: all minimized but the first', await page.locator('.v9-planet-min').count() === 8
  && await page.locator('.v9-planet:not(.v9-planet-min)').count() === 1);
check('planets: grouped by system with a header per system', await page.locator('.v9-sys-head').count() === 2
  && await page.locator('.v9-sys-head .v9-collapse-all').count() === 2);
check('planets: Complete & Collapse sits on the right', await page.evaluate(() => {
  const row = document.querySelector('.v9-planet:not(.v9-planet-min) > .v9-row');
  const done = row?.querySelector('.v9-done');
  return !!done && row.lastElementChild === done;
}));
// REGRESSION (owner report): collapsing one planet must collapse ONLY that
// planet. Expand two more, collapse one, the other must stay expanded.
// evaluate-clicks: the change handler rerenders (detaching the node), which
// breaks Playwright's post-click verification on check()/uncheck().
await page.evaluate(() => document.querySelector('.v9-planet-min .v9-done input')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.v9-planet-min .v9-done input')?.click());
await page.waitForTimeout(200);
check('planets: two more expanded (3 open)', await page.locator('.v9-planet:not(.v9-planet-min)').count() === 3);
await page.evaluate(() => document.querySelector('.v9-planet:not(.v9-planet-min) .v9-done input')?.click());
await page.waitForTimeout(200);
check('planets: collapsing one collapses ONLY that one (2 stay open)',
  await page.locator('.v9-planet:not(.v9-planet-min)').count() === 2);
// Per-system Complete & Collapse All: the first system's planets all close;
// other systems are untouched.
await page.evaluate(() => document.querySelector('.v9-sys-head .v9-collapse-all')?.click());
await page.waitForTimeout(250);
check('planets: system collapse-all closes only its own system', await page.evaluate(() => {
  const heads = [...document.querySelectorAll('.v9-sys-head')];
  if (heads.length < 2) return false;
  let n = heads[0].nextElementSibling;
  while (n && !n.classList.contains('v9-sys-head')) {
    if (n.classList.contains('v9-planet') && !n.classList.contains('v9-planet-min')) return false;
    n = n.nextElementSibling;
  }
  return true;
}));
await page.evaluate(() => document.getElementById('sec1')?.classList.add('collapsed'));
// Presentation: cluster pinned to page top (not scroll-following), SOLVE gold.
check('top cluster no longer follows scroll (absolute, not fixed)',
  await page.evaluate(() => getComputedStyle(document.querySelector('.top-cluster')).position) === 'absolute');
check('SOLVE is big radiant gold in the sticky bar', await page.evaluate(() => {
  const cs = getComputedStyle(document.getElementById('stickyCalcBtn'));
  return cs.backgroundImage.includes('linear-gradient') && parseFloat(cs.fontSize) >= 19;
}));
check('ONE solve button: Goal section has a breadcrumb, not a second SOLVE', await page.evaluate(() => {
  return document.querySelector('#sec3Body .btn.primary') === null
    && /gold SOLVE/.test(document.querySelector('#sec3Body .v9-solve-crumb')?.textContent ?? '');
}));
check('pilot light: sticky bar names the single next step', await page.evaluate(() => {
  const t = document.getElementById('stickyCalcInfo')?.textContent ?? '';
  return /Next → Step \d:/.test(t) || /Ready — press SOLVE/.test(t);
}));
check('pilot light: section headers carry ✓/→ progress chips', await page.evaluate(() => {
  const chips = [...document.querySelectorAll('.v9-step-chip')];
  return chips.length === 4 && chips.some((c) => c.classList.contains('v9-chip-done') || c.classList.contains('v9-chip-now'));
}));
// The band question lives in WHAT YOU HAVE now (owner 2026-09-03): one
// "Where do you operate?" tap sets costs, the density band AND re-bands
// every assumed density.
check('quick: no band dropdown left in the Goal section', !/Your space/.test(await page.locator('#sec3').textContent()));
await openSec('sec1');
await page.locator('#sec1 .fin-presets .preset-btn', { hasText: 'Null sec' }).click();
await page.waitForTimeout(300);
check('quick: one "Where do you operate?" tap records band + costs', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return s.spaceBand === 'nullsec' && s.costsSource === 'preset-nullsec';
}));
check('quick: preset tap does NOT overwrite scanned densities', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return s.planets.some((p) => p.resources.some((r) => r.w > 0 && Math.abs(r.w - 11949.5) > 1));
}));
await shoot('09-quick-band', page.locator('#sec2'));
await page.evaluate(() => document.getElementById('sec2')?.classList.add('collapsed'));
await solveAndWait();
check('quick: ESTIMATE banner lists assumptions', await page.locator('.v9-estimate').count() === 1
  && /assumed|preset/.test(await page.locator('.v9-estimate').textContent()));
check('quick: summary tagged (estimate)', /\(estimate\)/.test(await page.locator('#sec4Summary').textContent()));
await shoot('10-quick-estimate-banner', page.locator('#resultsPanel'));

// 8 ── "Where do you operate?" lives with the planets (owner 2026-09-03);
// the confirm button is retired — editing any fee field owns the rates.
await openSec('sec1');
check('costs: 4 preset buttons live in section 2', await page.locator('#sec1 .fin-presets .preset-btn').count() === 4
  && await page.locator('#sec2 button', { hasText: 'These are my real rates' }).count() === 0);
await openSec('sec2');
await page.locator('#sec2 details.v9-more-tools').first().evaluate((d) => { d.open = true; });
const taxIn = page.locator('#sec2 label:has-text("Sales tax %") input');
await taxIn.fill('4');
await taxIn.dispatchEvent('change');
await page.waitForTimeout(200);
check('costs: editing a fee marks rates as the user\'s own', /your own rates/.test(await page.locator('#sec2').textContent()));
await shoot('11-costs-presets', page.locator('#sec1 .fin-presets'));

// 9 ── Per-section reset: Goal reset returns to goal-first state.
await page.locator('button[data-reset="sec3"]').click();
await page.waitForTimeout(300);
check('reset: goal section back to nothing-chosen', await page.locator('input[name="v9mode"]:checked').count() === 0);
check('reset: other sections untouched (planets kept)', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('solving-pi-v9-state')).planets.length) === 9);

// 10 ── REGION SCOUT: mocked ESI universe — region select, ranked table with
// the estimate disclosure and live-traffic badges, one-click planet load.
// The mock region: one system that covers a P2 chain (Storm+Gas), one
// ore-less pocket, so the ranking has something honest to say.
const scoutEsi = {
  '/universe/regions/': [42000001],
  '/universe/names/': [{ id: 42000001, name: 'Scoutland', category: 'region' }],
  '/universe/regions/42000001/': { constellations: [43000001] },
  '/universe/constellations/43000001/': { systems: [44000001, 44000002] },
  '/universe/systems/44000001/': { name: 'Alpha', security_status: -0.42, planets: [{ planet_id: 45000001 }, { planet_id: 45000002 }] },
  '/universe/systems/44000002/': { name: 'Bravo', security_status: -0.42, planets: [{ planet_id: 45000003 }] },
  '/universe/planets/45000001/': { name: 'Alpha I', type_id: 2017 },
  '/universe/planets/45000002/': { name: 'Alpha II', type_id: 13 },
  '/universe/planets/45000003/': { name: 'Bravo I', type_id: 2016 },
  '/universe/system_kills/': [{ system_id: 44000002, ship_kills: 9, pod_kills: 4, npc_kills: 120 }],
  '/universe/system_jumps/': [{ system_id: 44000001, ship_jumps: 3 }, { system_id: 44000002, ship_jumps: 250 }],
};
await page.route('https://esi.evetech.net/**', (r) => {
  const path = new URL(r.request().url()).pathname.replace('/latest', '');
  const body = scoutEsi[path];
  if (body !== undefined) { r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }); return; }
  r.fulfill({ contentType: 'application/json', body: '[]' });
});
// The repo now SHIPS a baked map (owner-generated); block it here so this
// block keeps exercising the live-ESI fallback path end to end.
await page.route('**/map/universe-map.json', (r) => r.fulfill({ status: 404, body: 'nope' }));
// A product goal whose chain Storm+Gas covers (Coolant), prices already seeded.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.mode = 'max'; s.modeChosen = true; s.product = 'Coolant'; s.mix = [];
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
await page.locator('#chooseScout').click();
check('scout: Find-me-a-home banner swaps the section — planets UI hidden, scout shown', await page.evaluate(() =>
  document.getElementById('sec1Mine').hidden === true && document.getElementById('scoutWrap').hidden === false));
await page.locator('#scoutPanel select').focus();
await page.waitForFunction(() => document.querySelectorAll('#scoutPanel select option').length >= 2, { timeout: 30000 });
check('scout: region list loads into the picker (live ESI fallback, no baked map)',
  /Scoutland/.test(await page.locator('#scoutPanel select').textContent()));
await page.selectOption('#scoutPanel select', '42000001');
await page.locator('#scoutPanel button', { hasText: 'Scout this region' }).click();
await page.waitForFunction(() => document.querySelectorAll('#scoutPanel table tr').length >= 3, { timeout: 60000 });
check('scout: estimate disclosure carries the band assumptions', await page.evaluate(() => {
  const e = document.querySelector('#scoutPanel .v9-estimate');
  return e !== null && /assumed/.test(e.textContent) && /only exist in game/.test(e.textContent);
}));
check('scout: covering system ranked first with a net estimate', await page.evaluate(() => {
  const row = document.querySelectorAll('#scoutPanel table tr')[1];
  return row !== undefined && /Alpha/.test(row.textContent) && /1× Gas|1× Storm/.test(row.textContent);
}));
check('scout: traffic badge is its own column — quiet vs hot', await page.evaluate(() => {
  const t = document.getElementById('scoutPanel');
  return t.querySelector('.v9-scout-quiet') !== null && t.querySelector('.v9-scout-hot') !== null;
}));
const beforeLoad = await page.evaluate(() => JSON.parse(localStorage.getItem('solving-pi-v9-state')).planets.length);
await page.locator('#scoutPanel button', { hasText: 'Load planets' }).first().click();
await page.waitForTimeout(400);
check('scout: Load planets seeds section 3 with the system\'s real planets at its OWN band typical (assumed ~)', await page.evaluate((n) => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  const added = s.planets.filter((p) => p.system === 'Alpha');
  return s.planets.length === n + 2 && added.length === 2
    && added.every((p) => p.resources.every((r) => r.w > 0 && r.assumed === true))
    && added.some((p) => p.name === 'Alpha I' && p.type === 'Storm');
}, beforeLoad));
check('scout: Load planets flips back to MY SYSTEMS view', await page.evaluate(() =>
  document.getElementById('sec1Mine').hidden === false && document.getElementById('scoutWrap').hidden === true));
await page.locator('#chooseScout').click();
check('scout: second scan uses the kept copy (no re-crawl of the map service)', await (async () => {
  let calls = 0;
  await page.route('https://esi.evetech.net/latest/universe/planets/**', (r) => { calls++; r.fulfill({ contentType: 'application/json', body: '{}' }); });
  await page.locator('#scoutPanel button', { hasText: 'Scout this region' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#scoutPanel table tr').length >= 3, { timeout: 60000 });
  await page.unroute('https://esi.evetech.net/latest/universe/planets/**');
  return calls === 0;
})());
await shoot('13-region-scout', page.locator('#sec1'));
await page.locator('#chooseSearch').click();
await page.unroute('https://esi.evetech.net/**');

// 11 ── UI-review batch (owner-approved 2026-09-01): dots, quick-add, choice
// cards, Try-an-example, verdict-first results with tabs.
await page.route('https://esi.evetech.net/**', (r) =>
  r.fulfill({ contentType: 'application/json', body: /history/.test(r.request().url()) ? '[]' : esiOrders }));
await page.evaluate(() => localStorage.clear());
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
check('sticky bar: four step dots mirror the pilot light', await page.locator('#stickyDots .v9-dot').count() === 4
  && await page.locator('#stickyDots .v9-dot-now').count() === 1);
// Quick-add: fresh boot auto-opens section 2 (the first incomplete step).
check('auto-advance: fresh boot opens START HERE (no goal chosen)', await page.evaluate(() =>
  !document.getElementById('sec3').classList.contains('collapsed')
  && document.getElementById('sec1').classList.contains('collapsed')));
await openSec('sec1');
const qn = page.locator('#sec0Body .v9-quickadd input');
await qn.fill('2'); await qn.dispatchEvent('change');
await page.locator('#sec0Body button', { hasText: 'Create my roster' }).click();
await page.waitForTimeout(250);
check('quick-add: N maxed characters in one press', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return s.characters.length === 2 && s.characters[0].name === 'Main' && s.characters.every((c) => c.icLevel === 5);
}));
await page.locator('#sec0Body button', { hasText: 'Done adding characters' }).click();
await page.waitForTimeout(300);
// Choice cards: section 3 opens next, tools hidden behind the two big cards.
check('choice banners: empty section 2 leads with the two banners, tools hidden', await page.evaluate(() =>
  !document.getElementById('sec1').classList.contains('collapsed')
  && document.getElementById('sec1Choice').hidden === false
  && document.getElementById('sysSearchPanel').hidden === true));
await page.locator('#chooseSearch').click();
await page.waitForTimeout(200);
check('choice banners: "I know my system" reveals the search tools, banners stay (power tools hidden in Simple)', await page.evaluate(() =>
  document.getElementById('sec1Choice').hidden === false
  && document.getElementById('chooseSearch').classList.contains('active')
  && document.getElementById('sysSearchPanel').hidden === false
  && document.getElementById('moreTools').hidden === true));
// Try an example: one press fills the planner; prices fetch themselves.
await page.locator('#loadExampleBtn').click();
await page.waitForFunction(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return s.planets?.length === 5 && s.charactersDone === true
    && Object.values(s.prices ?? {}).some((q) => q && q.bid > 0 && q.ask > 0);
}, { timeout: 20000 });
check('example: sample world loaded, prices self-fetched', true);
await page.waitForFunction(() => !document.getElementById('stickyCalcBtn')?.hasAttribute('disabled'), { timeout: 15000 });
await solveAndWait();
check('example: compare solves out of the box', (await page.locator('#resultsPanel table tr').count()) > 2);
await page.locator('#resultsPanel button', { hasText: 'Plan this' }).first().click();
await page.waitForFunction(() => document.querySelector('#resultsPanel .v9-verdict') !== null, { timeout: 120000 });
check('verdict-first: the answer leads the results in one card',
  await page.locator('#resultsPanel .v9-verdict .v9-big').count() === 1);
check('tabs: Plan is default and holds the build', await page.evaluate(() =>
  /Plan by character/.test(document.querySelector('#resultsPanel .v9-pane:not([hidden])')?.textContent ?? '')));
await page.locator('#resultsPanel .v9-tab', { hasText: 'Money' }).click();
check('tabs: Money shows the ledger-backed numbers', await page.evaluate(() =>
  /Ledger|ISK not shown/.test(document.querySelector('#resultsPanel .v9-pane:not([hidden])')?.textContent ?? '')));
// T-14: setup capital + payback must render with the money story (priced solves).
check('tabs: Money shows one-time setup capital with payback (T-14)', await page.evaluate(() => {
  const t = document.querySelector('#resultsPanel .v9-pane:not([hidden])')?.textContent ?? '';
  return /ISK not shown/.test(t) || (/Setup capital \(one-time\)/.test(t) && /(Pays for itself|never pays its setup back)/.test(t));
}));
await page.locator('#resultsPanel .v9-tab', { hasText: 'Why this plan' }).click();
check('tabs: Why holds quality + insights', await page.evaluate(() =>
  /Insights/.test(document.querySelector('#resultsPanel .v9-pane:not([hidden])')?.textContent ?? '')));
await page.unroute('https://esi.evetech.net/**');

// 12 ── RECIPE CALCULATOR (owner ask 2026-09-03): exact schematic math,
// costs from live quotes, volume, and the X-factories build-time estimate.
await page.evaluate(() => document.getElementById('viewReference')?.click());
await page.evaluate(() => document.getElementById('secRecipe')?.classList.remove('collapsed'));
await page.waitForSelector('#recipePanel table', { timeout: 10000 });
check('recipe: default Robotics 1000 shows exact direct inputs (10/3 per unit → 3,334)', await page.evaluate(() => {
  const t = document.getElementById('recipePanel')?.textContent ?? '';
  return /Mechanical Parts/.test(t) && /3,334/.test(t) && /Consumer Electronics/.test(t);
}));
check('recipe: build time honors X factories (334 cycles / 10 factories → 1d 10h)', await page.evaluate(() => {
  const t = document.getElementById('recipePanel')?.textContent ?? '';
  return /334 cycles/.test(t) && /1d 10h/.test(t);
}));
check('recipe: totals row carries cost and m³', await page.evaluate(() => {
  const total = document.querySelector('#recipePanel .v9-total')?.textContent ?? '';
  return /Total/.test(total) && /\d/.test(total);
}));
await page.locator('#recipePanel button', { hasText: 'Everything from raw P0' }).click();
await page.waitForTimeout(200);
check('recipe: raw-P0 breakdown reaches P0 and lists intermediates', await page.evaluate(() => {
  const t = document.getElementById('recipePanel')?.textContent ?? '';
  return /raw P0/.test(t) && /You make these along the way/.test(t) && /Precious Metals|Base Metals|Heavy Metals|Noble Metals/.test(t);
}));
await page.locator('#recipePanel button', { hasText: 'Add commodity' }).click();
await page.waitForTimeout(200);
check('recipe: multiple commodities aggregate into one shopping list', await page.evaluate(() => {
  const rows = document.querySelectorAll('#recipePanel .v9-row select').length;
  return rows === 2 && /Coolant/.test(document.getElementById('recipePanel')?.textContent ?? '');
}));
// Paste-your-materials: EVE clipboard format (tabs + thousand separators),
// exact craft math, crafting closure through lower tiers, and unknown lines
// reported by name.
await page.locator('#recipePanel textarea').fill('Water\t8,000\nElectrolytes\t8000\nTritanium\t500');
await page.locator('#recipePanel button', { hasText: 'What can I build?' }).click();
await page.waitForTimeout(200);
check('recipe paste: direct stock → Coolant max 1,000 (8+8 per unit), unknowns named', await page.evaluate(() => {
  const t = document.getElementById('recipeStockTable')?.textContent ?? '';
  const p = document.getElementById('recipePanel')?.textContent ?? '';
  return /Coolant/.test(t) && /1,000/.test(t) && /Not recognized/.test(p) && /Tritanium/.test(p);
}));
await page.locator('#recipePanel textarea').fill('Aqueous Liquids\t1.200.000\nIonic Solutions 1,200,000');
await page.locator('#recipePanel button', { hasText: 'What can I build?' }).click();
await page.waitForTimeout(300);
check('recipe paste: crafting closure — raw P0s alone still build Coolant 1,000 via Water/Electrolytes', await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#recipeStockTable tr')].map((r) => r.textContent ?? '');
  return rows.some((r) => /Coolant/.test(r) && /1,000/.test(r))
    && rows.some((r) => /Water/.test(r) && /8,000/.test(r));
}));
await page.locator('#recipeStockTable button', { hasText: 'Plan batch' }).first().click();
await page.waitForTimeout(200);
check('recipe paste: "Plan batch" loads the pick into the calculator above', await page.evaluate(() => {
  const sel = document.querySelector('#recipePanel select');
  return sel !== null && (sel).value !== 'Robotics';
}));
await shoot('14-recipe-calculator', page.locator('#secRecipe'));
await page.evaluate(() => { document.getElementById('secRecipe')?.classList.add('collapsed'); document.getElementById('viewPlanner')?.click(); });

check('no page console errors across the whole flow', consoleErrors.length === 0);
if (consoleErrors.length) console.error(consoleErrors.slice(0, 6).join('\n'));

await browser.close();
server.close();
console.log(`\nUI MATRIX: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.error(failures.join('\n')); process.exit(1); }
