#!/usr/bin/env node
/**
 * WALKTHROUGH — a start-to-finish video tour of the app, built from sequenced
 * screenshots (no screen recording): drive the real dist site in headless
 * Chromium, stamp a caption bar per scene, save numbered frames + a duration
 * list, then assemble with ffmpeg (tools/make-video.sh prints the command).
 *
 * Run: node tools/build.mjs && node tools/walkthrough.mjs
 * Output: ../../frames/f##.png + ../../frames/list.txt
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const frames = resolve(here, '..', '..', 'frames');
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const { resourcesOf } = await import(join(dist, 'js/world/planets.js'));
const { SCHEMATICS, tierOf } = await import(join(dist, 'js/spec/schematics.js'));
const { p1InputsOf, oreOf } = await import(join(dist, 'js/engine/chain.js'));
const { wFromDensityPct } = await import(join(dist, 'js/world/density.js'));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(path)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

// Same neutral seed as the UI matrix.
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const tierMid = [6, 550, 9500, 72000, 1350000];
const prices = {};
const allNames = new Set();
for (const name of SCHEMATICS.keys()) {
  allNames.add(name);
  for (const p1 of p1InputsOf(name)) { allNames.add(p1); try { allNames.add(oreOf(p1)); } catch { /* p0 */ } }
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
const seed = {
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
  sellBasis: 'immediate', buyBasis: 'immediate', programHours: 6,
  mode: 'max', modeChosen: false, detailLevel: 'quick', spaceBand: null, costsSource: 'default',
  product: 'Coolant', quotaPerWeek: 5000, qolSessions: 7, sourcingOverrides: {},
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-write'] });
page.on('dialog', (d) => d.accept());

let n = 0;
const list = [];
const problems = [];

async function caption(text, sub = '') {
  await page.evaluate(([t, s]) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div');
      el.id = '__cap';
      el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:2147483647;'
        + 'background:rgba(8,11,16,.94);color:#eef6ff;border:1px solid #37e0ff;border-radius:12px;'
        + 'padding:12px 26px;font:600 19px/1.4 system-ui,Segoe UI,sans-serif;max-width:78%;text-align:center;'
        + 'box-shadow:0 8px 30px rgba(0,0,0,.55)';
      document.body.appendChild(el);
    }
    el.innerHTML = t + (s ? `<div style="font-weight:400;font-size:14px;color:#9fb4c6;margin-top:3px">${s}</div>` : '');
  }, [text, sub]);
}

async function scrollToSel(sel, offset = 70) {
  await page.evaluate(([s, off]) => {
    const el = document.querySelector(s);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - off;
      window.scrollTo(0, Math.max(0, y));
    }
  }, [sel, offset]);
  await page.waitForTimeout(220);
}

async function shot(hold, text, sub) {
  if (text !== undefined) await caption(text, sub);
  n++;
  const f = `f${String(n).padStart(2, '0')}.png`;
  await page.screenshot({ path: join(frames, f) });
  list.push({ f, hold });
  console.log(`frame ${f}  (${hold}s)  ${text ?? ''}`);
}

async function scene(name, fn) {
  try { await fn(); } catch (e) { problems.push(`${name}: ${e.message.split('\n')[0]}`); console.log(`SKIP ${name}: ${e.message.split('\n')[0]}`); }
}

const expand = (id) => page.evaluate((i) => document.getElementById(i)?.classList.remove('collapsed'), id);
const collapse = (id) => page.evaluate((i) => document.getElementById(i)?.classList.add('collapsed'), id);
const solveWait = async () => {
  await page.evaluate(() => document.getElementById('stickyCalcBtn')?.click());
  await page.waitForFunction(() => {
    const p = document.getElementById('resultsPanel');
    return p && p.childElementCount > 0 && !/^Solving/.test(p.textContent ?? '');
  }, { timeout: 120000 });
  await page.waitForTimeout(250);
};

await page.goto(base);
await page.waitForSelector('body[data-smoke="ok"]', { timeout: 60000 });
await page.evaluate((s) => localStorage.setItem('solving-pi-v9-state', JSON.stringify(s)), seed);
await page.reload();
await page.waitForSelector('body[data-smoke="ok"]', { timeout: 60000 });

// ---- Act 1: the goal comes first -----------------------------------------
await scene('intro', async () => {
  await shot(3.5, 'Solving PI — the all-in-one EVE Planetary Industry planner',
    'a start-to-finish tour · build stamped in the top-right corner');
});
await scene('goal-empty', async () => {
  await scrollToSel('#sec3');
  await shot(3.5, 'Step 1 · one question opens the planner: What do you want?',
    'no forms, no numbers — the goal decides everything that appears next');
});
await scene('goal-picked', async () => {
  await page.check('input[name="v9mode"][value="max"]');
  await page.waitForTimeout(250);
  await scrollToSel('#sec3');
  await shot(3.2, 'Pick a goal — only now does a product dropdown appear', 'Compare never shows one: it ranks every product itself');
});
await scene('detail-ladder', async () => {
  await scrollToSel('.v9-detail', 140);
  await shot(3.5, 'The accuracy dial: Quick estimate ⇄ Refined ⇄ Exact',
    'Quick answers instantly with typical stand-ins — always labeled; Exact carries no assumptions');
});
await scene('quick-band', async () => {
  await page.selectOption('#sec3 select >> nth=1', 'nullsec');
  await page.waitForTimeout(300);
  await scrollToSel('.v9-detail', 140);
  await shot(3.2, 'Quick estimate: choose your space — typical densities and costs prefill', 'every assumption is disclosed, nothing is silent');
});
await scene('sourcing', async () => {
  await page.click('summary:has-text("Adjust sourcing")');
  await page.waitForTimeout(250);
  await scrollToSel('details.v9-sourcing', 120);
  await shot(3.5, 'Sourcing is Suggested by default', 'the tool picks extract / refine / buy per input — pin one only to overrule it');
});

// ---- Act 2: the operation -------------------------------------------------
await scene('operation', async () => {
  await expand('sec0');
  await scrollToSel('#sec0');
  await shot(3.2, 'Step 2 · your characters — each one modeled individually', 'own skills, own planet budget; accurate from 1 to 50 characters');
});
await scene('systems', async () => {
  await collapse('sec0');
  await expand('sec1');
  await scrollToSel('#sec1');
  await shot(3.2, 'Step 3 · your systems & planets', 'search any solar system — names, types and resource sets load from ESI');
});
await scene('planets', async () => {
  await scrollToSel('#v9PlanetList', 60);
  await shot(3.2, 'Scan values are yours to enter — or drop in survey screenshots', 'each planet carries exactly its type’s five real resources, never more');
});
await scene('costs', async () => {
  await collapse('sec1');
  await expand('sec2');
  await scrollToSel('#sec2');
  await shot(3.2, 'Step 4 · costs & market', 'one tap fills typical High / Low / Null / Wormhole rates — typical values, not yours, and it says so');
});

// ---- Act 3: solve + results ----------------------------------------------
await scene('solve-quick', async () => {
  await collapse('sec2');
  await solveWait();
  await scrollToSel('#sec4');
  await shot(4, 'Solve — on Quick, the ESTIMATE banner lists every stand-in', 'assumed densities and preset costs, each with where to replace it');
});
await scene('cards', async () => {
  await scrollToSel('#resultsPanel .v9-cards', 90);
  await shot(3.5, 'Output, net, and answer quality', 'small worlds get a provably exact answer; big ones carry a measured optimality bound');
});
await scene('dashboard', async () => {
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('#resultsPanel h3')].find((x) => x.textContent.includes('Plan by character'));
    if (h) window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 60);
  });
  await page.waitForTimeout(200);
  await shot(4, 'The plan, character by character, planet by planet', 'every colony: extractors, factories, launchpads, imports');
});
await scene('template-copy', async () => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.v9-tpl button')][0];
    if (b) { window.scrollTo(0, b.getBoundingClientRect().top + window.scrollY - 300); }
  });
  await page.waitForTimeout(200);
  await shot(3.8, 'Every colony carries a one-click template', 'real community files credited — generated layouts flagged ⚠ verify in game');
});
await scene('ledger', async () => {
  await page.evaluate(() => {
    const s = document.querySelector('details.v9-ledger');
    if (s) { s.open = true; window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY - 80); }
  });
  await page.waitForTimeout(200);
  await shot(3.5, 'One ledger — every ISK reconciles exactly to net', 'customs on real base values, freight on real volume, taxes on your skills');
});
await scene('insights', async () => {
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('#resultsPanel h3')].find((x) => x.textContent === 'Insights');
    if (h) window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 60);
  });
  await page.waitForTimeout(200);
  await shot(3.5, 'Insights: the bottleneck, your runway, what to fix first', 'plus deep analytics — buy-vs-make, marginal character, ISK/week vs ISK/login');
});
await scene('suggestion-card', async () => {
  await page.evaluate(() => {
    const c = document.querySelector('.v9-suggest');
    if (c) window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 80);
  });
  await page.waitForTimeout(200);
  await shot(3.8, 'Sourcing — chosen for you, every choice named with its reason', 'price-compared when quotes exist; your pins are never overruled');
});

// ---- Act 4: the other goals ----------------------------------------------
await scene('quota', async () => {
  await page.check('input[name="v9mode"][value="quota"]');
  await page.waitForTimeout(250);
  await solveWait();
  await scrollToSel('#sec4');
  await shot(3.2, 'Quota goal: the fewest colonies that hit your number', 'an impossible quota refuses by name — and tells you what IS achievable');
});
await scene('qol', async () => {
  await page.check('input[name="v9mode"][value="qol"]');
  await page.waitForTimeout(250);
  await solveWait();
  await scrollToSel('#sec4');
  await shot(3.2, 'Login-budget goal: best net inside your sessions per week', 'the tool picks the extraction cadence that fits your life');
});
await scene('compare', async () => {
  await page.check('input[name="v9mode"][value="compare"]');
  await page.waitForTimeout(250);
  await solveWait();
  await scrollToSel('#sec4');
  await shot(4, 'Compare: every product your operation could make, ranked', 'excluded products are named with reasons — nothing silently dropped');
});
await scene('plan-this', async () => {
  await page.locator('#resultsPanel button', { hasText: 'Plan this' }).first().click();
  await page.waitForFunction(() => /Plan by character/.test(document.getElementById('resultsPanel')?.textContent ?? ''), { timeout: 120000 });
  await page.waitForTimeout(250);
  await scrollToSel('#sec4');
  await shot(4, 'Pick a winner → it is re-solved exactly', 'full plan, colonies, build sheet and analytics for the product you chose');
});

// ---- Act 5: reference + close --------------------------------------------
await scene('market-ref', async () => {
  await expand('secMarket');
  await scrollToSel('#secMarket');
  await page.waitForTimeout(400);
  await shot(3.2, 'Reference: the market grid — all 101 items, live Jita trends', 'hover any item to see which of your planets carry it');
});
await scene('templates-ref', async () => {
  await collapse('secMarket');
  await expand('secTemplates');
  await scrollToSel('#secTemplates');
  await page.waitForTimeout(400);
  await shot(3.2, '199 community PI templates, one click to copy', 'sourced, credited, and importable straight into the game');
});
await scene('outro', async () => {
  await collapse('secTemplates');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await shot(4.5, 'solvingpi.com', 'judge-checked plans · one ledger · answers that carry their honesty with them');
});

// Frame list for ffmpeg concat.
const lines = list.map((x) => `file '${x.f}'\nduration ${x.hold}`);
lines.push(`file '${list[list.length - 1].f}'`); // concat quirk: repeat last frame
writeFileSync(join(frames, 'list.txt'), lines.join('\n') + '\n');

await browser.close();
server.close();
console.log(`\n${n} frames written to ${frames}`);
if (problems.length) { console.log('scenes skipped:'); problems.forEach((p) => console.log(' - ' + p)); }
console.log(`assemble:\n  ffmpeg -y -f concat -safe 0 -i ${frames}/list.txt -vf "format=yuv420p" -movflags +faststart walkthrough.mp4`);
