/* v9 shims for the carried-over v8.3 skin modules. Loads FIRST.
 * Provides the handful of globals the v8 feature files consume that used to
 * live in engine modules we did not carry (17-sourcing, 15-engine,
 * 06-economics, 14-finance) — each verbatim where possible, with provenance.
 * The v9 engine itself is a separate ES-module world; the only bridge is
 * window.__v9, defined by js/ui/app.js. */

/* escapeHtml — lifted from 23-screenshot.js:42 so every feature file can use
 * it regardless of load order (it was hoisted in the v8 concat build). */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* Verbatim from 14-finance.js:101,114 */
const TIER_VOLUMES = { p0:0.005, p1:0.19, p2:0.75, p3:3, p4:50 };
const INDIVIDUALLY_VERIFIED_VOLUME = new Set([
  'Aqueous Liquids','Noble Metals',
  'Water',
  'Oxides','Nanites',
  'Condensates','Neocoms','Data Chips','High-Tech Transmitters',
  'Organic Mortar Applicators','Sterile Conduits','Nano-Factory',
  'Self-Harmonizing Power Core','Recursive Computing Module','Broadcast Node',
  'Integrity Response Drones','Wetware Mainframe',
]);

/* tierOf equivalent, self-contained over 01-data.js tables (v8's lived in an
 * engine module). Returns 'p0'..'p4' or null. */
function v9TierKey(name){
  if (typeof P0_TO_P1 !== 'undefined'){
    if (name in P0_TO_P1) return 'p0';
    for (const p1 of Object.values(P0_TO_P1)) if (p1 === name) return 'p1';
  }
  if (typeof RECIPES_P2 !== 'undefined' && name in RECIPES_P2) return 'p2';
  if (typeof RECIPES_P3 !== 'undefined' && name in RECIPES_P3) return 'p3';
  if (typeof RECIPES_P4 !== 'undefined' && name in RECIPES_P4) return 'p4';
  return null;
}

/* volumeOf — same fallback chain as 06-economics.js:116 */
function volumeOf(name){
  const tier = v9TierKey(name);
  if (tier) return TIER_VOLUMES[tier];
  if (typeof COMPOSITE_RECIPES !== 'undefined' && COMPOSITE_RECIPES[name] != null)
    return COMPOSITE_RECIPES[name].volume;
  if (typeof NON_PI_VOLUMES !== 'undefined' && NON_PI_VOLUMES[name] != null)
    return NON_PI_VOLUMES[name];
  return null;
}

/* Collapse machinery — v8's lived in 17-sourcing.js. Same contract:
 * .collapsed on the <section class="card">, CustomEvent 'section:expanded'
 * dispatched ON THE SECTION when it opens (the reference panels lazy-load off
 * that event, per shell.js jumpToSection). */
function setCollapsed(section, collapsed){
  if (!section) return;
  section.classList.toggle('collapsed', !!collapsed);
  if (!collapsed) section.dispatchEvent(new CustomEvent('section:expanded'));
}
document.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('.collapse-btn[data-target]') : null;
  if (!btn) return;
  const section = document.getElementById(btn.dataset.target);
  if (section) setCollapsed(section, !section.classList.contains('collapsed'));
});

/* readPlanets — used by the market-reference hover popup (v8's read the DOM
 * planet list; v9's planets live in the app state behind the bridge). */
function readPlanets(){
  try {
    return (window.__v9 && window.__v9.readPlanets) ? window.__v9.readPlanets() : [];
  } catch { return []; }
}
