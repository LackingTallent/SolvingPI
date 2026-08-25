/* SHELL COSMETICS - EXTRACTED VERBATIM from SolvingPI v8.3.
 * Block 1: src/js/25-theme.js (entire file, lines 1-113) - theme switch, build badge copy, EVE clock.
 * Block 2: src/js/22-panels.js:20-37 - jumpToSection + hero [data-jump] wiring (also dispatches
 *          the "section:expanded" event the lazy reference panels listen for).
 * Block 3: src/js/22-panels.js:560-618 - Contact / Report a Bug (mailto: admin@solvingpi.com).
 * Block 4: src/js/22-panels.js:620-665 - Help modal open/close + pulse-seen flag.
 * The version string itself is a build-time substitution: the HTML ships the literal @build:version
 * inside #buildBadge and the build replaces it (live site shows "v8.0.0 · 632decc+ · 2026-08-25").
 * No edits inside the blocks. */
/* ===================== DISPLAY THEME ===================== */
// Two palettes, both verified so that EVERY text colour clears a contrast
// ratio of at least 8.4:1 against its own background — roughly double the
// WCAG AA minimum of 4.5. The original palette technically passed AA but still
// read as "greyed out", because AA is a legibility floor, not a comfort
// target. Nothing here is dimmer than 8.4. Enforced by tools/verify.js.

const THEME_KEY = 'solvingpi.theme';
const VALID_THEMES = ['carbon', 'daylight'];

/* Persistence is best-effort and must never break the page.
 *
 * An earlier comment here said localStorage was unavailable and the theme was
 * held in memory only. That was true of the original sandbox and is no longer
 * true of the deployed site — the practical effect was that anyone who picked
 * Daylight got Carbon back on every reload.
 *
 * It is still wrapped in try/catch because localStorage genuinely can throw:
 * Safari private browsing, blocked third-party storage, and some browsers on
 * file:// URLs all raise on access rather than returning null. The tool is
 * distributed as a downloadable file, so file:// is a real case, and a theme
 * preference is never worth a broken page. */
function readStoredTheme(){
  try {
    const v = localStorage.getItem(THEME_KEY);
    return VALID_THEMES.includes(v) ? v : null;
  } catch { return null; }
}
function storeTheme(name){
  try { localStorage.setItem(THEME_KEY, name); } catch { /* not fatal */ }
}

function setTheme(name, persist){
  if(!VALID_THEMES.includes(name)) name = 'carbon';
  document.documentElement.setAttribute('data-theme', name);
  document.querySelectorAll('.theme-btn[data-set-theme]').forEach(b=>{
    const on = b.dataset.setTheme === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  if(persist !== false) storeTheme(name);
}

document.querySelectorAll('.theme-btn[data-set-theme]').forEach(b=>{
  b.addEventListener('click', ()=> setTheme(b.dataset.setTheme));
});

/* Startup order: an explicit stored choice wins; otherwise follow the
 * operating system's own light/dark setting; otherwise Carbon. The OS default
 * is not persisted, so the tool keeps following the system until the user
 * actually picks something. */
/* Carbon is THE default, always.
 *
 * This previously read the operating system's light/dark setting and loaded
 * Daylight when the OS was in light mode. That is a reasonable default for a
 * general web page and the wrong one here: the tool is designed dark first,
 * the whole palette and every neon accent is tuned for Carbon, and someone on
 * a light-mode laptop was getting a theme they never asked for.
 *
 * An EXPLICIT choice is still honoured — pick Daylight and it persists across
 * reloads, because silently overriding a deliberate click would be its own
 * bug. Only the OS-derived guess is gone. */
const DEFAULT_THEME = 'carbon';

(function initTheme(){
  const stored = readStoredTheme();
  setTheme(stored || DEFAULT_THEME, false);
})();

/* Build badge: click to copy the version string. Someone filing a bug report
 * should not have to retype it, and the exact build is the single most useful
 * thing they can include. */
(function initBuildBadge(){
  const el = document.getElementById('buildBadge');
  if(!el) return;
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Build version, click to copy');
  const copy = ()=>{
    const text = el.textContent.trim();
    const done = ()=>{
      const orig = el.textContent;
      el.textContent = 'copied';
      el.classList.add('copied');
      setTimeout(()=>{ el.textContent = orig; el.classList.remove('copied'); }, 1400);
    };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(()=>{});
    }
  };
  el.addEventListener('click', copy);
  el.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); copy(); } });
})();

/* ===== EVE TIME CLOCK =====
 * EVE runs on UTC, and every timer, downtime and market snapshot is quoted in
 * it. Rendered from getUTC* rather than a timezone string so it is correct
 * regardless of the viewer's locale or DST, and ticks on a 1s interval aligned
 * to the next whole second so it does not visibly stutter.
 */
(function initEveClock(){
  const el = document.getElementById('eveClockTime');
  if(!el) return;
  const two = n => String(n).padStart(2, '0');
  function tick(){
    const d = new Date();
    el.textContent = two(d.getUTCHours()) + ':' + two(d.getUTCMinutes()) + ':' + two(d.getUTCSeconds());
  }
  tick();
  // Align to the next whole second, then tick once a second from there.
  setTimeout(()=>{ tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
})();

// JITA_REGION_ID is already defined in 01-data.js; reusing it rather than
// shadowing keeps a single source of truth for the region.
function jumpToSection(id){
  const sec = document.getElementById(id);
  if(!sec) return;
  if(typeof setCollapsed === 'function') setCollapsed(sec, false);
  else sec.classList.remove('collapsed');
  sec.scrollIntoView({behavior:'smooth', block:'start'});
  // A brief highlight, so it is obvious WHICH panel the click opened when
  // several sit next to each other.
  sec.classList.add('jump-flash');
  setTimeout(()=> sec.classList.remove('jump-flash'), 1200);
  /* v9: duplicate dispatch removed — setCollapsed (00-shims) already announces
   * 'section:expanded'; dispatching twice double-loaded System Status (audit #6). */
}

document.querySelectorAll('[data-jump]').forEach(btn=>{
  btn.addEventListener('click', ()=> jumpToSection(btn.dataset.jump));
});

/* ===================== CONTACT / BUG REPORT =====================
 *
 * A mailto, built at click time so the body carries the things that make a
 * report actionable: which build, which browser, which mode they were in.
 *
 * "It's broken" with no build number cannot be traced — this project ships
 * several times a day and the bug may already be fixed. Asking a user to find
 * a version string themselves is asking them not to bother.
 *
 * Built on CLICK rather than baked into the href because the goal mode and
 * plan state change as they use the tool, and a report is most useful when it
 * describes the state they were actually in.
 *
 * Nothing personal is collected: no planet names, no system names, no saved
 * data. Just the build, the browser and which mode was selected — and the
 * user sees all of it in their mail client before sending, and can delete any
 * of it.
 */
(function wireContactButtons(){
  if(typeof document === 'undefined') return;
  const ADDRESS = 'admin@solvingpi.com';

  const context = () => {
    const bits = [];
    const badge = document.getElementById('buildBadge');
    bits.push('Build: ' + (badge ? badge.textContent.trim() : 'unknown'));
    /* Guarded: an absent userAgent would otherwise write the literal string
     * "Browser: undefined" into someone's bug report, which reads like the
     * tool is broken before they have described anything. */
    try { if (navigator && navigator.userAgent) bits.push('Browser: ' + navigator.userAgent); }
    catch { /* not worth failing a bug report over */ }
    const plan = document.querySelector('input[name="v9mode"]:checked');
    if(plan) bits.push('Planning mode: ' + plan.value);
    const goal = document.querySelector('input[name="goalMode"]:checked');
    if(goal) bits.push('Goal: ' + goal.value);
    const src = document.querySelector('input[name="sourcingMode"]:checked');
    if(src) bits.push('Sourcing: ' + src.value);
    return bits.join('\n');
  };

  const body = () =>
      'What happened:\n\n\n'
    + 'What you expected instead:\n\n\n'
    + 'Steps to reproduce, if you can:\n1.\n2.\n3.\n\n'
    + '-- technical details, please leave these in --\n'
    + context() + '\n';

  document.querySelectorAll('.report-btn').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.preventDefault();
      const href = 'mailto:' + ADDRESS
        + '?subject=' + encodeURIComponent('Solving PI — bug report')
        + '&body=' + encodeURIComponent(body());
      /* location rather than window.open: a mailto in a new tab leaves an
       * empty tab behind in most browsers. */
      window.location.href = href;
    });
  });
})();

/* ===================== HELP GUIDE =====================
 *
 * The pulse stops permanently once the guide has been opened, remembered in
 * localStorage. An animation that keeps demanding attention from someone who
 * has already read the thing is noise, and noise is how people learn to
 * ignore a UI.
 *
 * It also respects prefers-reduced-motion, handled in CSS: a pulsing button
 * is exactly the kind of thing that hurts to look at for some people.
 */
(function wireHelp(){
  if(typeof document === 'undefined') return;
  const btn = document.getElementById('helpBtn');
  const modal = document.getElementById('helpModal');
  const close = document.getElementById('helpClose');
  if(!btn || !modal || !close) return;

  const SEEN = 'solvingpi.help.seen';
  const seen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return false; } };
  const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* private mode */ } };

  if(seen()) btn.classList.add('is-seen');

  /* Focus moves into the dialog on open and back to the button on close.
   * Without that a keyboard user opens the guide and is still outside it. */
  let lastFocus = null;
  const open = ()=>{
    lastFocus = document.activeElement;
    modal.hidden = false;
    btn.classList.add('is-seen');
    markSeen();
    close.focus();
  };
  const shut = ()=>{
    modal.hidden = true;
    if(lastFocus && lastFocus.focus) lastFocus.focus();
  };

  btn.addEventListener('click', open);
  close.addEventListener('click', shut);
  /* Clicking the backdrop closes; clicking the card must not. */
  modal.addEventListener('click', e=>{ if(e.target === modal) shut(); });
  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape' && !modal.hidden) shut();
  });
})();

/* ---------- Zelle QR modal (carried from v8 24-saveload.js:399-414 verbatim) ----------
 * Missed in the original extraction — the footer button did nothing (audit #3). */
(function initZelleModal(){
  const btn   = document.getElementById('zelleBtn');
  const modal = document.getElementById('zelleModal');
  const close = document.getElementById('zelleClose');
  if(!btn || !modal || !close) return;

  const open = ()=>{ modal.hidden = false; close.focus(); };
  const shut = ()=>{ modal.hidden = true; btn.focus(); };

  btn.addEventListener('click', open);
  close.addEventListener('click', shut);
  modal.addEventListener('click', (e)=>{ if(e.target === modal) shut(); });
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && !modal.hidden) shut();
  });
})();
