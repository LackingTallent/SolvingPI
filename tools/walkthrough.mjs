#!/usr/bin/env node
/**
 * WALKTHROUGH — a start-to-finish VIDEO tour of the app: real screen
 * recording of headless Chromium driving the built site, with eased
 * scrolling, a visible animated cursor, and fading captions.
 *
 * Run: node tools/build.mjs && node tools/walkthrough.mjs
 * Output: ../../walkthrough.webm + walkthrough.mp4 (ffmpeg)
 *
 * Everything on screen is the real app; ESI is mocked (sandbox has no EVE
 * network) and the baked map is served TRIMMED to a few real systems per
 * region so the scout finishes in seconds on camera.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const out = resolve(here, '..', '..');
const vidDir = join(out, 'wt-video');
rmSync(vidDir, { recursive: true, force: true });
mkdirSync(vidDir, { recursive: true });

const { resourcesOf } = await import(join(dist, 'js/world/planets.js'));
const { SCHEMATICS, tierOf } = await import(join(dist, 'js/spec/schematics.js'));
const { p1InputsOf, oreOf } = await import(join(dist, 'js/engine/chain.js'));

// --- Trimmed baked map: REAL regions and systems, capped so an on-camera
// scout run finishes fast. -------------------------------------------------
const fullMap = JSON.parse(readFileSync(join(dist, 'map/universe-map.json'), 'utf8'));
const keepRegions = ['The Bleak Lands', 'Heimatar', 'Domain', 'Derelik', 'Metropolis']
  .map((n) => fullMap.regions.find((r) => r.name === n)).filter(Boolean);
// 4 systems per region: the Round-4 economic ranking solves several sourcing
// postures per product per system, so a 6-system compare scout would sit on
// the counter too long for a smooth cut.
const trimmedMap = JSON.stringify({ ...fullMap, regions: keepRegions.map((r) => ({ ...r, systems: r.systems.slice(0, 4) })) });
const scoutSystems = keepRegions.flatMap((r) => r.systems.slice(0, 4));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/map/universe-map.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(trimmedMap); return;
  }
  const path = join(dist, url === '/' ? 'index.html' : url);
  if (!existsSync(path)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

// --- Seed: prices for the whole board (so nothing stalls on camera); the
// operation itself is built ON CAMERA from an empty start. -----------------
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
const seed = {
  characters: [], planets: [], prices,
  priceNote: 'Sample quotes for this walkthrough.',
  fees: { salesTaxPct: 3.375, brokerPct: 1.5, customsPct: 5, hisecNpc: true },
  freight: { outPerM3: 12, inPerM3: 12 },
  sellBasis: 'immediate', buyBasis: 'immediate', programHours: 6,
  mode: 'max', modeChosen: false, charactersDone: false,
  detailLevel: 'quick', autoDetail: true, advancedMode: false,
  spaceBand: null, costsSource: 'user',
  product: 'Coolant', quotaPerWeek: 5000, qolSessions: 7, sourcingOverrides: {},
};

// --- Synthetic-but-plausible ESI answers ----------------------------------
const esiOrders = JSON.stringify([
  { is_buy_order: true, price: 100, volume_remain: 50000, location_id: 60003760 },
  { is_buy_order: false, price: 120, volume_remain: 50000, location_id: 60003760 },
]);
const historyFor = (seedN) => {
  const days = [];
  let p = 800 + (seedN % 900);
  const t0 = Date.now() - 89 * 864e5;
  for (let i = 0; i < 90; i++) {
    p = Math.max(50, p * (1 + Math.sin(i / 9 + seedN) * 0.012 + ((seedN * (i + 3)) % 7 - 3) * 0.004));
    days.push({
      date: new Date(t0 + i * 864e5).toISOString().slice(0, 10),
      average: Math.round(p), highest: Math.round(p * 1.05), lowest: Math.round(p * 0.95),
      volume: 150000 + ((seedN * (i + 1)) % 90) * 4000, order_count: 900 + (i % 50) * 7,
    });
  }
  return JSON.stringify(days);
};
const kills = JSON.stringify(scoutSystems.map((s, i) => ({ system_id: s.id, ship_kills: i % 7 === 0 ? 9 : 0, npc_kills: 40, pod_kills: 0 })));
const jumps = JSON.stringify(scoutSystems.map((s, i) => ({ system_id: s.id, ship_jumps: 20 + (i * 37) % 320 })));

// --- Recorder --------------------------------------------------------------
const W = 1280, H = 800;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: vidDir, size: { width: W, height: H } }, permissions: ['clipboard-read', 'clipboard-write'] });
const t0 = Date.now();
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
await page.route('https://images.evetech.net/**', (r) => r.abort());
await page.route('https://esi.evetech.net/**', (r) => {
  const u = r.request().url();
  let body = esiOrders;
  if (/history/.test(u)) body = historyFor(hash(u) % 1000);
  else if (/system_kills/.test(u)) body = kills;
  else if (/system_jumps/.test(u)) body = jumps;
  else if (/universe\/(ids|names|systems|planets)/.test(u)) body = '{}';
  r.fulfill({ contentType: 'application/json', body });
});

const problems = [];
async function scene(name, fn) {
  try { await fn(); } catch (e) { problems.push(`${name}: ${e.message.split('\n')[0]}`); console.log(`SKIP ${name}: ${e.message.split('\n')[0]}`); }
}
const wait = (s) => page.waitForTimeout(s * 1000);

// Cinematic layer: cursor + captions, injected into the live page.
async function injectChrome() {
  await page.evaluate(() => {
    if (document.getElementById('__cur')) return;
    const cur = document.createElement('div');
    cur.id = '__cur';
    cur.style.cssText = 'position:fixed;left:640px;top:400px;width:26px;height:26px;z-index:2147483646;'
      + 'border:2.5px solid #22e8ff;border-radius:50%;background:rgba(34,232,255,.15);pointer-events:none;'
      + 'box-shadow:0 0 12px rgba(34,232,255,.5);transform:translate(-50%,-50%);'
      + 'transition:left .8s cubic-bezier(.22,.61,.36,1),top .8s cubic-bezier(.22,.61,.36,1)';
    document.body.appendChild(cur);
    const cap = document.createElement('div');
    cap.id = '__cap';
    cap.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:110px;z-index:2147483647;'
      + 'background:rgba(5,6,10,.92);color:#eef6ff;border:1px solid #22e8ff;border-radius:12px;'
      + 'padding:13px 28px;font:600 20px/1.4 Inter,system-ui,sans-serif;max-width:76%;text-align:center;'
      + 'box-shadow:0 8px 30px rgba(0,0,0,.6);opacity:0;transition:opacity .4s';
    document.body.appendChild(cap);
    const st = document.createElement('style');
    st.textContent = '@keyframes __pulse{0%{box-shadow:0 0 0 0 rgba(34,232,255,.7)}100%{box-shadow:0 0 0 26px rgba(34,232,255,0)}}';
    document.head.appendChild(st);
    // Dip-to-void fader: every hard layout change (section fold, view swap,
    // tab switch) hides behind a soft fade instead of an on-camera blink.
    const fade = document.createElement('div');
    fade.id = '__fade';
    fade.style.cssText = 'position:fixed;inset:0;background:#05060a;opacity:0;pointer-events:none;'
      + 'z-index:2147483645;transition:opacity .34s ease';
    document.body.appendChild(fade);
  });
}
/** Fade to the void, perform the (instant, ugly) layout change, fade back —
 * the shot-to-shot transition is a glide, never a blink. */
async function dip(action, { fadeMs = 340, hold = 0.12 } = {}) {
  await page.evaluate((ms) => {
    const f = document.getElementById('__fade');
    if (f) { f.style.transitionDuration = ms + 'ms'; f.style.opacity = '1'; }
  }, fadeMs);
  await wait(fadeMs / 1000 + 0.06);
  await action();
  await wait(hold);
  await page.evaluate((ms) => {
    const f = document.getElementById('__fade');
    if (f) { f.style.transitionDuration = Math.round(ms * 1.25) + 'ms'; f.style.opacity = '0'; }
  }, fadeMs);
  await wait(fadeMs / 1000 * 1.25 + 0.08);
}
/** Instant reposition, meant to run behind a dip. */
async function jumpTo(sel, offset = 80) {
  await page.evaluate(([s, off]) => {
    const el = document.querySelector(s);
    if (el) window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - off));
  }, [sel, offset]);
}
async function caption(text, sub = '') {
  await page.evaluate(([t, s]) => {
    const el = document.getElementById('__cap');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => {
      el.innerHTML = t + (s ? `<div style="font-weight:400;font-size:15px;color:#9fb4c6;margin-top:4px">${s}</div>` : '');
      el.style.opacity = '1';
    }, 380);
  }, [text, sub]);
  await wait(0.55);
}
async function captionOff() {
  await page.evaluate(() => { const el = document.getElementById('__cap'); if (el) el.style.opacity = '0'; });
  await wait(0.4);
}
// Eased scroll so the recording glides instead of jumping.
async function glideTo(sel, offset = 90, ms = 1150) {
  await page.evaluate(async ([s, off, dur]) => {
    const el = document.querySelector(s);
    if (!el) return;
    const target = Math.max(0, el.getBoundingClientRect().top + window.scrollY - off);
    const from = window.scrollY;
    await new Promise((done) => {
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        window.scrollTo(0, from + (target - from) * e);
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  }, [sel, offset, ms]);
  await wait(0.25);
}
// Eased RELATIVE pan — for slowly walking down long content (plan cards,
// the ledger) without retargeting an element.
async function glideBy(px, ms = 1400) {
  await page.evaluate(async ([dy, dur]) => {
    const from = window.scrollY;
    await new Promise((done) => {
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        window.scrollTo(0, from + dy * e);
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  }, [px, ms]);
  await wait(0.2);
}
// Move the visible cursor to an element, pulse, then really click it.
async function cine(sel, { click = true, nth = 0 } = {}) {
  const loc = page.locator(sel).nth(nth);
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no box for ${sel}`);
  const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 40);
  await page.evaluate(([px, py]) => {
    const c = document.getElementById('__cur');
    if (c) { c.style.left = px + 'px'; c.style.top = py + 'px'; }
  }, [x, y]);
  await wait(0.75);
  if (click) {
    await page.evaluate(() => {
      const c = document.getElementById('__cur');
      if (c) { c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '__pulse .5s ease-out'; }
    });
    await wait(0.15);
    await loc.click();
  }
}
const solveWait = async () => {
  await page.waitForFunction(() => {
    const p = document.getElementById('resultsPanel');
    return p && p.childElementCount > 0 && !/^(Solving|Ranking products)/.test(p.textContent ?? '');
  }, { timeout: 120000 });
  await wait(0.4);
};

// ---------------------------------------------------------------------------
await page.goto(base);
await page.waitForSelector('body[data-smoke="ok"]', { timeout: 60000 });
await page.evaluate((s) => localStorage.setItem('solving-pi-v9-state', JSON.stringify(s)), seed);
await page.reload();
await page.waitForSelector('body[data-smoke="ok"]', { timeout: 60000 });
// Pre-warm the reference library OFF CAMERA (this stretch is trimmed from the
// final cut): expanding each section kicks off its lazy data loads, so the
// on-camera tour later shows charts and trends, not spinners.
await page.evaluate(() => {
  document.getElementById('viewReference')?.click();
  for (const id of ['secChains', 'secMarket', 'secPrices', 'secTemplates']) {
    const sec = document.getElementById(id);
    if (sec?.classList.contains('collapsed')) sec.querySelector('.collapse-btn')?.click();
  }
});
await wait(4);
await page.evaluate(() => {
  for (const id of ['secChains', 'secMarket', 'secPrices', 'secTemplates']) {
    const sec = document.getElementById(id);
    if (sec && !sec.classList.contains('collapsed')) sec.querySelector('.collapse-btn')?.click();
  }
  document.getElementById('viewPlanner')?.click();
  window.scrollTo(0, 0);
});
await wait(0.5);
const cutAt = ((Date.now() - t0) / 1000).toFixed(2);
await injectChrome();
await wait(0.6);

// ---- Act 1 · Welcome ------------------------------------------------------
await scene('intro', async () => {
  await caption('Solving PI — plan your EVE Planetary Industry empire',
    'a full tour: build an operation, solve it, read the plan, browse the references');
  await wait(2.0);
  await caption('Four steps, top to bottom — the bar at the bottom always names your next one',
    'no login, no API keys; everything stays in your browser');
  await wait(2.1);
  await captionOff();
});

// ---- Act 2 · Step 1: the goal --------------------------------------------
await scene('goal', async () => {
  await glideTo('#sec3', 70);
  await caption('Step 1 · pick a goal — one card each, plain words',
    'not sure what to make? Compare ranks every product by profit');
  await wait(1.0);
  await cine('label.v9-gcard:has(input[value="compare"])');
  await wait(1.2);
  await captionOff();
  await cine('#sec3 .v9-next');
  await dip(async () => { await jumpTo('#sec1', 70); });
});

// ---- Act 3 · Step 2: characters + planets --------------------------------
await scene('characters', async () => {
  await caption('Step 2 · your characters', 'type a number — a full roster appears with maxed skills, each character modeled individually');
  const num = page.locator('#sec0Body .v9-quickadd input');
  await num.fill('3');
  await num.dispatchEvent('change');
  await wait(0.7);
  await cine('#sec0Body button:has-text("Create my roster")');
  await wait(1.4);
  await caption('Fix any skills that differ, then confirm', 'the roster folds away to one quiet line');
  await cine('#sec0Body button:has-text("Done adding characters")');
  await dip(async () => {}, { fadeMs: 240, hold: 0.05 });
  await wait(0.5);
  await captionOff();
});

await scene('scout', async () => {
  await glideTo('#sec1Choice', 120);
  await caption('No home yet? The Region Scout finds you one', 'press “Find me a home” and pick any region of New Eden');
  await cine('#chooseScout');
  await wait(1.2);
  await page.selectOption('#scoutPanel select', { label: 'The Bleak Lands' });
  await wait(0.7);
  await cine('#scoutPanel button:has-text("Scout this region")');
  await page.waitForFunction(() => document.querySelectorAll('#scoutPanel table tr').length >= 3, { timeout: 90000 });
  await caption('Every system ranked for YOUR goal — real planet types, real security',
    'the traffic column shows last-hour danger; numbers are estimates until you scan');
  await glideTo('#scoutPanel table', 160);
  await wait(2.4);
  await caption('One press moves in', 'the winner’s real planets drop into your planner at their own space type’s typical density (marked ~)');
  await cine('#scoutPanel table button:has-text("Load planets")');
  await dip(async () => { await jumpTo('#v9PlanetList', 100); });
  await captionOff();
});

await scene('planets', async () => {
  await caption('Your planets, as chip cards', 'click any resource chip and type your scan’s real density % — your numbers drive every calculation');
  await wait(0.8);
  await cine('#v9PlanetList .v9-reschip');
  await wait(2.0);
  await captionOff();
});

// ---- Act 4 · Step 3: market ----------------------------------------------
await scene('band', async () => {
  await glideTo('#sec1 .fin-presets', 200);
  // Band-first flow: the scout's Load-planets already set the space type
  // from the system's own security — this scene shows it can be ADJUSTED
  // any time, and that one tap re-aligns every unscanned density.
  await caption('“Where do you operate?” — change it any time, one tap does three jobs', 'your taxes, your shipping AND typical densities for every planet you haven’t scanned (marked ~)');
  await wait(1.1);
  await cine('#sec1 .fin-presets .preset-btn >> nth=2');
  await wait(2.0);
  await captionOff();
  await glideTo('#sec1 .v9-next', 260, 900);
  await cine('#sec1 .v9-next');
  await dip(async () => { await jumpTo('#sec2', 70); });
});

await scene('market', async () => {
  await caption('Step 3 · the market runs itself', 'live Jita prices fetch and refresh themselves — quotes you type by hand are never overwritten');
  await wait(2.0);
  await captionOff();
  await cine('#sec2 .v9-next');
  await dip(async () => { await jumpTo('#sec4', 70); });
});

// ---- Act 5 · SOLVE + results ---------------------------------------------
await scene('solve', async () => {
  await caption('Press the gold SOLVE', 'Compare now ranks every product your operation could make');
  await cine('#stickyCalcBtn');
  await solveWait();
  await glideTo('#sec4', 70);
  await wait(1.0);
  await caption('The full ranking — profit per week, per product', 'excluded products are named with reasons; nothing is silently dropped');
  await glideTo('#resultsPanel table', 150);
  await wait(2.5);
  await caption('Pick a winner and it is re-solved exactly', 'press “Plan this →” for the full plan');
  await cine('#resultsPanel button:has-text("Plan this")');
  await page.waitForFunction(() => /Plan by character|ISK\/week/.test(document.getElementById('resultsPanel')?.textContent ?? ''), { timeout: 120000 });
  await dip(async () => { await jumpTo('#sec4', 70); });
  await captionOff();
});

await scene('verdict', async () => {
  await caption('The answer comes first — one verdict card', 'your ISK per week — and on assumed densities, the honest low-to-high range beneath it');
  await wait(2.6);
  await captionOff();
});

// ---- The plan, planet by planet ------------------------------------------
await scene('plan-tour', async () => {
  await caption('The plan, planet by planet', 'every character’s colonies dealt for them — extractors, factories, launchpads, imports');
  await glideTo('.v9-char-grid', 110, 1400);
  await wait(2.2);
  await glideBy(360, 1500);
  await wait(1.7);
  await captionOff();
  await caption('Each colony carries a one-click template', 'copy, open the planet in game, press Import — built exactly as planned');
  const copyBtn = page.locator('.v9-tpl button:has-text("Copy template")').first();
  const hasTpl = await copyBtn.count() > 0;
  if (hasTpl) {
    await copyBtn.scrollIntoViewIfNeeded();
    await wait(0.5);
    await cine('.v9-tpl button:has-text("Copy template")');
    await wait(1.9);
  }
  await captionOff();
  await caption('…and the whole operation as one build sheet', 'paste it into your notes; check colonies off as you build');
  await glideTo('.v9-template', 150, 1300);
  await wait(2.2);
  await captionOff();
});

// ---- Money: capital, then the ledger open ---------------------------------
await scene('money-tour', async () => {
  await dip(async () => {
    await page.locator('.v9-tab:has-text("Money")').first().click();
    await jumpTo('.v9-tabbar', 120);
  }, { fadeMs: 240, hold: 0.06 });
  await caption('Money — the net, the setup cost, and how fast it pays back', 'steady-state ISK per week up top; the one-time capital beside it');
  await wait(2.1);
  await glideTo('.v9-capital', 160, 1200);
  await wait(1.7);
  await captionOff();
  await caption('Open the ledger — every ISK, line by line', 'customs, freight, taxes, broker fees; it reconciles exactly to the net');
  await cine('.v9-ledger summary');
  await wait(0.8);
  await glideTo('.v9-ledger table', 150, 1200);
  await wait(1.5);
  await glideBy(420, 1700);
  await wait(1.3);
  await glideBy(420, 1700);
  await wait(0.9);
  await captionOff();
});

await scene('why-beat', async () => {
  await dip(async () => {
    await page.locator('.v9-tab:has-text("Why")').first().click();
    await jumpTo('.v9-tabbar', 120);
  }, { fadeMs: 240, hold: 0.06 });
  await caption('Why — the bottleneck and every choice, each with its reason', 'the answer carries its own quality certificate; your pins are never overruled');
  await wait(2.3);
  await captionOff();
});

// ---- Act 6 · References ---------------------------------------------------
await scene('reference', async () => {
  await glideTo('#viewToggle', 200);
  await caption('One more lens: REFERENCE', 'the planner steps swap for the reference library — same page, two views');
  await cine('#viewReference', { click: false });
  await dip(async () => {
    await page.locator('#viewReference').click();
    // Open the first reference shot inside the SAME dip — one glide, not two.
    await page.evaluate(() => {
      const c = document.getElementById('secChains');
      if (c?.classList.contains('collapsed')) c.querySelector('.collapse-btn')?.click();
    });
    await jumpTo('#secChains', 70);
  });
  await captionOff();
});

// Each reference section is its own "shot": the previous one folds and the
// next opens BEHIND a dip, so the cut is a glide — never an on-camera snap.
const refShot = (prevId, id, title, sub, hold = 3.2) => scene(`ref-${id}`, async () => {
  if (prevId !== null) {
    await dip(async () => {
      await page.evaluate(([prev, cur]) => {
        const p = document.getElementById(prev);
        if (p && !p.classList.contains('collapsed')) p.querySelector('.collapse-btn')?.click();
        const c = document.getElementById(cur);
        if (c?.classList.contains('collapsed')) c.querySelector('.collapse-btn')?.click();
      }, [prevId, id]);
      await jumpTo(`#${id}`, 70);
    });
  }
  await caption(title, sub);
  await wait(hold);
  await captionOff();
});

await refShot(null, 'secChains', 'All PI Visualized — any commodity’s entire chain, drawn', 'pick a product; every input from raw P0 to the final factory, with quantities', 3.0);
await refShot('secChains', 'secRecipe', 'Recipe Calculator — exact inputs, costs and build time for any batch', 'or paste your hangar and it tells you what you can build from it', 3.0);
await refShot('secRecipe', 'secMarket', 'Market Reference — live Jita prices for all 101 PI items', 'sortable, searchable, with trend arrows', 2.8);
await refShot('secMarket', 'secPrices', 'Price History — the same prices, charted over time', 'spot the seasonal swings before you commit ISK', 2.8);
await refShot('secPrices', 'secTemplates', 'PI Templates — ready-made colony layouts', 'copy one, paste it straight into the game', 2.8);

// ---- Outro ----------------------------------------------------------------
await scene('outro', async () => {
  await dip(async () => {
    await page.evaluate(() => {
      const t = document.getElementById('secTemplates');
      if (t && !t.classList.contains('collapsed')) t.querySelector('.collapse-btn')?.click();
      document.getElementById('viewPlanner')?.click();
    });
  });
  await page.evaluate(() => {
    const from = window.scrollY;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1200);
      const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      window.scrollTo(0, from * (1 - e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await wait(1.6);
  await caption('solvingpi.com', 'free · no login · your data never leaves your browser — fly safe o7');
  await wait(2.9);
  await captionOff();
  await wait(0.6);
});

const video = page.video();
await ctx.close();
const webmSrc = await video.path();
await browser.close();
server.close();

const webm = join(out, 'walkthrough.webm');
copyFileSync(webmSrc, webm);
rmSync(vidDir, { recursive: true, force: true });
const mp4 = join(out, 'walkthrough.mp4');
execFileSync('ffmpeg', ['-y', '-i', webm, '-ss', String(cutAt), '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
  '-vf', 'format=yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
console.log(`\nvideo: ${mp4}`);
if (problems.length) { console.log('scenes skipped:'); problems.forEach((p) => console.log(' - ' + p)); }
