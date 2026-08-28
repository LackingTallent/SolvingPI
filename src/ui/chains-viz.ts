/**
 * ALL PI CHAINS FLOW VISUALIZATION TOOL — the Reference section's selectable
 * chain visualizer (owner-picked from the Chain Atlas lookbook, Plate 00).
 *
 * Pick any commodity → its full P0→P4 production DAG renders in one of four
 * layouts (Ladder / River / Radial / Planet lanes); every node is clickable
 * (re-roots the diagram), hover lights the branch, and a "planets needed" row
 * computes the smallest planet-type set covering all the chain's ores.
 *
 * Data comes straight from src/spec (schematics) and src/world (spawn
 * tables) — nothing here restates a game number. Icons are the REAL
 * in-game ones, loaded in the viewer's browser from CCP's image server via
 * the verified TYPE_IDS table the Market Reference already uses; drawn
 * schematic-style glyphs render instantly and remain as the offline
 * fallback (ICON_IMG stays available as a manual per-name override).
 */
import { SCHEMATICS, PLANET_TYPES, type PlanetType } from '../spec/schematics.js';
import { TIER_VOLUME_M3, type Tier } from '../spec/constants.js';
import { resourcesOf } from '../world/planets.js';
import type { UiQuote } from './state.js';

interface VizItem { tier: number; outQty: number; inputs: Readonly<Record<string, number>> }

const ITEMS: Record<string, VizItem> = {};
const P0P: Record<string, PlanetType[]> = {};
(function buildData(): void {
  for (const [name, s] of SCHEMATICS) ITEMS[name] = { tier: s.tier, outQty: s.outQty, inputs: s.inputs };
  for (const it of Object.values(ITEMS)) {
    for (const k of Object.keys(it.inputs)) if (ITEMS[k] === undefined) ITEMS[k] = { tier: 0, outQty: 0, inputs: {} };
  }
  for (const t of PLANET_TYPES) for (const r of resourcesOf(t)) (P0P[r] ??= []).push(t);
})();

const TIER_C = ['var(--vzt0)', 'var(--vzt1)', 'var(--vzt2)', 'var(--vzt3)', 'var(--vzt4)'];
const TIER_NAME = ['P0 raw (extracted)', 'P1 processed', 'P2 refined', 'P3 specialized', 'P4 advanced'];

/* Real in-game icons, from the same CCP image server + verified TYPE_IDS
 * table the Market Reference already uses (legacy/01-data.js globals —
 * classic scripts load before this module). Icons preload in the
 * background; tiles render the drawn schematic-style glyph instantly and
 * upgrade in place when the real icon arrives, so the tool works offline
 * and never waits on the CDN. ICON_IMG remains a manual override. */
declare function iconUrl(name: string, size?: number): string;
declare function planetIconUrl(type: string, size?: number): string;
const ICON_IMG: Record<string, string> = {};
const iconReady = new Set<string>();   // keys: commodity name, or "planet:<Type>"
const iconFailed = new Set<string>();
let rerenderViz: (() => void) | null = null;
let upgradeQueued = false;
function scheduleUpgrade(): void {
  if (upgradeQueued) return;
  upgradeQueued = true;
  requestAnimationFrame(() => { upgradeQueued = false; rerenderViz?.(); });
}
function cdnUrl(name: string): string {
  const override = ICON_IMG[name];
  if (override !== undefined) return override;
  try { return typeof iconUrl === 'function' ? iconUrl(name, 64) : ''; } catch { return ''; }
}
function planetCdnUrl(type: string): string {
  try { return typeof planetIconUrl === 'function' ? planetIconUrl(type, 64) : ''; } catch { return ''; }
}
function preload(key: string, url: string): void {
  if (url === '' || iconReady.has(key) || iconFailed.has(key)) return;
  const img = new Image();
  img.onload = () => { iconReady.add(key); scheduleUpgrade(); };
  img.onerror = () => { iconFailed.add(key); };
  img.src = url;
}
function preloadAllIcons(): void {
  for (const name of Object.keys(ITEMS)) preload(name, cdnUrl(name));
  for (const t of PLANET_TYPES) preload(`planet:${t}`, planetCdnUrl(t));
}

function glyphFor(name: string): string {
  const n = name.toLowerCase();
  if (/liquid|water|oxygen/.test(n)) return 'drop';
  if (/metal|aluminum/.test(n)) return 'ingot';
  if (/gas|gases/.test(n)) return 'swirl';
  if (/organism|bacteria|biomass|planktic|proteins|livestock/.test(n)) return 'cell';
  if (/fuel|oxidiz|coolant/.test(n)) return 'flame';
  if (/electrolyt|ionic|plasma|superconduct/.test(n)) return 'bolt';
  if (/silicon|chiral|crystal|transparent|rocket/.test(n)) return 'crystal';
  if (/circuit|electron|processor|transmitter|data|guidance|broadcast|neural|supercomput|mainframe/.test(n)) return 'chip';
  if (/mechanical|construction|tool|hardware|structur|fiber|blocks|autonomous|wetware|industrial|factory/.test(n)) return 'gear';
  if (/consumer|luxury|goods|holo|entertainment/.test(n)) return 'box';
  if (/robot|drone|camera|sensor|cybernetic/.test(n)) return 'bot';
  if (/vaccin|medical|biotech|test|gel|spores|seeds|genetic|organic/.test(n)) return 'flask';
  return 'dot';
}
const GLYPH: Record<string, string> = {
  drop: '<path d="M12 4c3 4.4 5.5 7.2 5.5 10a5.5 5.5 0 1 1-11 0C6.5 11.2 9 8.4 12 4z" fill="FG" opacity=".9"/>',
  ingot: '<path d="M6 15l2-6h8l2 6z" fill="FG" opacity=".9"/><path d="M6 15h12" stroke="FG" stroke-width="1.4"/>',
  swirl: '<path d="M5 10c4-2 10-2 14 0M5 14c4-2 10-2 14 0M7 18c3.4-1.6 6.6-1.6 10 0" stroke="FG" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  cell: '<circle cx="12" cy="12" r="6" fill="none" stroke="FG" stroke-width="1.6"/><circle cx="10.5" cy="11" r="1.7" fill="FG"/><circle cx="14.2" cy="14" r="1.1" fill="FG"/>',
  flame: '<path d="M12 4c1 3-3 4.5-2 8a4.7 4.7 0 0 0 9-1c0-2-1.4-3.2-2.4-4.6C15.5 8.6 15 10 13.6 10 12 10 11.5 6.5 12 4z" fill="FG" opacity=".9" transform="translate(-1.5 1)"/>',
  bolt: '<path d="M13.5 4L7 13h4l-1.5 7L16 11h-4l1.5-7z" fill="FG" opacity=".92"/>',
  crystal: '<path d="M12 4l5 6-5 10L7 10z" fill="FG" opacity=".55"/><path d="M12 4l5 6-5 10L7 10z" fill="none" stroke="FG" stroke-width="1.3"/><path d="M12 4v16" stroke="FG" stroke-width="1" opacity=".7"/>',
  chip: '<rect x="8" y="8" width="8" height="8" rx="1.2" fill="none" stroke="FG" stroke-width="1.6"/><path d="M10 8V5.4M14 8V5.4M10 18.6V16M14 18.6V16M8 10H5.4M8 14H5.4M18.6 10H16M18.6 14H16" stroke="FG" stroke-width="1.4"/><rect x="10.6" y="10.6" width="2.8" height="2.8" fill="FG"/>',
  gear: '<circle cx="12" cy="12" r="3" fill="none" stroke="FG" stroke-width="1.6"/><path d="M12 5.2v2.4M12 16.4v2.4M5.2 12h2.4M16.4 12h2.4M7.2 7.2l1.7 1.7M15.1 15.1l1.7 1.7M16.8 7.2l-1.7 1.7M8.9 15.1l-1.7 1.7" stroke="FG" stroke-width="1.7" stroke-linecap="round"/>',
  box: '<path d="M6 9l6-3.4L18 9v6l-6 3.4L6 15z" fill="none" stroke="FG" stroke-width="1.5"/><path d="M6 9l6 3.4L18 9M12 12.4v6" stroke="FG" stroke-width="1.2"/>',
  bot: '<rect x="7.4" y="8.4" width="9.2" height="7.4" rx="2" fill="none" stroke="FG" stroke-width="1.6"/><circle cx="10.4" cy="12" r="1.15" fill="FG"/><circle cx="13.7" cy="12" r="1.15" fill="FG"/><path d="M12 8.4V5.8M10 18.4v-2.6M14 18.4v-2.6" stroke="FG" stroke-width="1.5"/>',
  flask: '<path d="M10.4 5h3.2M11 5v4.4L7.4 16a2.4 2.4 0 0 0 2.2 3.4h4.8a2.4 2.4 0 0 0 2.2-3.4L13 9.4V5" fill="none" stroke="FG" stroke-width="1.5"/><path d="M9 14.5h6" stroke="FG" stroke-width="1.4"/>',
  dot: '<circle cx="12" cy="12" r="4.5" fill="FG" opacity=".85"/>',
};
let clipSeq = 0;
function iconSvg(name: string, size: number): string {
  const it = ITEMS[name]!;
  const c = TIER_C[it.tier]!;
  const url = cdnUrl(name);
  const tid = /types\/(\d+)\//.exec(url)?.[1] ?? '';
  // Tier-colored tile frame always; the real in-game icon fills it once
  // loaded, the drawn glyph stands in until then (and forever, offline).
  let inner: string;
  if (url !== '' && iconReady.has(name)) {
    const cid = `vzc${clipSeq++}`;
    inner = `<clipPath id="${cid}"><rect x="2.6" y="2.6" width="18.8" height="18.8" rx="3.6"/></clipPath><image href="${url}" x="2.6" y="2.6" width="18.8" height="18.8" clip-path="url(#${cid})" preserveAspectRatio="xMidYMid meet"/>`;
  } else {
    inner = GLYPH[glyphFor(name)]!.replaceAll('FG', c);
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" class="vz-tile" data-icn="${name}" data-tid="${tid}"><rect x="1.2" y="1.2" width="21.6" height="21.6" rx="5" fill="var(--vztile)" stroke="${c}" stroke-width="1.6"/>${inner}</svg>`;
}
const PLANET_BASE: Record<PlanetType, string> = {
  Barren: '#b59a6f', Gas: '#d99a4e', Ice: '#bcd8e8', Lava: '#8a4636',
  Oceanic: '#3d7cb0', Plasma: '#7a4a9e', Storm: '#6a5a8e', Temperate: '#4d9668',
};
const PLANET_MOTIF: Record<PlanetType, string> = {
  Barren: '<circle cx="9" cy="10" r="1.6" fill="#8a7350"/><circle cx="14.5" cy="14" r="2.1" fill="#8a7350"/>',
  Gas: '<path d="M4.5 10h15M4.8 13.4h14.4M6 16.4h12" stroke="#a86f2c" stroke-width="1.5"/>',
  Ice: '<path d="M8 9l8 6M16 9l-8 6M12 7.5v9" stroke="#7fa8c4" stroke-width="1.1"/>',
  Lava: '<path d="M6 13c2-2 4 1 6-1s4 0 6-1" stroke="#e86a3a" stroke-width="1.6" fill="none"/>',
  Oceanic: '<path d="M5.5 12c2 1.4 4-1.4 6 0s4-1.4 7 0" stroke="#8fc6e8" stroke-width="1.4" fill="none"/>',
  Plasma: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="#c99ae8" stroke-width="1.2" opacity=".8"/>',
  Storm: '<path d="M13 8l-3 4.4h2.4L10.6 16" stroke="#e8d75e" stroke-width="1.5" fill="none"/>',
  Temperate: '<path d="M8 10c1.4-1.4 3.4-.6 4 .6-2 .4-3 1.4-4-.6zM13 14c1.6-1 3.2 0 3.6 1-1.8.6-3 .4-3.6-1z" fill="#2d6a44"/>',
};
let gradSeq = 0;
function planetSvg(type: PlanetType, size: number): string {
  const url = planetCdnUrl(type);
  if (url !== '' && iconReady.has(`planet:${type}`)) {
    const cid = `vzpc${gradSeq++}`;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-label="${type}" class="vz-ptile" data-ptype="${type}"><clipPath id="${cid}"><circle cx="12" cy="12" r="10.6"/></clipPath><image href="${url}" x="1.4" y="1.4" width="21.2" height="21.2" clip-path="url(#${cid})" preserveAspectRatio="xMidYMid meet"/></svg>`;
  }
  const id = `vzp${type}${gradSeq++}`;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-label="${type}" class="vz-ptile" data-ptype="${type}"><defs><radialGradient id="g${id}" cx="35%" cy="32%" r="80%"><stop offset="0%" stop-color="#ffffff" stop-opacity=".55"/><stop offset="45%" stop-color="${PLANET_BASE[type]}"/><stop offset="100%" stop-color="#000" stop-opacity=".55"/></radialGradient><clipPath id="c${id}"><circle cx="12" cy="12" r="9.4"/></clipPath></defs><circle cx="12" cy="12" r="9.4" fill="${PLANET_BASE[type]}"/><g clip-path="url(#c${id})">${PLANET_MOTIF[type]}</g><circle cx="12" cy="12" r="9.4" fill="url(#g${id})"/></svg>`;
}

interface Dag { root: string; nodes: Set<string>; links: Array<{ from: string; to: string; q: number }> }
function dagOf(root: string): Dag {
  const nodes = new Set<string>();
  const links: Dag['links'] = [];
  (function walk(n: string): void {
    if (nodes.has(n)) return;
    nodes.add(n);
    for (const [inp, q] of Object.entries(ITEMS[n]!.inputs)) { links.push({ from: inp, to: n, q }); walk(inp); }
  })(root);
  return { root, nodes, links };
}
function planetCover(dag: Dag): { ores: string[]; cover: Array<{ planet: PlanetType; ores: string[] }> } {
  const ores = [...dag.nodes].filter((n) => ITEMS[n]!.tier === 0);
  const cover: Array<{ planet: PlanetType; ores: string[] }> = [];
  const left = new Set(ores);
  while (left.size > 0) {
    let best: PlanetType | null = null;
    let bestHit: string[] = [];
    for (const pt of PLANET_TYPES) {
      const hit = [...left].filter((o) => (P0P[o] ?? []).includes(pt));
      if (hit.length > bestHit.length) { best = pt; bestHit = hit; }
    }
    if (best === null) break; // an ore no planet carries would be a spec bug
    cover.push({ planet: best, ores: bestHit });
    bestHit.forEach((o) => left.delete(o));
  }
  return { ores, cover };
}

const TILE = 46;
function nodeG(name: string, x: number, y: number): string {
  const it = ITEMS[name]!;
  const label = name.length > 20 ? `${name.slice(0, 19)}…` : name;
  const sub = nodeSub(name);
  let planets = '';
  if (it.tier === 0) {
    const ps = P0P[name] ?? [];
    planets = `<g transform="translate(${-(ps.length * 13) / 2 + 1},${TILE / 2 + 32})">${ps.map((p, i) =>
      `<g transform="translate(${i * 13},0)"><title>${p}</title><circle cx="5" cy="5" r="4.6" fill="${PLANET_BASE[p]}" stroke="rgba(0,0,0,.35)"/></g>`).join('')}</g>`;
  }
  return `<g class="vz-node" data-n="${name}" transform="translate(${x},${y})">
    <title>${name} — ${TIER_NAME[it.tier]} · ${sub.title}${it.tier === 0 ? ` · spawns on: ${(P0P[name] ?? []).join(', ')}` : ''}. Click to re-root.</title>
    <g transform="translate(${-TILE / 2},${-TILE / 2})">${iconSvg(name, TILE)}</g>
    <text text-anchor="middle" y="${TILE / 2 + 13}">${label}</text>
    <text class="vz-sub" text-anchor="middle" y="${TILE / 2 + 26}">${sub.text}</text>${planets}</g>`;
}

function layoutLayered(dag: Dag, horizontal: boolean): string {
  const tiers = new Map<number, string[]>();
  for (const n of dag.nodes) { const t = ITEMS[n]!.tier; (tiers.get(t) ?? tiers.set(t, []).get(t)!).push(n); }
  const order = [...tiers.keys()].sort((a, b) => b - a);
  const pos = new Map<string, number>();
  order.forEach((t) => tiers.get(t)!.forEach((n, i) => pos.set(n, i)));
  for (let pass = 0; pass < 4; pass++) {
    for (const t of order) {
      const arr = tiers.get(t)!;
      const bary = (n: string): number => {
        const bs = dag.links.filter((l) => l.from === n || l.to === n).map((l) => pos.get(l.from === n ? l.to : l.from) ?? 0);
        return bs.length > 0 ? bs.reduce((x, y) => x + y, 0) / bs.length : 0;
      };
      arr.sort((a, b) => bary(a) - bary(b));
      arr.forEach((n, i) => pos.set(n, i));
    }
  }
  const GAPX = 122, GAPY = 124, PADX = 70, PADY = 56;
  const maxRow = Math.max(...order.map((t) => tiers.get(t)!.length));
  const span = (maxRow - 1) * GAPX;
  const xy = new Map<string, [number, number]>();
  if (horizontal) {
    const H = maxRow * 106;
    order.forEach((t, ti) => {
      const arr = tiers.get(t)!;
      const colH = arr.length * 106;
      arr.forEach((n, i) => xy.set(n, [(order.length - 1 - ti) * 180 + 95, (H - colH) / 2 + 60 + i * 106]));
    });
  } else {
    order.forEach((t, ti) => {
      const arr = tiers.get(t)!;
      const rowSpan = (arr.length - 1) * GAPX;
      arr.forEach((n, i) => xy.set(n, [PADX + (span - rowSpan) / 2 + i * GAPX, PADY + ti * GAPY]));
    });
  }
  const W = horizontal ? order.length * 180 + 40 : span + PADX * 2;
  const H = horizontal ? maxRow * 106 + 80 : PADY * 2 + (order.length - 1) * GAPY + 84;
  const links = dag.links.map((l) => {
    const [x1, y1] = xy.get(l.from)!;
    const [x2, y2] = xy.get(l.to)!;
    let d: string, lx: number, ly: number;
    // Labels sit 30% along the edge from its SOURCE, not at the midpoint —
    // edges converging on one node share a midpoint and the labels collided.
    if (horizontal) {
      const mx = (x1 + x2) / 2;
      d = `M${x1 + TILE / 2 + 4},${y1} C${mx},${y1} ${mx},${y2} ${x2 - TILE / 2 - 6},${y2}`;
      lx = x1 + (x2 - x1) * 0.3; ly = y1 + (y2 - y1) * 0.3 - 5;
    } else {
      const my = (y1 + y2) / 2;
      d = `M${x1},${y1 - TILE / 2 - 6} C${x1},${my} ${x2},${my} ${x2},${y2 + TILE / 2 + 4}`;
      lx = x1 + (x2 - x1) * 0.22; ly = y1 + (y2 - y1) * 0.3 - 2;
    }
    // Edge label: units consumed per cycle AND the cargo volume that step moves.
    const stepM3 = l.q * volOf(l.from);
    return `<path class="vz-lnk" data-from="${l.from}" data-to="${l.to}" d="${d}"/><text class="vz-qty" x="${lx}" y="${ly}" text-anchor="middle">${l.q} · ${fmtM3(stepM3)} m³</text>`;
  }).join('');
  const nodes = [...dag.nodes].map((n) => { const [x, y] = xy.get(n)!; return nodeG(n, x, y); }).join('');
  // Natural size — the wrapper scrolls horizontally, so big P4 chains stay
  // legible instead of shrinking to fit (site convention for wide content).
  return `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px" role="img" aria-label="production chain diagram">${links}${nodes}</svg>`;
}
function layoutRadial(dag: Dag): string {
  const rootTier = ITEMS[dag.root]!.tier;
  const byDepth = new Map<number, string[]>();
  for (const n of dag.nodes) { const d = rootTier - ITEMS[n]!.tier; (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(n); }
  const R0 = 118;
  const maxD = Math.max(...byDepth.keys());
  const size = (R0 * maxD + 130) * 2;
  const cx = size / 2, cy = size / 2;
  const xy = new Map<string, [number, number]>([[dag.root, [cx, cy]]]);
  for (let d = 1; d <= maxD; d++) {
    const ring = byDepth.get(d) ?? [];
    ring.forEach((n, i) => {
      const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2 + (d % 2) * (Math.PI / Math.max(ring.length, 1));
      xy.set(n, [cx + Math.cos(a) * R0 * d, cy + Math.sin(a) * R0 * d]);
    });
  }
  const rings = Array.from({ length: maxD }, (_, i) => `<circle cx="${cx}" cy="${cy}" r="${R0 * (i + 1)}" fill="none" stroke="var(--panel-border)" stroke-dasharray="2 6"/>`).join('');
  const links = dag.links.map((l) => {
    const [x1, y1] = xy.get(l.from)!;
    const [x2, y2] = xy.get(l.to)!;
    return `<path class="vz-lnk" data-from="${l.from}" data-to="${l.to}" d="M${x1},${y1} L${x2},${y2}"/>`;
  }).join('');
  const nodes = [...dag.nodes].map((n) => { const [x, y] = xy.get(n)!; return nodeG(n, x, y); }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" style="width:100%;max-width:820px" role="img" aria-label="radial chain">${rings}${links}${nodes}</svg>`;
}
function layoutLanes(dag: Dag): string {
  const { cover } = planetCover(dag);
  const laneNames: string[] = ['Factory colonies', ...cover.map((c) => c.planet)];
  const LH = 148, PAD = 30, LBL = 138;
  const fac = [...dag.nodes].filter((n) => ITEMS[n]!.tier > 0).sort((a, b) => ITEMS[a]!.tier - ITEMS[b]!.tier);
  const xy = new Map<string, [number, number]>();
  fac.forEach((n, i) => xy.set(n, [LBL + 80 + i * 128, PAD + LH / 2]));
  cover.forEach((c, li) => c.ores.forEach((o, i) => xy.set(o, [LBL + 90 + i * 140, PAD + LH * (li + 1) + LH / 2 - 8])));
  const W = Math.max(...[...xy.values()].map(([x]) => x)) + 110;
  const H = PAD + LH * laneNames.length + 12;
  const lanes = laneNames.map((nm, i) => {
    const y = PAD + LH * i;
    const chip = i === 0 ? '' : `<g transform="translate(14,${y + LH / 2 - 24})">${planetSvg(nm as PlanetType, 34)}</g>`;
    return `<line class="vz-lane" x1="${LBL - 8}" x2="${W - 8}" y1="${y + LH}" y2="${y + LH}"/>${chip}<text class="vz-lane-lbl" x="${i === 0 ? 14 : 56}" y="${y + LH / 2 + 3}">${nm}</text>`;
  }).join('');
  const links = dag.links.map((l) => {
    const [x1, y1] = xy.get(l.from)!;
    const [x2, y2] = xy.get(l.to)!;
    if (Math.abs(y1 - y2) < 2) {
      const lift = y1 - TILE / 2 - 26 - Math.min(46, Math.abs(x2 - x1) / 8);
      return `<path class="vz-lnk" data-from="${l.from}" data-to="${l.to}" d="M${x1},${y1 - TILE / 2 - 4} C${x1},${lift} ${x2},${lift} ${x2},${y2 - TILE / 2 - 4}"/>`;
    }
    const my = (y1 + y2) / 2;
    return `<path class="vz-lnk" data-from="${l.from}" data-to="${l.to}" d="M${x1},${y1 - TILE / 2 - 4} C${x1},${my} ${x2},${my} ${x2},${y2 + TILE / 2 + 4}"/>`;
  }).join('');
  const nodes = [...dag.nodes].map((n) => { const [x, y] = xy.get(n)!; return nodeG(n, x, y); }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px" role="img" aria-label="planet swimlanes">${lanes}${links}${nodes}</svg>`;
}

type Lay = 'ladder' | 'river' | 'radial' | 'lanes';
let curProduct = 'Robotics';
let curLay: Lay = 'ladder';

/* Live Jita prices, supplied by the app (the same state section 4 fills and
 * auto-refreshes). Optional: without a quote a node just shows its m³. */
let getQuote: ((name: string) => UiQuote | undefined) | null = null;
function volOf(name: string): number { return TIER_VOLUME_M3[ITEMS[name]!.tier as Tier]; }
function fmtM3(v: number): string {
  return v >= 100 ? `${Math.round(v).toLocaleString('en-US')}` : v >= 1 ? `${Math.round(v * 10) / 10}` : `${v}`;
}
function fmtIsk(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}b`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}m`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return `${Math.round(v * 10) / 10}`;
}
function nodeSub(name: string): { text: string; title: string } {
  const vol = volOf(name);
  const q = getQuote?.(name);
  const hasQ = q !== undefined && q.bid > 0;
  const text = `${fmtM3(vol)} m³${hasQ ? ` · ${fmtIsk(q.bid)} ISK` : ''}`;
  const title = `${vol} m³ per unit${q !== undefined && (q.bid > 0 || q.ask > 0)
    ? ` · Jita: bid ${q.bid.toLocaleString('en-US')} / ask ${q.ask.toLocaleString('en-US')} ISK`
    : ' · no live price yet — fetch Jita prices in section 4'}`;
  return { text, title };
}

function wire(svg: SVGElement, onPick: (n: string) => void): void {
  svg.querySelectorAll<SVGGElement>('.vz-node').forEach((g) => {
    const name = g.dataset['n']!;
    g.addEventListener('click', () => onPick(name));
    g.addEventListener('mouseenter', () => {
      const keep = new Set([name]);
      const L = [...svg.querySelectorAll<SVGPathElement>('.vz-lnk')];
      let grew = true;
      while (grew) { grew = false; for (const l of L) { if (keep.has(l.dataset['to']!) && !keep.has(l.dataset['from']!)) { keep.add(l.dataset['from']!); grew = true; } } }
      grew = true;
      while (grew) { grew = false; for (const l of L) { if (keep.has(l.dataset['from']!) && !keep.has(l.dataset['to']!)) { keep.add(l.dataset['to']!); grew = true; } } }
      svg.querySelectorAll<SVGGElement>('.vz-node').forEach((n) => n.classList.toggle('vz-dim', !keep.has(n.dataset['n']!)));
      L.forEach((l) => {
        const on = keep.has(l.dataset['from']!) && keep.has(l.dataset['to']!);
        l.classList.toggle('vz-hi', on); l.classList.toggle('vz-dim', !on);
      });
    });
    g.addEventListener('mouseleave', () => {
      svg.querySelectorAll('.vz-dim,.vz-hi').forEach((e) => e.classList.remove('vz-dim', 'vz-hi'));
    });
  });
}

/** Re-render the visualizer with current data (the app calls this after live
 * prices land, so node price tags stay in step with section 4). */
export function refreshChainsViz(): void {
  rerenderViz?.();
}

export function initChainsViz(quotes?: (name: string) => UiQuote | undefined): void {
  const host = document.getElementById('chainsViz');
  if (host === null) return;
  getQuote = quotes ?? null;
  const buildable = Object.keys(ITEMS).filter((n) => ITEMS[n]!.tier > 0);
  const groups = [4, 3, 2, 1].map((t) => [t, buildable.filter((n) => ITEMS[n]!.tier === t).sort()] as const);
  host.innerHTML = `
    <div class="vz-bar">
      <label for="vzProduct">Product</label>
      <select id="vzProduct">${groups.map(([t, names]) =>
        `<optgroup label="P${t} — ${['', 'processed', 'refined', 'specialized', 'advanced'][t]}">${names.map((n) => `<option${n === curProduct ? ' selected' : ''}>${n}</option>`).join('')}</optgroup>`).join('')}</select>
      <span class="vz-bar-lbl">Layout</span>
      <button type="button" class="btn small vz-lay${curLay === 'ladder' ? ' vz-on' : ''}" data-lay="ladder">Ladder</button>
      <button type="button" class="btn small vz-lay${curLay === 'river' ? ' vz-on' : ''}" data-lay="river">River</button>
      <button type="button" class="btn small vz-lay${curLay === 'radial' ? ' vz-on' : ''}" data-lay="radial">Radial</button>
      <button type="button" class="btn small vz-lay${curLay === 'lanes' ? ' vz-on' : ''}" data-lay="lanes">Planet lanes</button>
    </div>
    <div class="vz-needs" id="vzNeeds"></div>
    <div class="vz-key" id="vzKey"></div>
    <div class="vz-body" id="vzBody"></div>
    <p class="v9-muted vz-hint">Click any node to re-root the diagram on it · hover a node to light its branch · under each name: per-unit size (m³) and live Jita best-bid price (fetch prices in section 4 — they auto-refresh as you work; hover for bid/ask) · edge labels are units consumed per factory cycle and the cargo volume that step moves · planet dots under each raw material show every planet type it spawns on — the planet key above the diagram decodes the colors (bold = in this chain's cover set).</p>`;
  const sel = host.querySelector<HTMLSelectElement>('#vzProduct')!;
  const body = host.querySelector<HTMLElement>('#vzBody')!;
  const needs = host.querySelector<HTMLElement>('#vzNeeds')!;
  const key = host.querySelector<HTMLElement>('#vzKey')!;
  const render = (): void => {
    const dag = dagOf(curProduct);
    body.innerHTML = curLay === 'ladder' ? layoutLayered(dag, false)
      : curLay === 'river' ? layoutLayered(dag, true)
      : curLay === 'radial' ? layoutRadial(dag)
      : layoutLanes(dag);
    const svg = body.querySelector<SVGElement>('svg');
    if (svg !== null) wire(svg, (n) => {
      if (Object.keys(ITEMS[n]!.inputs).length > 0) { curProduct = n; sel.value = n; render(); }
    });
    const { ores, cover } = planetCover(dag);
    needs.innerHTML = `<span class="vz-needs-lbl">Planets needed</span>${cover.map((c) =>
      `<span class="vz-pchip" title="covers: ${c.ores.join(', ')}">${planetSvg(c.planet, 20)}${c.planet}</span>`).join('')}<span class="v9-muted vz-needs-note">— ${cover.length} planet type${cover.length === 1 ? '' : 's'} cover${cover.length === 1 ? 's' : ''} all ${ores.length} ore${ores.length === 1 ? '' : 's'} (hover a chip to see which)</span>`;
    // Planet key: decodes the colored dots under every raw material — dots
    // marking a planet type IN this chain's cover set are named in bold.
    const inCover = new Set(cover.map((c) => c.planet));
    key.innerHTML = `<span class="vz-needs-lbl">Planet key</span>${PLANET_TYPES.map((t) =>
      `<span class="vz-kitem${inCover.has(t) ? ' vz-kon' : ''}" title="${t} planet${inCover.has(t) ? ' — in this chain’s smallest cover set' : ''}"><span class="vz-kdot" style="background:${PLANET_BASE[t]}"></span>${planetSvg(t, 16)}${t}</span>`).join('')}<span class="v9-muted vz-needs-note">— the dots under each raw material use these colors (every planet type it spawns on)</span>`;
  };
  sel.addEventListener('change', () => { curProduct = sel.value; render(); });
  host.querySelectorAll<HTMLButtonElement>('.vz-lay').forEach((b) => b.addEventListener('click', () => {
    host.querySelectorAll('.vz-lay').forEach((x) => x.classList.toggle('vz-on', x === b));
    curLay = b.dataset['lay'] as Lay;
    render();
  }));
  rerenderViz = render;   // icon preloads re-render (rAF-batched) as they land
  preloadAllIcons();
  render();
}
