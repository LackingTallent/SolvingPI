#!/usr/bin/env node
/**
 * UI EDGE SUITE — the browser companion to tools/edge-matrix.ts. Attacks the
 * paths users actually break: removing everything, corrupt save files through
 * the LOAD button (a different code path from localStorage!), duplicate
 * names, rapid switching, both themes, phone width. Also captures the design-
 * review screenshot set into ../../shots/review/.
 *
 * Run: node tools/ui-edge.mjs   (after node tools/build.mjs)
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const shots = resolve(here, '..', '..', 'shots', 'review');
mkdirSync(shots, { recursive: true });

const { resourcesOf } = await import(join(dist, 'js/world/planets.js'));
const { wFromDensityPct } = await import(join(dist, 'js/world/density.js'));
const { SCHEMATICS, tierOf } = await import(join(dist, 'js/spec/schematics.js'));
const { p1InputsOf, oreOf } = await import(join(dist, 'js/engine/chain.js'));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((req, res) => {
  const p = join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const tierMid = [6, 550, 9500, 72000, 1350000];
const prices = {};
for (const name of SCHEMATICS.keys()) {
  prices[name] = { bid: Math.round(tierMid[tierOf(name)] * 0.9), ask: Math.round(tierMid[tierOf(name)] * 1.1) };
  for (const p1 of p1InputsOf(name)) {
    prices[p1] = { bid: Math.round(tierMid[1] * 0.9), ask: Math.round(tierMid[1] * 1.1) };
    try { const o = oreOf(p1); prices[o] = { bid: 5, ask: 7 }; } catch { /* p0 */ }
  }
}
const planet = (name, type, system, pct) => ({
  name, type, system,
  resources: resourcesOf(type).map((p0, i) => ({ p0, w: Math.round(wFromDensityPct(pct[i % pct.length])) })),
});
const seed = {
  // Three characters: the removal test needs meat, and the fresh default is
  // now an EMPTY roster (owner spec 2026-09-01).
  characters: [
    { name: 'Main', icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 },
    { name: 'Alt 1', icLevel: 4, ccuLevel: 4, customsCodeLevel: 4, accountingLevel: 4, brokerRelationsLevel: 4 },
    { name: 'Alt 2', icLevel: 3, ccuLevel: 4, customsCodeLevel: 4, accountingLevel: 4, brokerRelationsLevel: 3 },
  ],
  charactersDone: true,
  // A goal is chosen in the seed — nothing is pre-selected any more
  // (owner 2026-09-02), and these blocks test post-goal behavior.
  mode: 'max', modeChosen: true, product: 'Coolant',
  planets: [
    planet('Auviken IV', 'Storm', 'Auviken', [92, 71, 64, 55, 48]),
    planet('Auviken V', 'Gas', 'Auviken', [83, 77, 58, 51, 45]),
    planet('Vattuolen I', 'Lava', 'Vattuolen', [88, 79, 63, 54, 42]),
  ],
  prices,
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const failures = [];
const check = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); };

// ═══ Desktop context ══════════════════════════════════════════════════════
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.goto(base);
await page.waitForSelector('body[data-smoke="ok"]');
await page.evaluate((s) => {
  const cur = JSON.parse(localStorage.getItem('solving-pi-v9-state')) || {};
  localStorage.setItem('solving-pi-v9-state', JSON.stringify({ ...cur, ...s }));
}, seed);
await page.reload();
await page.waitForSelector('body[data-smoke="ok"]');

// 1 ── Remove every character: the page must survive and refuse sanely.
// (charactersDone folds the roster to one line — open the editor first.)
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
await page.locator('#sec0Body button', { hasText: 'Edit characters' }).click();
await page.waitForTimeout(200);
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#sec0Body table button')];
    btns[btns.length - 1]?.click();
  });
  await page.waitForTimeout(150);
}
check('remove characters: page survives (no uncaught errors)', pageErrors.length === 0);
check('remove characters: the LAST character cannot be deleted', await page.evaluate(() => {
  // Assert via the DOM (localStorage may hold a partial seed until the app
  // next persists — blocked deletes never persist, an earlier crash here).
  const rows = document.querySelectorAll('#sec0Body table tbody tr').length
    || document.querySelectorAll('#sec0Body table tr:has(input.v9-text)').length;
  const disabledDel = document.querySelectorAll('#sec0Body table button[disabled]').length;
  return rows === 1 && disabledDel === 1;
}));

// Restore.
await page.evaluate((s) => {
  const cur = JSON.parse(localStorage.getItem('solving-pi-v9-state')) || {};
  localStorage.setItem('solving-pi-v9-state', JSON.stringify({ ...cur, ...s }));
}, seed);
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');

// 2 ── Remove every planet: groups vanish, gate names the fix.
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    document.querySelector('#v9PlanetList button[title="Remove this planet"]')?.click()
      ?? [...document.querySelectorAll('.v9-planet-min .v9-done input')][0]?.click();
  });
  await page.waitForTimeout(150);
  // expand any minimized card so its remove button exists
  await page.evaluate(() => document.querySelector('.v9-planet-min .v9-done input')?.click());
  await page.waitForTimeout(120);
}
await page.evaluate(() => {
  let btn;
  while ((btn = document.querySelector('#v9PlanetList button[title="Remove this planet"]'))) btn.click();
});
await page.waitForTimeout(250);
check('remove-all planets: zero cards, zero group headers, no crash',
  await page.locator('.v9-planet').count() === 0 && await page.locator('.v9-sys-head').count() === 0 && pageErrors.length === 0);
check('remove-all planets: gate names "add at least one planet"',
  /add at least one planet/i.test(await page.locator('#stickyCalcBtn').getAttribute('title') ?? '') ||
  /add at least one planet/i.test(await page.locator('#stickyCalcInfo').textContent() ?? ''));

// 3 ── Corrupt save file through the LOAD button (file path ≠ localStorage path).
const corrupt = join('/tmp', 'corrupt-save.json');
writeFileSync(corrupt, JSON.stringify({ solvingPiV9: 1, state: { planets: [{ name: 'X', type: 'Shattered', resources: [{ p0: 'Unobtanium', w: -3 }] }], mode: 'yolo', characters: [] } }));
await page.setInputFiles('#loadDataInput', corrupt);
await page.waitForTimeout(600);
check('corrupt save FILE: page survives the load button', pageErrors.length === 0);
check('corrupt save FILE: sanitized — illegal planet dropped, empty roster kept honest, mode valid', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  return s.characters.length === 0 && s.charactersDone === false
    && !s.planets.some((p) => p.type === 'Shattered')
    && ['max', 'quota', 'qol', 'compare'].includes(s.mode);
}));

// 4 ── Valid save round trip through the file path.
const good = join('/tmp', 'good-save.json');
writeFileSync(good, JSON.stringify({ solvingPiV9: 1, state: { ...seed, product: 'Robotics', mode: 'max', modeChosen: true } }));
await page.setInputFiles('#loadDataInput', good);
await page.waitForTimeout(600);
check('valid save FILE: loads (product visible in Goal summary)', /Robotics/.test(await page.locator('#sec3').textContent()));

// 5 ── Duplicate planet name via UI, then solve: refusal in words on screen.
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.planets = [
    { name: 'Twin', type: 'Storm', resources: [{ p0: 'Aqueous Liquids', w: 9000 }, { p0: 'Ionic Solutions', w: 9000 }], minimized: false },
    { name: 'Twin', type: 'Gas', resources: [{ p0: 'Aqueous Liquids', w: 9000 }], minimized: false },
    { name: 'B', type: 'Barren', resources: [], minimized: false },
  ];
  s.mode = 'max'; s.modeChosen = true; s.product = 'Coolant';
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
await page.evaluate(() => document.getElementById('stickyCalcBtn')?.click());
await page.waitForTimeout(1200);
const dupMsg = await page.locator('#resultsPanel').textContent();
check('duplicate planet names: refused in words on screen (no crash)',
  pageErrors.length === 0 && /duplicate/i.test(dupMsg ?? ''));
check('refusals: no raw engine codes visible on screen (Engine detail stays tucked)',
  await page.evaluate(() => !/quota-unreachable:|place-extract:|no-capacity-for:|refusing to (value|cost) it silently|missing-price:/.test(document.body.innerText)));
// Review #1: the duplicate is ALSO flagged inline, before any solve.
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
await page.locator('.v9-planet button', { hasText: 'Edit' }).first().click();
await page.waitForTimeout(200);
check('duplicate planet names: inline ⚠ tag on the offending cards',
  await page.locator('.v9-dup-tag').count() >= 2 && await page.locator('input.v9-dup').count() >= 1);
// Review #5: removal is a quiet confirmed ✕, not a labeled pill.
check('remove planet is a small labeled chip with a confirm',
  await page.locator('#v9PlanetList button[title="Remove this planet"]').count() >= 1
  && await page.evaluate(() => {
    const b = document.querySelector('#v9PlanetList button[title="Remove this planet"]');
    return b !== null && /remove planet/i.test(b.textContent) && parseFloat(getComputedStyle(b).fontSize) <= 12;
  }));

// 5b ── Owner spec: a FRESH first visit has ZERO planets; the gate names the
// step, and the first added planet arrives expanded at the 70% defaults.
await page.evaluate(() => localStorage.clear());
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
await page.evaluate((chars) => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state') || 'null');
  // storage may be empty on a fresh visit — merge the mode switch into whatever
  // the app persisted. Characters seeded + done so THIS check isolates the
  // planets gate; 5b2 below wipes them to test the section-2 gate itself.
  localStorage.setItem('solving-pi-v9-state', JSON.stringify({ ...(s || {}), mode: 'max', modeChosen: true, characters: chars, charactersDone: true }));
}, seed.characters);
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
check('fresh default world: ZERO planets, SOLVE gated with "add at least one planet"',
  await page.locator('.v9-planet').count() === 0
  && await page.locator('#stickyCalcBtn[disabled]').count() === 1
  && /add at least one planet/i.test(await page.locator('#stickyCalcInfo').textContent() ?? ''));
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
await page.locator('#sec1 button', { hasText: 'Add planet' }).click();
await page.waitForTimeout(300);
// Owner 2026-09-03: NO default density any more — a planet added before the
// space type is chosen arrives BLANK (empty density fields, awaiting band).
check('added planet: expanded with NO default density (blank until a space type is picked), labeled remove chip, "Complete" box',
  await page.locator('.v9-planet:not(.v9-planet-min)').count() === 1
  && await page.locator('.v9-planet input[placeholder="density %"]').first().inputValue() === ''
  && /remove planet/i.test(await page.locator('button[title="Remove this planet"]').first().textContent() ?? '')
  && /Complete(?!\s*&)/.test(await page.locator('.v9-done').first().textContent() ?? ''));
// Truth audit 2026-09-03: assumed densities exist only AFTER a band pick —
// the gate asks for the space band first (one tap bands every blank density),
// and only then nudges toward prices.
check('fresh default: gate asks for the space band first (assumed densities)',
  /space type/.test(await page.locator('#stickyCalcInfo').textContent() ?? ''));
await page.locator('#sec1 .fin-presets .preset-btn', { hasText: 'Null sec' }).click();
await page.waitForTimeout(300);
check('fresh default: after the band tap, the nudge moves on to prices',
  /Next → Step 3: fetch live Jita prices/.test(await page.locator('#stickyCalcInfo').textContent() ?? ''));
check('band tap banded the blank planet to the null-sec typical (w > 0, marked ~)',
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
    return s.planets[0].resources.every((r) => r.assumed === true && r.w > 0) && s.spaceBand === 'nullsec';
  }));

// 5b2 ── Section 2 gate (owner spec 2026-09-01): empty roster, then the
// reversible Done button.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
  s.characters = []; s.charactersDone = false;
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(s));
});
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
check('empty roster: gate names Step 2, add a character',
  /Next → Step 2: add at least one character/i.test(await page.locator('#stickyCalcInfo').textContent() ?? ''));
// Characters live INSIDE section 2 ("What You Have") now — same card as planets.
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
await page.locator('#sec0Body button', { hasText: 'Create my roster' }).click();
await page.waitForTimeout(250);
check('one character added: gate now asks for the Done press',
  /Done adding characters/.test(await page.locator('#stickyCalcInfo').textContent() ?? ''));
await page.locator('#sec0Body button', { hasText: 'Done adding characters' }).click();
await page.waitForTimeout(250);
check('Done pressed: roster folds to one line and the gate moves on', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('solving-pi-v9-state')).charactersDone === true
  && document.querySelector('#sec0Body table') === null)
  && !/character/.test(await page.locator('#stickyCalcInfo').textContent() ?? ''));
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
await page.locator('#sec0Body button', { hasText: 'Edit characters' }).click();
await page.waitForTimeout(250);
check('reversible: Edit characters reopens the question',
  /Done adding characters/.test(await page.locator('#stickyCalcInfo').textContent() ?? ''));
await page.locator('#sec0Body button', { hasText: 'Done adding characters' }).click();
await page.waitForTimeout(250);

// 5c ── Blur-mid-rerender trap (bug-hunt find): focus a planet-name input,
// then click a control that rerenders. The detached input's blur→change
// handler re-enters rerender(); without the guard, replaceChildren throws.
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
await page.locator('.v9-planet button', { hasText: 'Edit' }).first().click().catch(() => {});
await page.waitForTimeout(200);
const trapInput = page.locator('.v9-planet:not(.v9-planet-min) input.v9-text').first();
if (await trapInput.count()) {
  await trapInput.focus();
  await trapInput.fill('Planet Renamed Mid-Flight');
  await page.evaluate(() => document.querySelector('.v9-planet-min .v9-done input')?.click());
  await page.waitForTimeout(300);
}
check('blur-mid-rerender: no replaceChildren crash (re-entrancy guard)', pageErrors.length === 0);

// 6 ── Rapid goal/product churn: 12 switches, zero errors, pins re-derived.
// Advanced on: the churn block pokes the sourcing panel, which Simple hides.
await page.evaluate((s) => localStorage.setItem('solving-pi-v9-state', JSON.stringify(s)), { ...seed, mode: 'max', modeChosen: true, advancedMode: true });
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
for (const m of ['qol', 'quota', 'max', 'compare', 'max', 'quota']) {
  await page.check(`input[name="v9mode"][value="${m}"]`);
  await page.waitForTimeout(80);
}
for (const prod of ['Robotics', 'Water', 'Broadcast Node', 'Coolant']) {
  await page.selectOption('#sec3 select >> nth=0', prod).catch(() => {});
  await page.waitForTimeout(80);
}
check('rapid goal/product churn: no uncaught errors', pageErrors.length === 0);
await page.click('summary:has-text("Adjust sourcing")');
const churnedPins = await page.locator('details.v9-sourcing select').evaluateAll((els) => els.map((e) => e.value));
check('churn: pins re-derived to mine-it for the final product', churnedPins.length >= 1 && churnedPins.every((v) => v === 'extract'));

// 6b ── Round-4 regression: hand-editing a price must actually TAKE — the
// fetched order-book depth used to shadow the edited bid/ask silently.
await page.evaluate((s) => {
  const st = { ...s, mode: 'max', modeChosen: true };
  st.prices = { ...st.prices };
  st.prices['Water'] = {
    bid: 750, ask: 900,
    bids: [{ price: 750, qty: 1e9 }], asks: [{ price: 900, qty: 1e9 }],
  };
  localStorage.setItem('solving-pi-v9-state', JSON.stringify(st));
}, seed);
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
await page.evaluate(() => document.getElementById('sec2')?.classList.remove('collapsed'));
await page.click('#sec2 summary:has-text("Edit prices & costs by hand")');
const waterRow = page.locator('#sec2 tr', { hasText: 'Water (P1)' }).first();
const bidInput = waterRow.locator('input').first();
await bidInput.fill('1500'); await bidInput.dispatchEvent('change');
await page.waitForTimeout(200);
check('hand-edited bid replaces the quote AND drops the stale depth (edit is never a no-op)',
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('solving-pi-v9-state'));
    const q = s.prices['Water'];
    return q.bid === 1500 && q.bids === undefined && q.asks === undefined;
  }));

// 6c ── Round-4 race guards: async compare completions must never pose as
// current after the world changed, and a superseded solve must never stomp
// a newer mode's answer.
// spaceBand set so the mid-run "+ Add planet" arrives at a band typical and
// the SECOND solve isn't gated on the space-type question.
await page.evaluate((s) => localStorage.setItem('solving-pi-v9-state', JSON.stringify({ ...s, mode: 'compare', modeChosen: true, spaceBand: 'nullsec' })), seed);
await page.reload(); await page.waitForSelector('body[data-smoke="ok"]');
await page.evaluate(() => document.getElementById('stickyCalcBtn')?.click());
// Wait for the in-flight progress paint, then change an input mid-run.
await page.waitForFunction(() => /Ranking products/.test(document.getElementById('resultsPanel')?.textContent ?? ''), { timeout: 60000 });
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
await page.locator('#sec1 button', { hasText: 'Add planet' }).click();
await page.waitForFunction(() => {
  const t = document.getElementById('resultsPanel')?.textContent ?? '';
  return !/^(Solving|Ranking products)/.test(t) && t.length > 0;
}, { timeout: 120000 });
check('race: compare finishing after an input edit renders WITH the stale warning',
  await page.locator('#resultsPanel .v9-stale').count() === 1
  && await page.locator('#resultsPanel table tr').count() > 3);
// Mode switch mid-run: start compare again, immediately switch to max and
// re-solve; the abandoned compare must never overwrite the max verdict.
await page.evaluate(() => document.getElementById('stickyCalcBtn')?.click());
await page.waitForFunction(() => /Solving|Ranking products/.test(document.getElementById('resultsPanel')?.textContent ?? ''), { timeout: 60000 });
await page.evaluate(() => document.getElementById('sec3')?.classList.remove('collapsed'));
await page.check('input[name="v9mode"][value="max"]');
await page.waitForTimeout(150);
await page.evaluate(() => document.getElementById('stickyCalcBtn')?.click());
await page.waitForFunction(() => /building|units\/wk|\/week/.test(document.getElementById('resultsPanel')?.textContent ?? ''), { timeout: 120000 });
await page.waitForTimeout(6000); // give the abandoned compare time to finish (and be discarded)
check('race: abandoned compare never stomps the newer max result',
  await page.evaluate(() => {
    const t = document.getElementById('resultsPanel')?.textContent ?? '';
    return !/Ranking products/.test(t) && !/Plan this/.test(t) && /\/week|units\/wk/.test(t);
  }));

// 7 ── Review screenshots: carbon results, daylight everything, phone width.
await page.evaluate(() => document.getElementById('stickyCalcBtn')?.click());
await page.waitForFunction(() => {
  const p = document.getElementById('resultsPanel');
  return p && p.childElementCount > 0 && !/^(Solving|Ranking products)/.test(p.textContent ?? '');
}, { timeout: 120000 });
await page.screenshot({ path: join(shots, 'carbon-results.png') });
await page.evaluate(() => document.querySelector('[data-set-theme="daylight"]')?.click());
await page.waitForTimeout(500);
check('daylight theme applies (data-theme flips)', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'daylight');
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: join(shots, 'daylight-top.png') });
await page.evaluate(() => document.getElementById('sec1')?.classList.remove('collapsed'));
await page.locator('#sec1').screenshot({ path: join(shots, 'daylight-planets.png') });
await page.locator('#sec3').screenshot({ path: join(shots, 'daylight-goal.png') });
await page.evaluate(() => {
  const p = document.getElementById('resultsPanel');
  if (p) window.scrollTo(0, p.getBoundingClientRect().top + window.scrollY - 60);
});
await page.screenshot({ path: join(shots, 'daylight-results.png') });
check('daylight: gold SOLVE still legible (gradient retained)', await page.evaluate(() => {
  const cs = getComputedStyle(document.getElementById('stickyCalcBtn'));
  return cs.backgroundImage.includes('linear-gradient');
}));
check('no uncaught errors across the whole desktop pass', pageErrors.length === 0);
await page.close();

// ═══ Phone context (the viewport script forces width=1280 scaled) ═════════
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 3 });
const phoneErrors = [];
phone.on('pageerror', (e) => phoneErrors.push(e.message));
await phone.goto(base);
await phone.waitForSelector('body[data-smoke="ok"]', { timeout: 60000 });
await phone.screenshot({ path: join(shots, 'phone-top.png') });
check('phone: renders without errors', phoneErrors.length === 0);
check('phone: desktop-width layout engaged (viewport meta swapped)',
  await phone.evaluate(() => document.getElementById('viewportMeta')?.getAttribute('content')) === 'width=1280');
await phone.close();

await browser.close();
server.close();
console.log(`\nUI EDGE: ${pass} passed, ${fail} failed`);
if (failures.length) { failures.forEach((f) => console.error(' - ' + f)); process.exit(1); }
