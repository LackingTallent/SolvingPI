#!/usr/bin/env node
/** Render the closing logo card (1280x720) from the site's own hero logo +
 * fonts: the full brand mark, the wordmark, and the tagline. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// The favicon mark, not the hero logo: the hero SVG colors itself with the
// page's CSS custom properties, which resolve to nothing in a standalone
// document (every shape renders black). The favicon carries literal hex.
const logo = readFileSync(resolve(here, '..', 'dist', 'favicon.svg'), 'utf8');

const page = `
<style>
  body { margin:0; width:1280px; height:720px; background:#05060a; overflow:hidden;
         display:flex; align-items:center; justify-content:center;
         font-family:'DejaVu Sans Mono', ui-monospace, monospace; }
  .halo { position:absolute; width:900px; height:900px; border-radius:50%;
          background:radial-gradient(circle, rgba(55,224,255,.14) 0%, rgba(224,115,255,.07) 38%, transparent 68%); }
  .stars { position:absolute; inset:0; }
  .wrap { position:relative; text-align:center; z-index:2; }
  .wrap svg { width:230px; height:230px; filter:drop-shadow(0 0 34px rgba(55,224,255,.35)); }
  h1 { color:#eaf6ff; font-size:64px; letter-spacing:.14em; margin:26px 0 10px; font-weight:700;
       text-shadow:0 0 26px rgba(55,224,255,.45); }
  h1 b { background:linear-gradient(90deg,#37e0ff,#e073ff); -webkit-background-clip:text; background-clip:text; color:transparent; }
  p { color:#9fb4c6; font-size:27px; letter-spacing:.05em; margin:0; }
</style>
<div class="halo"></div>
<canvas class="stars" id="c" width="1280" height="720"></canvas>
<div class="wrap">${logo}<h1>SOLVING <b>PI</b></h1><p>&hellip;so you don&rsquo;t have to.</p></div>
<script>
  const ctx = document.getElementById('c').getContext('2d');
  let s = 42; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 180; i++) {
    const x = rnd() * 1280, y = rnd() * 720, r = rnd() * 1.3 + .2;
    ctx.fillStyle = 'rgba(210,235,255,' + (rnd() * .7 + .1).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
</script>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await p.setContent(page);
await p.waitForTimeout(400);
await p.screenshot({ path: '/home/claude/rebuild/frames/logo-card.png' });
await browser.close();
console.log('logo card written');
