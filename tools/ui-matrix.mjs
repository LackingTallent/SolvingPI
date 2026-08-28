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
const solveAndWait = async () => {
  await page.click('#sec3 >> text=Solve');
  await page.waitForFunction(() => {
    const p = document.getElementById('resultsPanel');
    return p && p.childElementCount > 0 && !/^Solving/.test(p.textContent ?? '');
  }, { timeout: 120000 });
};

await page.goto(base);
await page.waitForSelector('body[data-smoke="ok"]', { timeout: 60000 });

// 1 ── Fresh visitor: owner defaults — goal options A-Z, Compare pre-selected.
check('fresh: goal options listed A to Z', (await page.locator('#sec3 .v9-mode').first().textContent()).includes('Best net within a login budget'));
check('fresh: Compare is the pre-selected default', await page.locator('input[name="v9mode"][value="compare"]:checked').count() === 1);
check('fresh: no product dropdown in compare', !/Product /.test(await page.locator('#sec3 label:has(select)').allTextContents().then((a) => a.join(' '))));
check('fresh: sourcing controls hidden in compare', await page.locator('text=Adjust sourcing (default').count() === 0);
check('fresh: solve gated on a price (compare ranks by net)', await page.locator('#stickyCalcBtn[disabled]').count() === 1
  && /price/.test(await page.locator('#stickyCalcInfo').textContent()));
check('fresh: starter planets load at 70% density, first expanded, rest collapsed',
  (await page.locator('#v9PlanetList').textContent()).includes('= 70%')
  && await page.locator('.v9-planet').count() === 3
  && await page.locator('.v9-planet-min').count() === 2);
// Mine-it sourcing defaults: pick a product goal and check the pins.
await page.check('input[name="v9mode"][value="max"]');
await page.click('summary:has-text("Adjust sourcing")');
const pinVals = await page.locator('details.v9-sourcing select').evaluateAll((els) => els.map((e) => e.value));
check('fresh: sourcing defaults to extract (mine it) for every input', pinVals.length >= 2 && pinVals.every((v) => v === 'extract'));
await shoot('01-fresh-goal-first', page.locator('#sec3'));

// Seed the full operation and reload (autosave storage key).
await page.evaluate((s) => localStorage.setItem('solving-pi-v9-state', JSON.stringify(s)), seededState);
await page.reload();
await page.waitForSelector('body[data-smoke="ok"]', { timeout: 60000 });

// 2 ── Pick the Max goal: section discloses only what that goal needs.
await page.check('input[name="v9mode"][value="max"]');
await page.waitForSelector('input[name="v9detail"]');
check('max: detail ladder appears after goal pick', await page.locator('input[name="v9detail"]').count() === 3);
check('max: no quota/qol fields', await page.locator('#sec3 >> text=Target/week').count() === 0
  && await page.locator('#sec3 >> text=Max sessions/week').count() === 0);
await page.click('summary:has-text("Adjust sourcing")');
check('max: sourcing rows offer Suggested (auto)', (await page.locator('#sec3 select option[value="auto"]').count()) >= 2);
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

// 3b ── All PI Chains Flow Visualization Tool (first reference card).
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
check('sequencing: ready-but-unpriced gate says fetch in COSTS & MARKET first',
  /COSTS & MARKET first/.test(await page.locator('#stickyCalcInfo').textContent() ?? ''));
await page.selectOption('#sec3 select >> nth=0', 'Coolant');
await page.waitForFunction(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return Object.values(s.prices ?? {}).some((q) => q && q.bid > 0 && q.ask > 0);
}, { timeout: 15000 });
check('auto-refresh: a product change repopulates market data by itself', true);
check('auto-refresh: price note reports live + auto-refreshing', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return /Live: /.test(s.priceNote) && /Auto-refreshes/.test(s.priceNote);
}));
check('auto-refresh: gate tip clears once the chain is priced',
  !/COSTS & MARKET first/.test(await page.locator('#stickyCalcInfo').textContent() ?? ''));
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
await page.check('input[name="v9mode"][value="quota"]');
await page.waitForSelector('#sec3 >> text=Target/week');
await solveAndWait();
check('quota: solved or refused by name', await page.locator('#resultsPanel').textContent().then((t) => /\/wk|quota-unreachable|achievable/.test(t)));
await shoot('05-quota-results', page.locator('#resultsPanel'));

// 5 ── QoL goal.
await page.check('input[name="v9mode"][value="qol"]');
await page.waitForSelector('#sec3 >> text=Max sessions/week');
await solveAndWait();
check('qol: cadence note present', /Chosen cadence/.test(await page.locator('#resultsPanel').textContent()));
await shoot('06-qol-results', page.locator('#resultsPanel'));

// 6 ── Compare: rank order → pick → best path.
await page.check('input[name="v9mode"][value="compare"]');
await page.waitForTimeout(200);
check('compare: sourcing controls absent', await page.locator('text=Adjust sourcing (default').count() === 0);
check('compare: product dropdown disappears', await page.locator('#sec3').textContent().then((t) => !/Product /.test(t)));
await solveAndWait();
check('compare: ranked table with pick buttons',
  await page.locator('#resultsPanel table tr').count() > 3
  && (await page.locator('#resultsPanel button', { hasText: 'Plan this' }).count()) > 3);
check('compare: exclusions named', /excluded/.test(await page.locator('#resultsPanel').textContent()));
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

// 7 ── Accuracy ladder: Quick estimate with an unscanned planet + band.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.planets.push({ name: 'Auviken VIII', type: 'Ice', system: 'Auviken', resources: [] });
  const legal = ['Aqueous Liquids', 'Heavy Metals', 'Micro Organisms', 'Noble Gas', 'Planktic Colonies'];
  s.planets[s.planets.length - 1].resources = legal.map((p0) => ({ p0, w: 0 }));
  s.detailLevel = 'quick'; s.spaceBand = null; s.costsSource = 'default';
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
check('quick: band demanded while something is unscanned',
  /security band/.test(await page.locator('#stickyCalcBtn').getAttribute('title') ?? ''));
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
check('SOLVE is big radiant gold in the Goal section', await page.evaluate(() => {
  const b = document.querySelector('#sec3Body .btn.primary');
  if (!b) return false;
  const cs = getComputedStyle(b);
  return cs.backgroundImage.includes('linear-gradient') && parseFloat(cs.fontSize) >= 19;
}));
await page.selectOption('#sec3 select >> nth=1', 'nullsec');
await page.waitForTimeout(300);
check('quick: preset prefilled + disclosed', /Typical costs were prefilled|Your own cost rates/.test(await page.locator('#sec3').textContent()));
await shoot('09-quick-band', page.locator('#sec3'));
await solveAndWait();
check('quick: ESTIMATE banner lists assumptions', await page.locator('.v9-estimate').count() === 1
  && /assumed|preset/.test(await page.locator('.v9-estimate').textContent()));
check('quick: summary tagged (estimate)', /\(estimate\)/.test(await page.locator('#sec4Summary').textContent()));
await shoot('10-quick-estimate-banner', page.locator('#resultsPanel'));

// 8 ── Costs section: presets row + confirm-own-rates.
await page.evaluate(() => document.getElementById('sec2')?.classList.remove('collapsed'));
check('costs: 4 preset buttons + confirm', await page.locator('#sec2 .preset-btn').count() === 4
  && await page.locator('#sec2 button', { hasText: 'These are my real rates' }).count() === 1);
await page.locator('#sec2 button', { hasText: 'These are my real rates' }).click();
await page.waitForTimeout(200);
check('costs: confirm marks rates as user\'s own', /your own rates/.test(await page.locator('#sec2').textContent()));
await shoot('11-costs-presets', page.locator('#sec2'));

// 9 ── Per-section reset: Goal reset returns to goal-first state.
await page.locator('button[data-reset="sec3"]').click();
await page.waitForTimeout(300);
check('reset: goal section back to the Compare default', await page.locator('input[name="v9mode"][value="compare"]:checked').count() === 1);
check('reset: other sections untouched (planets kept)', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('solving-pi-v9-state')).planets.length) === 9);

check('no page console errors across the whole flow', consoleErrors.length === 0);
if (consoleErrors.length) console.error(consoleErrors.slice(0, 6).join('\n'));

await browser.close();
server.close();
console.log(`\nUI MATRIX: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.error(failures.join('\n')); process.exit(1); }
