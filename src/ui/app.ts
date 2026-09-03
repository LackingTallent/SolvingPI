/**
 * Solving PI v9 — the engine, mounted inside the v8.3 skin. The page shell
 * (hero, theme, clock, reference sections, screenshot OCR) is the carried-over
 * skin under static/legacy; this module renders the five planner steps into
 * the shell's section bodies and exposes window.__v9 — the ONLY bridge the
 * legacy layer may call (deliverBatch, readPlanets).
 * Every number on screen comes from the engine's spec/solver/ledger modules.
 */
import { loadState, saveState, defaultState, defaultResources, extractDefaults, sanitizeState, type DetailLevel, type UiState, type UiPlanet } from './state.js';
import { PLANET_TYPES, SCHEMATICS, tierOf, type PlanetType } from '../spec/schematics.js';
import { resourcesOf } from '../world/planets.js';
import { character, operation } from '../world/characters.js';
import { densityPctFromW, wFromDensityPct, DENSITY_REFERENCE_W } from '../world/density.js';
import { solveMax, solveQuota, type SolveResult, type SolveWorld } from '../engine/allocator.js';
import { comparative, defaultSourcing, economics, qolSolve, type MarketContext } from '../engine/modes.js';
import { solveMixMax, solveMixQuota, type MixEntry, type MixResult } from '../engine/mix.js';
import { chainIntermediates, oreOf, p1InputsOf, type Sourcing } from '../engine/chain.js';
import { analyze, bottleneckReport, optimalityInsight, runwayInsight, type Insight } from '../engine/analytics.js';
import { idRegistry } from '../data/ids.js';
import { fetchPrices } from '../data/prices.js';
import { defaultEsiJson, importSystem, loadSystemIndex, searchSystems, type SystemIndex } from './esi-universe.js';
import { solveReadiness, type Readiness } from './readiness.js';
import { initChainsViz, refreshChainsViz } from './chains-viz.js';
import { suggestSourcing, type SourcingSuggestion } from '../engine/suggest.js';
import { scoutSystems, planetTypeCounts, type ScoutSystemInfo } from '../engine/scout.js';
import {
  activityBadge, crawlRegion, isWormholeRegionId, loadActivity, loadBakedMap, loadRegionList,
  type MapRegion, type MapSystem, type SystemActivity, type UniverseMap,
} from '../data/universe-map.js';
import {
  BAND_LABELS, PRESETS_ARE_APPROXIMATIONS, QUICK_DENSITY_DISCLOSURE, QUICK_DENSITY_PCT,
  SPACE_BANDS, SPACE_COST_PRESETS, type SpaceBand,
} from './presets.js';
import type { IdRegistry } from '../data/ids.js';

// ---------------------------------------------------------------------------
// Tiny DOM helper
// ---------------------------------------------------------------------------

type Child = Node | string | null;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | ((ev: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k, v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('en-US');
const byId = (id: string): HTMLElement => {
  const n = document.getElementById(id);
  if (n === null) throw new Error(`v9 mount missing: #${id} — the shell markup and the app are out of sync`);
  return n;
};

// ---------------------------------------------------------------------------
// State ↔ engine adapters
// ---------------------------------------------------------------------------

let state: UiState = loadState();
let flatRateUndo: UiPlanet[] | null = null;
// The Adjust-sourcing panel is rebuilt on every rerender; without remembering
// its open state, every pin choice collapsed it (owner report 2026-08-31).
let sourcingOpen = false;
// UI-review #4: section 3's empty state is a two-card choice; picking the
// search card reveals the tools for this visit.
let sec1ToolsChosen = false;
// Set by initRegionScout so the "Find me a home" card can switch views.
let showScoutView: ((on: boolean) => void) | null = null;
// 4-both (owner 2026-09-02): post-solve tweak chips reveal these controls in
// Simple mode for the rest of the session.
let revealSourcing = false;
let revealMix = false;
// UI-review #6 follow-up: one planet in edit mode at a time; the rest render
// as one-line chip cards.
let planetEditing: string | null = null;
// UI-review #3: the empty-roster quick-add remembers its count across rerenders.
let quickAddCount = 1;
function persist(): void {
  saveState(state);
  const a = document.getElementById('autosaveStatus');
  if (a) a.textContent = 'Autosaved to this browser just now.';
  markResultsStale();
  // Any input change (re-)schedules the debounced Jita auto-refresh, so the
  // market section keeps itself populated as the user works (product
  // switches included — the needed-commodity set is recomputed at fire time).
  scheduleAutoPriceRefresh();
}

/** Audit #11: a solved answer must never sit unmarked next to changed inputs. */
function markResultsStale(): void {
  const panel = document.getElementById('resultsPanel');
  if (panel === null || panel.childElementCount === 0) return;
  if (panel.querySelector('.v9-stale') !== null) return;
  panel.prepend(el('div', { class: 'v9-warn v9-stale' },
    'Inputs changed since this was solved — press Solve to refresh these numbers.'));
  const summary = document.getElementById('sec4Summary');
  if (summary && !summary.textContent!.includes('(stale)')) summary.textContent += ' (stale)';
}

/** How many density values the Quick level would assume right now (0 outside quick). */
function assumedDensityCount(s: UiState): number {
  if (s.detailLevel !== 'quick' || s.spaceBand === null) return 0;
  return s.planets.reduce((n, p) => n + p.resources.filter((r) => !(r.w > 0)).length, 0);
}

function toWorld(s: UiState): SolveWorld {
  // Accuracy ladder, quick rung: unscanned densities are stood in by the
  // chosen band's typical value. NEVER touches saved state — the substitution
  // lives only in the world handed to the engine, and every result built on
  // it is labeled an estimate.
  const quickW = s.detailLevel === 'quick' && s.spaceBand !== null
    ? wFromDensityPct(QUICK_DENSITY_PCT[s.spaceBand]) : null;
  return {
    operation: operation(s.characters.map((c) => character({ ...c }))),
    planets: s.planets.map((p) => ({
      name: p.name,
      type: p.type,
      resources: Object.fromEntries(p.resources
        .map((r) => [r.p0, r.w > 0 ? r.w : (quickW ?? 0)] as const)
        .filter(([, w]) => w > 0)),
    })),
    programHours: s.programHours,
  };
}

function toMarket(s: UiState): MarketContext {
  const cce = s.characters.length > 0 ? Math.max(...s.characters.map((c) => c.customsCodeLevel)) : 0;
  return {
    prices: s.prices,
    sellBasis: s.sellBasis,
    buyBasis: s.buyBasis,
    fees: { salesTaxRate: s.fees.salesTaxPct / 100, brokerRate: s.fees.brokerPct / 100 },
    customs: { ownerRate: s.fees.customsPct / 100, hisecNpc: s.fees.hisecNpc, customsCodeLevel: cce },
    freightOutPerM3: s.freight.outPerM3,
    freightInPerM3: s.freight.inPerM3,
  };
}

function currentSourcing(s: UiState): Record<string, Sourcing> {
  const base = defaultSourcing(toWorld(s), s.product);
  for (const [p1, mode] of Object.entries(s.sourcingOverrides)) {
    if (p1 in base) base[p1] = mode;
  }
  return base;
}

/** The user's pins that touch this product's chain (P1s and intermediates). */
function pinsFor(product: string): Record<string, Sourcing> {
  try {
    const p1s = new Set<string>(p1InputsOf(product));
    const inters = new Set<string>(chainIntermediates(product));
    return Object.fromEntries(Object.entries(state.sourcingOverrides)
      .filter(([k]) => p1s.has(k) || inters.has(k))) as Record<string, Sourcing>;
  } catch { return {}; }
}

function mixIsActive(s: UiState): boolean {
  return (s.mode === 'max' || s.mode === 'quota' || s.mode === 'qol') && s.mix.length >= 2;
}

/** Keep the mix summing to EXACTLY 100 (owner spec: never more, never less).
 * When one entry was just edited it is held at its clamped value and the
 * others scale proportionally to fill the remainder; the largest entry
 * absorbs any rounding residual. Every entry keeps at least 1%. */
function normalizeMix(changedIdx: number | null = null): void {
  const mix = state.mix;
  const n = mix.length;
  if (n === 0) return;
  if (n === 1) { mix[0]!.pct = 100; return; }
  const MIN = 1;
  for (const e of mix) e.pct = Math.max(MIN, Math.round(e.pct));
  if (changedIdx !== null && changedIdx >= 0 && changedIdx < n) {
    mix[changedIdx]!.pct = Math.min(100 - MIN * (n - 1), mix[changedIdx]!.pct);
    const others = mix.filter((_, j) => j !== changedIdx);
    const remainder = 100 - mix[changedIdx]!.pct;
    const sum = others.reduce((a, e) => a + e.pct, 0);
    let acc = 0;
    others.forEach((e, k) => {
      e.pct = k === others.length - 1
        ? Math.max(MIN, remainder - acc)
        : Math.max(MIN, Math.round((e.pct / sum) * remainder));
      acc += e.pct;
    });
  }
  const total = mix.reduce((a, e) => a + e.pct, 0);
  if (total !== 100) {
    const big = [...mix].sort((a, b) => b.pct - a.pct)[0]!;
    big.pct = Math.max(MIN, big.pct + (100 - total));
  }
}

/** Stable per-row colors for the mix rows and the share bar. */
const MIX_COLORS = ['var(--cyan)', 'var(--amber)', 'var(--magenta)', 'var(--green)', '#b07ae8', '#e8734a'] as const;

/** Streamline #2 (owner 2026-09-02): the accuracy level is INFERRED — scans
 * present and covering the chain → refined (exact when costs are confirmed);
 * gaps → quick with band stand-ins. The "How exact?" radios live in Advanced
 * and can force a level (autoDetail=false). */
function inferDetailLevel(s: UiState): DetailLevel {
  let sourcing: Record<string, Sourcing> = {};
  try { sourcing = s.characters.length > 0 ? currentSourcing(s) : extractDefaults(s.product); } catch { /* mid-edit */ }
  const probe = solveReadiness({
    planets: s.planets, product: s.product, sourcing, mode: s.mode, prices: s.prices,
    modeChosen: true, detailLevel: 'refined', spaceBand: s.spaceBand, costsSource: s.costsSource,
  });
  if (probe.missing.some((m) => m.startsWith('Scan value needed'))) return 'quick';
  if (s.mode === 'compare' || s.mode === 'profit') {
    // Compare touches every product: any unscanned resource anywhere → quick.
    const anyUnscanned = s.planets.some((pl) => pl.resources.some((r) => !(r.w > 0)));
    if (anyUnscanned) return 'quick';
  }
  return s.costsSource === 'user' ? 'exact' : 'refined';
}

/** UI-review #10: an explicit "Next →" in each open step — folds it and opens
 * the following one, no waiting for the gate to notice. */
function nextStepBtn(curSec: string, nextSec: string, label = 'Next →'): HTMLElement {
  return el('div', { class: 'v9-row v9-nextrow' }, el('button', {
    class: 'btn v9-next',
    click: () => {
      document.getElementById(curSec)?.classList.add('collapsed');
      const next = document.getElementById(nextSec);
      next?.classList.remove('collapsed');
      next?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  }, label));
}

function currentReadiness(): Readiness {
  if (mixIsActive(state)) {
    // Union of what every line in the mix needs, each message kept once.
    const missing: string[] = [];
    for (const e of state.mix) {
      let sourcing: Record<string, Sourcing> = {};
      try {
        sourcing = defaultSourcing(toWorld(state), e.product);
        for (const [k, v] of Object.entries(pinsFor(e.product))) if (k in sourcing) sourcing[k] = v;
      } catch { /* product mid-edit */ }
      const r = solveReadiness({
        planets: state.planets, product: e.product, sourcing, mode: state.mode,
        prices: state.prices, modeChosen: state.modeChosen, detailLevel: state.detailLevel,
        spaceBand: state.spaceBand, costsSource: state.costsSource,
        charactersCount: state.characters.length, charactersDone: state.charactersDone,
      });
      for (const m of r.missing) if (!missing.includes(m)) missing.push(m);
    }
    return { ready: missing.length === 0, missing };
  }
  let sourcing: Record<string, Sourcing> = {};
  try { sourcing = currentSourcing(state); } catch { /* product mid-edit */ }
  return solveReadiness({
    planets: state.planets,
    product: state.product,
    sourcing,
    mode: state.mode,
    prices: state.prices,
    modeChosen: state.modeChosen,
    detailLevel: state.detailLevel,
    spaceBand: state.spaceBand,
    costsSource: state.costsSource,
    charactersCount: state.characters.length,
    charactersDone: state.charactersDone,
  });
}

/**
 * TypeID registry with the field-proven legacy fallback: the carried-over
 * 01-data.js defines TYPE_IDS for all 101 commodities (they priced the live
 * v8 site for months). The generated registry wins where it exists; the
 * legacy map fills the rest, so live price fetch works for EVERYTHING today
 * instead of the 4 gen-sde-verified ids.
 */
function mergedIds(): IdRegistry {
  const base = idRegistry();
  const g = globalThis as unknown as {
    TYPE_IDS?: Record<string, number>;
    priceableTypeId?: (n: string) => number | null;
  };
  return {
    typeIdOf(name: string): number {
      try { return base.typeIdOf(name); } catch (e) {
        const id = (typeof g.priceableTypeId === 'function' ? g.priceableTypeId(name) : null) ?? g.TYPE_IDS?.[name];
        if (typeof id === 'number' && id > 0) return id;
        throw e;
      }
    },
    nameOf(typeId: number): string {
      try { return base.nameOf(typeId); } catch (e) {
        const hit = Object.entries(g.TYPE_IDS ?? {}).find(([, v]) => v === typeId);
        if (hit !== undefined) return hit[0];
        throw e;
      }
    },
    schematicName: (id) => base.schematicName(id),
    pinKind: (id) => base.pinKind(id),
    meta: base.meta,
  };
}

function neededCommodities(s: UiState): string[] {
  const names = new Set<string>();
  if (s.mode === 'compare' || s.mode === 'profit') {
    // Compare ranks EVERY product by net, so it needs a price for every
    // product (and its P1 inputs, which cost the buy side). With only the
    // current product's chain fetched, dozens of products fell out of the
    // ranking as "missing-price" — the confusing wall users reported.
    for (const product of SCHEMATICS.keys()) {
      names.add(product);
      try { for (const p1 of p1InputsOf(product)) names.add(p1); } catch { /* no chain */ }
    }
  } else {
    const products = mixIsActive(s) ? s.mix.map((e) => e.product) : [s.product];
    for (const prod of products) {
      names.add(prod);
      try {
        for (const p1 of p1InputsOf(prod)) {
          names.add(p1);
          if (s.sourcingOverrides[p1] === 'refine') names.add(oreOf(p1));
        }
      } catch { /* product invalid mid-edit */ }
    }
  }
  return [...names];
}

// ---------------------------------------------------------------------------
// Section 2 on the page — Operation
// ---------------------------------------------------------------------------

function numInput(value: number, min: number, max: number, step: number, onchange: (v: number) => void): HTMLElement {
  // Audit #12: clamp to the declared range and reject cleared/NaN values —
  // the input's own min/max are advisory in every browser.
  return el('input', {
    class: 'v9-num', type: 'number', value: String(value), min: String(min), max: String(max), step: String(step),
    change: (ev) => {
      const input = ev.target as HTMLInputElement;
      const raw = Number(input.value);
      if (!Number.isFinite(raw) || input.value.trim() === '') { input.value = String(value); return; }
      onchange(Math.min(max, Math.max(min, raw)));
      persist(); rerender();
    },
  });
}

function renderOperation(): void {
  const body = byId('sec0Body');
  const rows = state.characters.map((c, i) =>
    el('tr', {},
      el('td', {}, el('input', {
        class: 'v9-text', type: 'text', value: c.name,
        change: (ev) => { c.name = (ev.target as HTMLInputElement).value; persist(); rerender(); },
      })),
      el('td', {}, numInput(c.icLevel, 0, 5, 1, (v) => { c.icLevel = v; })),
      el('td', {}, numInput(c.ccuLevel, 0, 5, 1, (v) => { c.ccuLevel = v; })),
      el('td', {}, numInput(c.customsCodeLevel, 0, 5, 1, (v) => { c.customsCodeLevel = v; })),
      el('td', {}, numInput(c.accountingLevel, 0, 5, 1, (v) => { c.accountingLevel = v; })),
      el('td', {}, numInput(c.brokerRelationsLevel, 0, 5, 1, (v) => { c.brokerRelationsLevel = v; })),
      el('td', {}, `${1 + c.icLevel} planet${c.icLevel === 0 ? '' : 's'}`),
      el('td', {}, (() => {
        const del = el('button', {
          class: 'btn small',
          title: state.characters.length === 1 ? 'An operation needs at least one character.' : 'Remove this character',
          click: () => {
            if (state.characters.length === 1) return; // never delete the last one
            state.characters.splice(i, 1); persist(); rerender();
          },
        }, '✕');
        if (state.characters.length === 1) del.setAttribute('disabled', 'disabled');
        return del;
      })()),
    ),
  );
  const slots = state.characters.reduce((a, c) => a + 1 + c.icLevel, 0);
  const summary = document.getElementById('sec0Summary');
  if (summary) summary.textContent = `${state.characters.length} character${state.characters.length === 1 ? '' : 's'} · ${slots} colony slots · ${state.programHours}h programs`;
  // UI-review #7: once the roster is confirmed it folds to ONE line.
  if (state.charactersDone) {
    body.replaceChildren(
      el('div', { class: 'v9-row' },
        el('span', {}, `✓ ${state.characters.length} character${state.characters.length === 1 ? '' : 's'}, skills set`),
        el('button', {
          class: 'btn small',
          click: () => { state.charactersDone = false; persist(); rerender(); },
        }, 'Edit characters'),
      ),
    );
    return;
  }
  body.replaceChildren(
    state.characters.length === 0
      ? el('div', { class: 'v9-quickadd' },
          el('div', { class: 'v9-quickadd-row' },
            el('h3', {}, 'How many characters do you have?'),
            (() => {
              const n = numInput(quickAddCount, 1, 50, 1, (v) => { quickAddCount = Math.round(v); });
              n.setAttribute('aria-label', 'How many characters do you have?');
              return n;
            })(),
            el('button', {
              class: 'btn',
              click: () => {
                const n = Math.max(1, Math.min(50, Math.round(quickAddCount)));
                for (let i = 0; i < n; i++) {
                  state.characters.push({ name: i === 0 ? 'Main' : `Alt ${i}`, icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 });
                }
                state.charactersDone = false;
                persist(); rerender();
                announce(`${n} character${n === 1 ? '' : 's'} created with maxed skills.`);
              },
            }, 'Create my roster'),
          ),
          el('p', { class: 'v9-muted' }, 'Skills start maxed — fix any that aren’t, then press ✓ Done.'),
        )
      : el('table', { class: 'v9-table' },
          el('tr', {}, ...['Name', 'Interplanetary Consolidation', 'CC Upgrades', 'Customs Code', 'Accounting', 'Broker Relations', 'Planet budget', ''].map((h) => el('th', {}, h))),
          ...rows,
        ),
    el('button', {
      class: 'btn',
      click: () => {
        if (state.characters.length >= 50) { alert('Supported size is 1..50 characters.'); return; }
        state.characters.push({ name: state.characters.length === 0 ? 'Main' : `Alt ${state.characters.length}`, icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 });
        state.charactersDone = false; // roster changed — confirm it again
        persist(); rerender();
      },
    }, '+ Add character'),
    (() => {
      // Owner spec 2026-09-01: the section is complete only when the user
      // says so — and the choice is reversible (the confirmed roster renders
      // as one line above instead of this editor).
      const done = el('button', {
        class: 'btn',
        title: state.characters.length === 0 ? 'Add a character first.' : 'Mark your roster complete',
        click: () => {
          if (state.characters.length === 0) return;
          state.charactersDone = true;
          persist(); rerender();
          announce('Characters locked in.');
        },
      }, '✓ Done adding characters');
      if (state.characters.length === 0) done.setAttribute('disabled', 'disabled');
      return done;
    })(),
    !state.advancedMode ? el('span', { hidden: 'hidden' }) : el('div', { class: 'v9-row' },
      el('label', {}, 'Extraction program length ',
        el('select', {
          change: (ev) => { state.programHours = Number((ev.target as HTMLSelectElement).value); persist(); rerender(); },
        }, ...[6, 12, 24, 48, 96, 168, 336].map((h) => {
          const o = el('option', { value: String(h) }, `${h}h (${fmt1(168 / h)} sessions/wk)`);
          if (h === state.programHours) o.setAttribute('selected', 'selected');
          return o;
        })),
      ),
      el('span', { class: 'v9-muted' }, 'Short programs yield more per week; long ones need fewer logins.'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Section 3 on the page — Planets (renders into #v9PlanetList; batch panel is shell markup)
// ---------------------------------------------------------------------------

function planetRow(p: UiPlanet, i: number): HTMLElement {
  const typeSel = el('select', {
    change: (ev) => {
      p.type = (ev.target as HTMLSelectElement).value as PlanetType;
      p.resources = p.resources.filter((r) => resourcesOf(p.type).includes(r.p0));
      persist(); rerender();
    },
  }, ...PLANET_TYPES.map((t) => {
    const o = el('option', { value: t }, t);
    if (t === p.type) o.setAttribute('selected', 'selected');
    return o;
  }));
  // Game truth: a planet carries exactly the 5 resources of its type, each
  // once. The row's dropdown offers only resources not already listed (plus
  // its own), so duplicates are unpickable, and the add button caps at 5.
  const taken = new Set(p.resources.map((r) => r.p0));
  const resRows = p.resources.map((r, ri) =>
    el('div', { class: 'v9-row' },
      el('select', {
        change: (ev) => { r.p0 = (ev.target as HTMLSelectElement).value; persist(); rerender(); },
      }, ...resourcesOf(p.type).filter((p0) => p0 === r.p0 || !taken.has(p0)).map((p0) => {
        const o = el('option', { value: p0 }, p0);
        if (p0 === r.p0) o.setAttribute('selected', 'selected');
        return o;
      })),
      // Owner spec 2026-08-31: the number the USER HAS is the density % (the
      // resource bar's fill — what scans and the screenshot reader both give).
      // That exact number is what the plan runs on: it converts to the game's
      // per-cycle unit (w) once, here, and nowhere else. The raw translation
      // is shown alongside so nothing is hidden.
      el('input', {
        class: 'v9-num', type: 'number', value: r.w > 0 ? String(Math.round(densityPctFromW(r.w) * 100) / 100) : '', min: '0', step: 'any',
        placeholder: 'density %',
        title: 'This resource’s density % from your scan (the bar’s fill). Over 100% is real and never capped. Your number is used as-is in every calculation.',
        change: (ev) => {
          const v = Number((ev.target as HTMLInputElement).value);
          r.w = Number.isFinite(v) && v > 0 ? wFromDensityPct(v) : 0;
          persist(); rerender();
        },
      }),
      el('span', { class: r.w > 0 ? 'v9-muted' : 'v9-scan-tag' },
        r.w > 0 ? `% = ${fmt(r.w)} per cycle` : '% — awaiting scan; excluded from plans until set'),
      el('button', { class: 'btn small', click: () => { p.resources.splice(ri, 1); persist(); rerender(); } }, '✕'),
    ),
  );
  const unscanned = p.resources.filter((r) => !(r.w > 0)).length;
  // Review #1: duplicate names are refused at solve time by the engine —
  // surface them the moment they exist, right on the field that caused it.
  const isDup = state.planets.some((q, qi) => qi !== i && q.name.trim() === p.name.trim());
  const dupTag = isDup
    ? el('span', { class: 'v9-dup-tag', title: 'The engine refuses ambiguous plans — give each planet a unique name.' },
        '⚠ duplicate name — rename one')
    : null;
  // Completion checkbox: checked = THIS planet renders minimized. Sits on the
  // RIGHT of the header row; the handler stops propagation so nothing else
  // interprets the click, and it only ever touches this one planet.
  const doneBox = el('label', { class: 'v9-done v9-done-right', title: 'Mark this planet complete to collapse it' },
    (() => {
      const cb = el('input', {
        type: 'checkbox',
        change: (ev) => {
          ev.stopPropagation();
          p.minimized = (ev.target as HTMLInputElement).checked;
          persist(); rerender();
        },
      });
      if (p.minimized === true) cb.setAttribute('checked', 'checked');
      return cb;
    })(), ' Complete');

  // UI-review #6 follow-up: planets render as ONE-LINE chip cards; the full
  // editor opens for one planet at a time (✎ Edit / clicking a chip).
  if (p.minimized !== true && planetEditing !== p.name) {
    const chip = (r: { p0: string; w: number }): HTMLElement =>
      el('button', {
        class: r.w > 0 ? 'v9-reschip' : 'v9-reschip v9-reschip-warn',
        title: r.w > 0 ? `${r.p0} — click to edit` : `${r.p0} — awaiting scan; click to enter it`,
        click: () => { planetEditing = p.name; rerender(); },
      }, r.w > 0 ? `${r.p0} ${fmt1(densityPctFromW(r.w))}%` : `${r.p0} — scan?`);
    return el('div', { class: 'v9-planet' },
      el('div', { class: 'v9-row' },
        el('b', {}, p.name),
        dupTag,
        el('span', { class: 'v9-muted' }, `(${p.type})`),
        p.system ? el('span', { class: 'v9-muted' }, p.system) : null,
        el('button', { class: 'btn small', click: () => { planetEditing = p.name; rerender(); } }, '✎ Edit'),
        el('button', {
          class: 'btn small v9-remove', title: 'Remove this planet',
          click: () => {
            if (!window.confirm(`Remove ${p.name} (${p.type}) and its scan values?`)) return;
            state.planets.splice(i, 1); persist(); rerender();
          },
        }, '✕ Remove planet'),
        doneBox,
      ),
      el('div', { class: 'v9-row v9-chiprow' }, ...p.resources.map(chip)),
    );
  }

  if (p.minimized === true) {
    const scanned = p.resources.filter((r) => r.w > 0);
    const avg = scanned.length > 0
      ? scanned.reduce((a, r) => a + densityPctFromW(r.w), 0) / scanned.length : 0;
    return el('div', { class: 'v9-planet v9-planet-min' },
      el('div', { class: 'v9-row' },
        el('b', {}, p.name),
        dupTag,
        el('span', { class: 'v9-muted' }, `(${p.type})`),
        p.system ? el('span', { class: 'v9-muted' }, p.system) : null,
        el('span', { class: 'v9-muted' },
          `${p.resources.length} resource${p.resources.length === 1 ? '' : 's'}${scanned.length > 0 ? ` · avg ${fmt1(avg)}%` : ''}${unscanned > 0 ? ` · ${unscanned} awaiting scan` : ''}`),
        doneBox,
      ),
    );
  }

  return el('div', { class: 'v9-planet' },
    el('div', { class: 'v9-row' },
      el('input', {
        class: isDup ? 'v9-text v9-dup' : 'v9-text', type: 'text', value: p.name,
        change: (ev) => { p.name = (ev.target as HTMLInputElement).value; persist(); rerender(); },
      }),
      dupTag,
      typeSel,
      p.system ? el('span', { class: 'v9-muted' }, p.system) : null,
      p.scannedAt ? el('span', { class: 'v9-scan-tag', title: `Screenshot capture time: ${p.scannedAt}` }, `📷 ${p.scannedAt.slice(0, 10)}`) : null,
      unscanned > 0 ? el('span', { class: 'v9-scan-tag' }, `${unscanned} awaiting scan`) : null,
      // Review #5 + follow-up: small and quiet, but LABELED — a bare ✕ read
      // as missing entirely. Confirmed before anything is deleted.
      el('button', {
        class: 'btn small v9-remove', title: 'Remove this planet',
        click: () => {
          if (!window.confirm(`Remove ${p.name} (${p.type}) and its scan values?`)) return;
          state.planets.splice(i, 1); persist(); rerender();
        },
      }, '✕ Remove planet'),
      doneBox,
    ),
    ...resRows,
    el('button', {
      class: 'btn small',
      click: () => { planetEditing = null; rerender(); },
    }, '✓ Done editing'),
    (() => {
      const unused = resourcesOf(p.type).filter((p0) => !taken.has(p0));
      const btn = el('button', {
        class: 'btn small',
        title: unused.length === 0
          ? `A ${p.type} planet carries exactly these ${resourcesOf(p.type).length} resources — there are no more to add.`
          : 'Add the next resource this planet type carries',
        click: () => {
          const first = resourcesOf(p.type).filter((p0) => !p.resources.some((r) => r.p0 === p0))[0];
          if (first === undefined) return;
          p.resources.push({ p0: first, w: 0 });
          persist(); rerender();
        },
      }, '+ Add resource');
      if (unused.length === 0) btn.setAttribute('disabled', 'disabled');
      return btn;
    })(),
  );
}

function renderPlanets(): void {
  // The two banners are the section's permanent switch (owner 2026-09-02) —
  // they stay visible; only the tool panels below them appear on demand.
  const hasPlanets = state.planets.length > 0;
  const showTools = hasPlanets || sec1ToolsChosen;
  const scoutOpen = document.getElementById('scoutWrap')?.hidden === false;
  document.getElementById('chooseSearch')?.classList.toggle('active', showTools && !scoutOpen);
  const search = document.getElementById('sysSearchPanel');
  if (search) search.hidden = !showTools;
  const more = document.getElementById('moreTools') as HTMLDetailsElement | null;
  if (more) more.hidden = !showTools || !state.advancedMode;
  const mount = byId('v9PlanetList');
  const summary = document.getElementById('sec1Summary');
  if (summary) summary.textContent = `${state.planets.length} planet${state.planets.length === 1 ? '' : 's'}`;
  // Planets grouped by solar system; each group header carries its own
  // right-aligned Complete & Collapse All for just that system's planets.
  const groups = new Map<string, Array<{ p: UiPlanet; i: number }>>();
  state.planets.forEach((p, i) => {
    const key = p.system && p.system.trim() !== '' ? p.system : 'NO SYSTEM SET';
    const arr = groups.get(key) ?? [];
    arr.push({ p, i });
    groups.set(key, arr);
  });
  const groupBlocks: HTMLElement[] = [];
  for (const [sys, members] of groups) {
    groupBlocks.push(el('div', { class: 'v9-sys-head' },
      el('b', {}, sys.toUpperCase()),
      el('span', { class: 'v9-muted' }, `${members.length} planet${members.length === 1 ? '' : 's'}`),
      el('button', {
        class: 'btn small v9-collapse-all', type: 'button',
        title: `Mark every planet in ${sys} complete and collapse it`,
        click: () => { for (const m of members) m.p.minimized = true; persist(); rerender(); },
      }, 'Complete & Collapse All'),
    ));
    for (const m of members) groupBlocks.push(planetRow(m.p, m.i));
  }
  mount.replaceChildren(
    el('p', { class: 'section-sub' },
      'Planetary Resource Density is set to 70%. Provide your planets’ real data for the most accurate numbers.'),
    ...groupBlocks,
    el('button', {
      class: 'btn',
      click: () => {
        const name = `Planet ${state.planets.length + 1}`;
        state.planets.push({ name, type: 'Barren', resources: defaultResources('Barren'), minimized: false });
        planetEditing = name; // a new planet opens straight into its editor
        persist(); rerender();
      },
    }, '+ Add planet'),
  );
  mount.append(nextStepBtn('sec1', 'sec2'));
}

// ---------------------------------------------------------------------------
// Section 4 on the page — Costs & market
// ---------------------------------------------------------------------------

function basisSelect(value: 'immediate' | 'patient', set: (v: 'immediate' | 'patient') => void): HTMLElement {
  return el('select', {
    change: (ev) => { set((ev.target as HTMLSelectElement).value as 'immediate' | 'patient'); persist(); rerender(); },
  }, ...(['immediate', 'patient'] as const).map((b) => {
    const o = el('option', { value: b }, b === 'immediate' ? 'instant (hit orders, no broker)' : 'patient (rest orders, broker fee)');
    if (b === value) o.setAttribute('selected', 'selected');
    return o;
  }));
}

/** Apply a space-type cost preset as an EDITABLE PREFILL (never a silent
 * constant): writes the fee/freight fields, records where they came from, and
 * the UI keeps disclosing it until the user edits or confirms the rates. */
function applyCostPreset(band: SpaceBand): void {
  const p = SPACE_COST_PRESETS[band];
  state.fees.customsPct = p.customsPct;
  state.fees.hisecNpc = p.hisecNpc;
  state.fees.salesTaxPct = p.salesTaxPct;
  state.fees.brokerPct = p.brokerPct;
  state.freight.outPerM3 = p.freightPerM3;
  state.freight.inPerM3 = p.freightPerM3;
  state.costsSource = `preset-${band}`;
  // One question, one place (streamline #3): "where do you operate?" also
  // records the density band that Quick estimates assume.
  state.spaceBand = band;
}

function costsSourceLabel(): string {
  if (state.costsSource === 'user') return 'Costs: your own rates.';
  if (state.costsSource === 'default') return 'Costs: this build’s defaults — not yet your rates.';
  const band = state.costsSource.slice('preset-'.length) as SpaceBand;
  return `Costs: ${SPACE_COST_PRESETS[band].label} preset — ${PRESETS_ARE_APPROXIMATIONS}`;
}

/** A fee/freight edit makes the rates the user's own. */
function ownCosts(set: (v: number) => void): (v: number) => void {
  return (v) => { set(v); state.costsSource = 'user'; };
}

// ---------------------------------------------------------------------------
// Live Jita prices: one fetch routine, used by the button AND auto-refresh.
// Auto-refresh fires (debounced) whenever inputs change and the current
// goal's chain has unpriced commodities, or live data is >10 min old — so
// the market section keeps itself current as the user works. It never
// overwrites a fully-priced manual set, backs off 5 min after a failure,
// and never runs two fetches at once.
// ---------------------------------------------------------------------------
let priceFetchInFlight = false;
let lastLiveFetchMs = 0;
let lastAutoFailMs = 0;
let autoFetchTimer: ReturnType<typeof setTimeout> | null = null;
let applyingPrices = false; // persist() calls from inside the fetch don't re-schedule

function refreshJitaPrices(onProgress?: (t: string) => void, opts?: { fillOnly?: boolean }): Promise<boolean> {
  if (priceFetchInFlight) return Promise.resolve(false);
  priceFetchInFlight = true;
  const names = neededCommodities(state);
  // fillOnly (the auto path): only quotes that were MISSING before the fetch
  // are written, so nothing the user typed is ever overwritten unasked.
  const fillTargets = opts?.fillOnly === true ? new Set(names.filter((n) => !priced(n))) : null;
  let fetched = 0;
  return fetchPrices(names, {
    ids: mergedIds(),
    now: () => new Date().toISOString(),
    fetchJson: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ESI`);
      fetched++;
      onProgress?.(`Fetching Jita order books… (${Math.min(Math.ceil(fetched / 2), names.length)}/${names.length})`);
      return { body: await res.json(), headers: {} };
    },
  }).then((snap) => {
    for (const [name, quote] of Object.entries(snap.prices)) {
      if (fillTargets === null || fillTargets.has(name)) state.prices[name] = { ...quote };
    }
    // Audit B2: developer error text ("run tools/gen-sde.mjs") means nothing
    // to a site visitor — translate it at the display boundary.
    const friendly = (reason: string): string =>
      reason.startsWith('missing-typeid')
        ? 'no type ID in this build — enter its quote manually'
        : reason;
    state.priceNote = `Live: ${snap.source} at ${snap.fetchedAt}. Auto-refreshes as your inputs change.` +
      (snap.unpriced.length > 0 ? ` UNPRICED: ${snap.unpriced.map((u) => `${u.name} (${friendly(u.reason)})`).join('; ')}` : '');
    lastLiveFetchMs = Date.now();
    priceFetchInFlight = false;
    applyingPrices = true;
    try { persist(); rerender(); } finally { applyingPrices = false; }
    return true;
  }).catch((e: Error) => {
    state.priceNote = `Live fetch failed: ${e.message} — enter quotes manually. If this section looks stuck, press its ⟲ Reset and try again.`;
    lastAutoFailMs = Date.now();
    priceFetchInFlight = false;
    applyingPrices = true;
    try { persist(); rerender(); } finally { applyingPrices = false; }
    return false;
  });
}

const priced = (name: string): boolean => {
  const q = state.prices[name];
  return q !== undefined && q.bid > 0 && q.ask > 0;
};
function unpricedNeeded(): string[] {
  return neededCommodities(state).filter((n) => !priced(n));
}
function scheduleAutoPriceRefresh(): void {
  if (applyingPrices) return;
  if (autoFetchTimer !== null) clearTimeout(autoFetchTimer);
  autoFetchTimer = setTimeout(() => {
    autoFetchTimer = null;
    if (priceFetchInFlight) return;
    if (Date.now() - lastAutoFailMs < 300_000) return; // back off after a failure
    const needFill = unpricedNeeded().length > 0;
    const stale = lastLiveFetchMs > 0 && Date.now() - lastLiveFetchMs > 600_000;
    if (!needFill && !stale) return;
    // Gap-filling never touches quotes the user already has; only a staleness
    // refresh of previously-live data rewrites existing quotes.
    void refreshJitaPrices(undefined, { fillOnly: !stale });
  }, 1500);
}

function renderMarket(): void {
  const body = byId('sec2Body');
  const summary = document.getElementById('sec2Summary');
  if (summary) summary.textContent = `${Object.keys(state.prices).length} priced · ${state.fees.customsPct}% customs`;
  const priceRows = neededCommodities(state).map((name) => {
    const q = state.prices[name] ?? { bid: 0, ask: 0 };
    const upd = (field: 'bid' | 'ask' | 'dailyVolume') => (ev: Event) => {
      const v = Number((ev.target as HTMLInputElement).value);
      const cur = state.prices[name] ?? { bid: 0, ask: 0 };
      state.prices[name] = { ...cur, [field]: v };
      persist();
    };
    return el('tr', {},
      el('td', {}, `${name} (P${tierOf(name)})`),
      el('td', {}, el('input', { class: 'v9-num', type: 'number', value: String(q.bid), min: '0', step: 'any', change: upd('bid') })),
      el('td', {}, el('input', { class: 'v9-num', type: 'number', value: String(q.ask), min: '0', step: 'any', change: upd('ask') })),
      el('td', {}, el('input', { class: 'v9-num', type: 'number', value: String(q.dailyVolume ?? ''), min: '0', step: 'any', change: upd('dailyVolume') })),
    );
  });
  const fetchBtn = el('button', {
    class: 'btn',
    title: 'Step 1 of a solve: fetch prices first, then press SOLVE — rankings and net use them.',
    click: () => {
      fetchBtn.textContent = 'Fetching Jita order books…';
      void refreshJitaPrices((t) => { fetchBtn.textContent = t; });
    },
  }, 'Fetch live Jita prices (ESI)');
  const autoNote = el('p', { class: 'v9-muted v9-autonote' },
    'Quotes you type by hand are never overwritten by a refresh.');
  // Streamline #3: the section is a status card + one question. The full
  // price table and cost fields fold away under "Edit by hand".
  const livePriced = neededCommodities(state).filter((n) => priced(n)).length;
  const neededCount = neededCommodities(state).length;
  const updatedTxt = lastLiveFetchMs > 0
    ? `updated ${Math.max(0, Math.round((Date.now() - lastLiveFetchMs) / 60000))} min ago`
    : (priceFetchInFlight ? 'fetching…' : 'fetching on demand');
  const statusCard = el('div', { class: `v9-mkt-status${livePriced >= neededCount && neededCount > 0 ? ' ok' : ''}` },
    el('span', { class: 'v9-mkt-dot' }, livePriced >= neededCount && neededCount > 0 ? '🟢' : '🟡'),
    el('b', {}, `Live Jita prices — ${livePriced} of ${neededCount} this plan needs`),
    el('span', { class: 'v9-muted' }, ` · ${updatedTxt} · refresh themselves as you work`),
    fetchBtn,
  );
  fetchBtn.textContent = 'Refresh now';
  fetchBtn.className = 'btn small';
  body.replaceChildren(
    statusCard,
    el('div', { class: 'v9-row fin-presets' },
      el('span', { class: 'fin-preset-label' }, 'Where do you operate?'),
      ...SPACE_BANDS.map((b) => {
        const btn = el('button', {
          class: `btn small preset-btn${state.costsSource === `preset-${b}` ? ' active' : ''}`,
          type: 'button',
          title: SPACE_COST_PRESETS[b].rationale,
          click: () => { applyCostPreset(b); persist(); rerender(); },
        }, BAND_LABELS[b]);
        return btn;
      }),
      el('button', {
        class: 'btn small', type: 'button',
        title: 'Marks the current fee and freight numbers as your real rates (required for Exact detail level).',
        click: () => { state.costsSource = 'user'; persist(); rerender(); },
      }, 'These are my real rates'),
    ),
    el('p', { class: 'v9-muted fin-preset-note' }, costsSourceLabel()),
    el('details', { class: 'v9-more-tools' },
    el('summary', {}, '✎ Edit prices & costs by hand'),
    el('p', { class: 'section-sub v9-muted' }, state.priceNote),
    el('table', { class: 'v9-table' },
      el('tr', {}, ...['Commodity', 'Best bid (instant sell)', 'Best ask (list / instant buy)', 'Daily volume (optional)'].map((h) => el('th', {}, h))),
      ...priceRows,
    ),
    autoNote,
    el('div', { class: 'v9-row' },
      el('label', {}, 'Sales tax % ', numInput(state.fees.salesTaxPct, 0, 100, 0.001, ownCosts((v) => { state.fees.salesTaxPct = v; }))),
      el('label', {}, 'Broker % ', numInput(state.fees.brokerPct, 0, 100, 0.001, ownCosts((v) => { state.fees.brokerPct = v; }))),
      el('label', {}, 'Customs owner % ', numInput(state.fees.customsPct, 0, 100, 0.1, ownCosts((v) => { state.fees.customsPct = v; }))),
      el('label', {}, (() => {
        const cb = el('input', {
          type: 'checkbox',
          change: (ev) => { state.fees.hisecNpc = (ev.target as HTMLInputElement).checked; state.costsSource = 'user'; persist(); rerender(); },
        });
        if (state.fees.hisecNpc) cb.setAttribute('checked', 'checked');
        return cb;
      })(), ' hisec NPC customs component'),
    ),
    el('div', { class: 'v9-row' },
      el('label', {}, 'Freight out ISK/m³ ', numInput(state.freight.outPerM3, 0, 1e6, 1, ownCosts((v) => { state.freight.outPerM3 = v; }))),
      el('label', {}, 'Freight in ISK/m³ ', numInput(state.freight.inPerM3, 0, 1e6, 1, ownCosts((v) => { state.freight.inPerM3 = v; }))),
      el('label', {}, 'Sell ', basisSelect(state.sellBasis, (v) => { state.sellBasis = v; })),
      el('label', {}, 'Buy ', basisSelect(state.buyBasis, (v) => { state.buyBasis = v; })),
    ),
    ),
    nextStepBtn('sec2', 'sec4', 'Done — ready for SOLVE'),
  );
}

// ---------------------------------------------------------------------------
// Section 1 on the page — Goal (physically #sec3; ordered first)
// ---------------------------------------------------------------------------

function renderGoal(): void {
  const body = byId('sec3Body');
  const summary = document.getElementById('sec3Summary');
  const modeLabel = { max: 'Max output', quota: 'Weekly target', qol: 'Fit my logins', compare: 'Compare', profit: 'Pick for me' }[state.mode];
  if (summary) {
    summary.textContent = !state.modeChosen ? 'Pick a goal'
      : state.mode === 'compare' || state.mode === 'profit' ? modeLabel
        : mixIsActive(state) ? `Mix: ${state.mix.map((e) => e.product).join(' + ')} · ${modeLabel}`
          : `${state.product} · ${modeLabel}`;
  }
  const productSel = el('select', {
    change: (ev) => { state.product = (ev.target as HTMLSelectElement).value; state.sourcingOverrides = extractDefaults(state.product); persist(); rerender(); },
  }, ...[...SCHEMATICS.keys()].sort((a, b) => tierOf(a) - tierOf(b) || a.localeCompare(b)).map((name) => {
    const o = el('option', { value: name }, `P${tierOf(name)} — ${name}`);
    if (name === state.product) o.setAttribute('selected', 'selected');
    return o;
  }));

  // Goal grid (owner pick 2026-09-02, "Option 3"): selectable icon cards in
  // a two-column grid. The real radio stays visible in each card so keyboard,
  // screen readers and the suites all keep their native input.
  const GOAL_ICONS: Record<string, string> = {
    compare: '<path d="M5 19V9M11 19V4M17 19v-6"></path><path d="M3 21h18"></path>',
    qol: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3.2 2"></path>',
    max: '<path d="M12 19.5V5M6 11l6-6 6 6"></path>',
    profit: '<path d="M12 4l1.6 4.6L18 10l-4.4 1.4L12 16l-1.6-4.6L6 10l4.4-1.4z"></path><path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"></path>',
    quota: '<circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="3.2"></circle>',
  };
  const goalIcon = (m: string): HTMLElement => {
    const s = el('span', { class: 'v9-gicon', 'aria-hidden': 'true' });
    s.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GOAL_ICONS[m] ?? ''}</svg>`;
    return s;
  };
  const modes: Array<[UiState['mode'], string, string]> = [
    ['compare', 'Compare', 'rank every product by profit'],
    ['qol', 'Fit my logins', 'best ISK for my play time'],
    ['max', 'Max output', 'the most of one product'],
    ['profit', 'Pick for me', 'top profit, hands-free'],
    ['quota', 'Weekly target', 'make a set amount'],
  ];
  const modeBlock = el('div', { class: 'v9-goalgrid' },
    ...modes.map(([m, title, desc]) => el('label', { class: 'v9-mode v9-gcard' },
      (() => {
        const r = el('input', {
          type: 'radio', name: 'v9mode', value: m,
          change: () => { state.mode = m; state.modeChosen = true; persist(); rerender(); },
        });
        // Nothing is pre-checked until the user actually chooses a goal.
        if (state.modeChosen && state.mode === m) r.setAttribute('checked', 'checked');
        return r;
      })(),
      goalIcon(m),
      el('span', { class: 'v9-gcard-txt' }, el('b', {}, title), el('i', {}, desc)),
    )),
    el('div', { class: 'v9-gcard v9-gcard-hint' },
      el('span', { class: 'v9-muted' }, 'Not sure? Compare finds the money for you.')),
  );

  if (!state.modeChosen) {
    // Progressive disclosure: THE GOAL IS THE FIRST AND ONLY QUESTION.
    // Product, sourcing, detail level and Solve all appear only once a goal
    // exists to shape them — the goal decides whether a product is even asked.
    body.replaceChildren(
      el('h3', {}, 'Select a Goal'),
      modeBlock,
    );
    return;
  }

  // --- Detail level (accuracy ladder) ---------------------------------------
  // Streamline #2: the level is inferred (Auto). The radios exist only in
  // Advanced, with Auto as the recommended first choice.
  const levels: Array<[string, string, string]> = [
    ['auto', 'Auto (recommended)', 'uses the best level your data supports'],
    ['quick', 'Quick', 'instant — typical values fill the gaps, labeled as estimates'],
    ['refined', 'Refined', 'uses your real scans'],
    ['exact', 'Exact', 'every number is yours'],
  ];
  const detailBlock = !state.advancedMode ? null : el('div', { class: 'v9-detail' },
    el('h3', {}, 'How exact?'),
    ...levels.map(([lv, label, desc]) => el('label', { class: 'v9-mode' },
      (() => {
        const r = el('input', {
          type: 'radio', name: 'v9detail', value: lv,
          change: () => {
            if (lv === 'auto') { state.autoDetail = true; }
            else { state.autoDetail = false; state.detailLevel = lv as DetailLevel; }
            persist(); rerender();
          },
        });
        const checked = lv === 'auto' ? state.autoDetail : (!state.autoDetail && state.detailLevel === lv);
        if (checked) r.setAttribute('checked', 'checked');
        return r;
      })(), ` ${label} — ${desc}`,
    )),
    el('p', { class: 'v9-muted' }, state.autoDetail ? `Auto is using: ${state.detailLevel}` : ''),
  );

  // --- Product mix (owner spec 2026-08-31) ---------------------------------
  // In max/quota/qol the single product can become a MIX: several products
  // with percentage shares; the solver optimizes the blend at that ratio by
  // partitioning characters between product lines.
  const mixCapable = state.mode === 'max' || state.mode === 'quota' || state.mode === 'qol';
  const mixActive = mixCapable && state.mix.length >= 2;
  let mixBlock: HTMLElement | null = null;
  // Simple mode hides the blend builder until Advanced or a results tweak
  // chip reveals it (4-both); an ACTIVE mix always shows.
  if (mixCapable && (state.advancedMode || revealMix || mixActive)) {
    const productOptions = (selected: string): HTMLElement[] =>
      [...SCHEMATICS.keys()].sort((a, b) => tierOf(a) - tierOf(b) || a.localeCompare(b)).map((name) => {
        const o = el('option', { value: name }, `P${tierOf(name)} — ${name}`);
        if (name === selected) o.setAttribute('selected', 'selected');
        return o;
      });
    if (!mixActive) {
      mixBlock = el('div', { class: 'v9-row' }, el('button', {
        class: 'btn small', type: 'button',
        title: 'Plan several products at once — you set the percentage of each and the tool optimizes the blend.',
        click: () => {
          const other = [...SCHEMATICS.keys()].find((n) => n !== state.product) ?? state.product;
          state.mix = [{ product: state.product, pct: 50 }, { product: other, pct: 50 }];
          persist(); rerender();
        },
      }, '+ Plan a mix of products instead'));
    } else {
      const rows = state.mix.map((entry, i) => el('div', { class: 'v9-row v9-mix-row' },
        el('span', { class: 'v9-mix-dot', style: `background:${MIX_COLORS[i % MIX_COLORS.length]}` }),
        el('select', {
          change: (ev) => { entry.product = (ev.target as HTMLSelectElement).value; persist(); rerender(); },
        }, ...productOptions(entry.product)),
        numInput(entry.pct, 1, 99, 1, (v) => { entry.pct = v; normalizeMix(i); }),
        el('span', { class: 'v9-mix-pct' }, '% of the blend'),
        el('button', {
          class: 'btn small', title: 'Remove this product from the mix',
          click: () => {
            state.mix.splice(i, 1);
            if (state.mix.length === 1) { state.product = state.mix[0]!.product; state.mix = []; }
            else normalizeMix();
            persist(); rerender();
          },
        }, '✕'),
      ));
      // The blend at a glance: a 100%-wide share bar in the row colors.
      const bar = el('div', { class: 'v9-mix-bar', title: 'The blend — always exactly 100%' },
        ...state.mix.map((entry, i) => el('span', {
          class: 'v9-mix-seg',
          style: `width:${entry.pct}%;background:${MIX_COLORS[i % MIX_COLORS.length]}`,
          title: `${entry.product} — ${entry.pct}% of the blend`,
        })));
      mixBlock = el('div', { class: 'v9-mix' },
        el('h3', {}, 'Your product mix'),
        el('p', { class: 'v9-muted' },
          'Shares always total exactly 100% — edit one and the others rebalance. They set the RATIO of weekly unit output (60/40 = 60 units of the first for every 40 of the second). Characters are split between product lines and every line is judge-checked.'),
        ...rows,
        bar,
        el('p', { class: 'v9-muted v9-mix-total' }, `Total: ${state.mix.reduce((a, e) => a + e.pct, 0)}% ✓`),
        el('div', { class: 'v9-row' },
          state.mix.length < 6 ? el('button', {
            class: 'btn small', click: () => {
              const used = new Set(state.mix.map((e) => e.product));
              const next = [...SCHEMATICS.keys()].find((n) => !used.has(n));
              if (next !== undefined) {
                state.mix.push({ product: next, pct: Math.round(100 / (state.mix.length + 1)) });
                normalizeMix(state.mix.length - 1);
                persist(); rerender();
              }
            },
          }, '+ add product') : null,
          el('button', {
            class: 'btn small', title: 'Back to planning one product',
            click: () => { state.product = state.mix[0]!.product; state.mix = []; persist(); rerender(); },
          }, 'single product instead'),
        ),
      );
    }
  }

  // --- Sourcing: suggested by default, pinnable per input -------------------
  // Product modes pin each P1 (extract/refine/buy) AND each intermediate
  // (make/buy — 'buy' cuts the chain there: buy P3s, run just the P4 step).
  // Compare and Maximize-profits show global P1 preferences applied to every
  // candidate whose chain uses them (owner spec 2026-08-30).
  let sourcingBlock: HTMLElement | null = null;
  {
    const p1Row = (p1: string, current: string | null): HTMLElement => {
      const pinned = p1 in state.sourcingOverrides;
      return el('div', { class: 'v9-row' },
        el('span', {}, p1),
        el('select', {
          change: (ev) => {
            const v = (ev.target as HTMLSelectElement).value;
            if (v === 'auto') delete state.sourcingOverrides[p1];
            else state.sourcingOverrides[p1] = v as UiState['sourcingOverrides'][string];
            persist(); rerender();
          },
        },
          (() => {
            const o = el('option', { value: 'auto' }, current === null ? 'Suggested (auto)' : `Suggested (auto — currently ${current})`);
            if (!pinned) o.setAttribute('selected', 'selected');
            return o;
          })(),
          ...(['extract', 'refine', 'buy'] as const).filter((m) => !(p1 === state.product && m === 'buy')).map((m) => {
            const label = m === 'extract' ? 'extract (mine it)' : m === 'refine' ? 'refine (buy ore, 150:1)' : 'buy finished';
            const o = el('option', { value: m }, label);
            if (pinned && state.sourcingOverrides[p1] === m) o.setAttribute('selected', 'selected');
            return o;
          })),
      );
    };
    const interRow = (name: string): HTMLElement => {
      const pinned = name in state.sourcingOverrides;
      const cur = state.sourcingOverrides[name];
      return el('div', { class: 'v9-row' },
        el('span', {}, `${name} (P${tierOf(name)})`),
        el('select', {
          change: (ev) => {
            const v = (ev.target as HTMLSelectElement).value;
            if (v === 'auto') delete state.sourcingOverrides[name];
            else state.sourcingOverrides[name] = v as UiState['sourcingOverrides'][string];
            persist(); rerender();
          },
        },
          (() => { const o = el('option', { value: 'auto' }, 'Suggested (auto — may buy it when that nets more)'); if (!pinned) o.setAttribute('selected', 'selected'); return o; })(),
          (() => { const o = el('option', { value: 'make' }, 'make it in-house'); if (pinned && cur === 'make') o.setAttribute('selected', 'selected'); return o; })(),
          (() => { const o = el('option', { value: 'buy' }, 'buy finished — cut the chain here'); if (pinned && cur === 'buy') o.setAttribute('selected', 'selected'); return o; })(),
        ),
      );
    };
    if (state.mode === 'compare' || state.mode === 'profit') {
      const allP1s = [...SCHEMATICS.keys()].filter((n) => tierOf(n) === 1).sort();
      sourcingBlock = el('details', { class: 'v9-sourcing' },
        el('summary', {}, 'Adjust sourcing preferences'),
        el('p', { class: 'v9-muted' },
          'Pins here apply to every candidate whose chain uses them; anything on Suggested is decided per product.'),
        ...allP1s.map((p1) => p1Row(p1, null)),
      );
    } else if (mixActive) {
      // Union of the mix's P1 inputs — pins apply to every line that uses them.
      const union = new Set<string>();
      for (const e of state.mix) { try { for (const p1 of p1InputsOf(e.product)) union.add(p1); } catch { /* mid-edit */ } }
      sourcingBlock = el('details', { class: 'v9-sourcing' },
        el('summary', {}, 'Adjust sourcing preferences (whole mix)'),
        el('p', { class: 'v9-muted' },
          'Pins apply to every line in your mix that uses them.'),
        ...[...union].sort().map((p1) => p1Row(p1, null)),
      );
    } else {
      let rows: HTMLElement[] = [];
      try {
        // With an empty roster there is no world to derive defaults from —
        // fall back to the plain mine-it pins so the panel still renders.
        const heuristic = state.characters.length > 0 ? currentSourcing(state) : extractDefaults(state.product);
        rows = p1InputsOf(state.product).map((p1) => p1Row(p1, heuristic[p1] ?? null));
        const inters = chainIntermediates(state.product);
        if (inters.length > 0) {
          rows.push(el('p', { class: 'v9-muted v9-inter-head' },
            el('b', {}, 'Intermediate parts'), ' — buy one finished and the plan skips everything beneath it.'));
          rows.push(...inters.map(interRow));
        }
      } catch { /* product mid-edit */ }
      sourcingBlock = el('details', { class: 'v9-sourcing' },
        el('summary', {}, 'Adjust sourcing (default: mine it)'),
        el('p', { class: 'v9-muted' },
          'Set anything to Suggested (auto) and the tool picks for it, naming each choice with its reason.'),
        ...rows,
      );
    }
    if (!state.advancedMode && !revealSourcing) sourcingBlock = null;
    // Keep the panel open across the rerender each pin change triggers.
    if (sourcingBlock !== null) {
      const d = sourcingBlock as HTMLDetailsElement;
      if (sourcingOpen) d.setAttribute('open', '');
      d.addEventListener('toggle', () => { sourcingOpen = d.open; });
    }
  }

  const children: Array<Node | null> = [
    el('h3', {}, 'Select a Goal'),
    modeBlock,
    // The goal dictates whether a product is even a question: compare ranks
    // ALL products itself, so no product dropdown exists in that mode.
    state.mode !== 'compare' && state.mode !== 'profit' && !mixActive
      ? el('div', { class: 'v9-row' }, el('label', {}, 'Product '), productSel)
      : null,
    mixBlock,
    state.mode === 'quota'
      ? el('label', {}, 'Target/week ', numInput(state.quotaPerWeek, 1, 1e9, 1, (v) => { state.quotaPerWeek = v; }))
      : null,
    state.mode === 'qol'
      ? el('label', {}, 'Max sessions/week ', numInput(state.qolSessions, 0.5, 28, 0.5, (v) => { state.qolSessions = v; }))
      : null,
    detailBlock,
    sourcingBlock,
    // ONE solve button lives on the page — the gold one in the always-visible
    // bar below (owner: two identical gold buttons read as two different
    // actions). This breadcrumb keeps section 1 pointing at it.
    (() => {
      const readiness = currentReadiness();
      const row = el('div', { class: 'v9-solve-crumb v9-muted' },
        el('span', {}, 'The gold '),
        el('b', {}, 'SOLVE'),
        el('span', {}, ' button at the bottom runs everything.'));
      if (!readiness.ready) {
        row.append(el('div', { class: 'v9-crumb-missing' },
          el('b', {}, 'It unlocks when: '),
          ...readiness.missing.map((m) => el('div', {}, `• ${m}`))));
      }
      return row;
    })(),
  ];
  children.push(nextStepBtn('sec3', 'sec1'));
  body.replaceChildren(...children.filter((c): c is Node => c !== null));
}

// ---------------------------------------------------------------------------
// Section 5 on the page — Results
// ---------------------------------------------------------------------------

function colonyTemplate(r: SolveResult): string {
  const lines: string[] = [];
  const byChar = new Map<string, string[]>();
  for (const c of r.plan.colonies) {
    const bits: string[] = [`${c.planetName} (${c.planetType}) — CC L${c.ccLevel}`];
    for (const e of c.plan.extractors) bits.push(`  ECU on ${e.resource} @ ${e.programHours}h (w=${fmt1(e.w)})`);
    for (const f of c.plan.factories) bits.push(`  ${f.count}× ${SCHEMATICS.get(f.schematic)!.facility} → ${f.schematic}`);
    if (c.layout.launchpads > 0) bits.push(`  ${c.layout.launchpads}× launchpad${c.layout.storage > 0 ? `, ${c.layout.storage}× storage` : ''}`);
    for (const i of c.plan.imports) bits.push(`  import ${fmt1(i.qtyPerHour)}/h ${i.commodity}`);
    const arr = byChar.get(c.characterName) ?? [];
    arr.push(bits.join('\n'));
    byChar.set(c.characterName, arr);
  }
  for (const [name, cols] of byChar) {
    lines.push(`=== ${name} (${cols.length} colonies) ===`);
    lines.push(...cols, '');
  }
  for (const p of r.plan.logistics?.purchases ?? []) {
    lines.push(`BUY ${fmt(p.qtyPerHour * 168)} ${p.commodity} per week`);
  }
  return lines.join('\n');
}

/** One-click template for a planned colony, via the legacy template layer:
 * a byte-exact community template when the library has one for this planet
 * type + product, else a generated layout — ALWAYS flagged ⚠ verify. */
interface TplResult {
  ok: boolean; source?: 'library' | 'generated'; name?: string; credit?: string;
  label?: string; json?: string; cautions?: string[]; why?: string;
}

function copyText(text: string): Promise<void> {
  try { return navigator.clipboard.writeText(text); } catch { return Promise.reject(new Error('clipboard unavailable')); }
}

function colonyTemplateRow(c: SolveResult['plan']['colonies'][number]): HTMLElement | null {
  const api = (globalThis as unknown as { __v9tpl?: { forColony: (spec: unknown) => TplResult } }).__v9tpl;
  if (api === undefined) return null; // legacy layer absent (tests) — no row
  const kinds = c.plan.factories.map((f) => SCHEMATICS.get(f.schematic)?.facility ?? 'advanced');
  const role = c.plan.extractors.length > 0 ? 'extract'
    : kinds.includes('hightech') ? 'ht'
      : kinds.every((k) => k === 'basic') ? 'refine' : 'advanced';
  const res = api.forColony({
    planetType: c.planetType,
    ccLevel: c.ccLevel,
    role,
    p0: c.plan.extractors[0]?.resource,
    p1: role === 'extract' ? c.plan.factories[0]?.schematic : undefined,
    schematics: c.plan.factories.map((f) => ({ name: f.schematic, count: f.count })),
  });
  if (!res.ok || res.json === undefined) {
    return el('div', { class: 'v9-tpl' }, el('span', { class: 'v9-muted' }, `No 1-click template: ${res.why ?? 'unavailable'}`));
  }
  const idle = '⧉ Copy template';
  const btn = el('button', {
    class: 'btn small', type: 'button',
    click: () => {
      copyText(res.json!).then(() => { btn.textContent = '✓ Copied — import in game'; })
        .catch(() => { btn.textContent = 'Copy failed'; });
      setTimeout(() => { btn.textContent = idle; }, 2200);
    },
  }, idle);
  const row = el('div', { class: 'v9-tpl' }, btn);
  if (res.source === 'library') {
    row.append(el('span', { class: 'v9-tpl-src' }, `library: ${res.name ?? ''} · ${res.credit ?? ''}`));
  } else {
    row.append(el('span', { class: 'v9-tpl-caution' }, '⚠︎ generated — verify in game before trusting'));
    if (res.label !== undefined && res.label !== '') row.append(el('span', { class: 'v9-tpl-src' }, ` · ${res.label}`));
  }
  for (const note of res.cautions ?? []) row.append(el('div', { class: 'v9-tpl-note v9-muted' }, note));
  return row;
}

/** Character-by-character, planet-by-planet dashboard of the solved plan —
 * the same facts as the copy-paste build sheet, rendered as cards. */
function characterDashboard(r: SolveResult): HTMLElement {
  const byChar = new Map<string, Array<typeof r.plan.colonies[number]>>();
  for (const c of r.plan.colonies) {
    const arr = byChar.get(c.characterName) ?? [];
    arr.push(c);
    byChar.set(c.characterName, arr);
  }
  const charCards = [...byChar.entries()].map(([name, cols]) =>
    el('div', { class: 'v9-card v9-char' },
      el('h4', {}, `${name} — ${cols.length} colon${cols.length === 1 ? 'y' : 'ies'}`),
      ...cols.map((c) => el('div', { class: 'v9-colony' },
        el('div', { class: 'v9-colony-head' },
          el('b', {}, c.planetName), ` (${c.planetType}) · CC L${c.ccLevel}`),
        el('ul', { class: 'v9-colony-lines' },
          ...c.plan.extractors.map((e) => el('li', {},
            `ECU → ${e.resource} @ ${e.programHours}h (${fmt1(densityPctFromW(e.w))}%)`)),
          ...c.plan.factories.map((f) => el('li', {},
            `${f.count}× ${SCHEMATICS.get(f.schematic)!.facility} → ${f.schematic}`)),
          c.layout.launchpads > 0
            ? el('li', {}, `${c.layout.launchpads}× launchpad${c.layout.storage > 0 ? ` · ${c.layout.storage}× storage` : ''}`)
            : null,
          ...c.plan.imports.map((i) => el('li', { class: 'v9-import' },
            `import ${fmt1(i.qtyPerHour)}/h ${i.commodity}`)),
        ),
        colonyTemplateRow(c),
      )),
    ));
  const buys = r.plan.logistics?.purchases ?? [];
  return el('div', {},
    el('h3', {}, 'Plan by character'),
    el('div', { class: 'v9-cards v9-char-grid' }, ...charCards),
    buys.length > 0
      ? el('div', { class: 'v9-card' }, el('h4', {}, 'Weekly shopping list'),
        ...buys.map((p) => el('p', {}, `BUY ${fmt(p.qtyPerHour * 168)} ${p.commodity} per week`)))
      : null,
  );
}

function insightCard(i: Insight): HTMLElement {
  return el('div', { class: 'v9-card v9-insight' },
    el('h4', {}, i.title),
    el('p', {}, i.detail),
    el('p', { class: 'v9-muted' }, `inputs: ${i.inputs.join(' · ')}`),
  );
}

function renderResult(r: SolveResult, s: UiState, extra: HTMLElement[] = []): HTMLElement {
  const box = el('div', {});
  const bound = r.upperBoundPerWeek > 0 ? (r.realizedPerWeek / r.upperBoundPerWeek) * 100 : 100;

  let eco: ReturnType<typeof economics> | null = null;
  let ecoErr: string | null = null;
  try {
    eco = economics(r, toMarket(s), s.programHours);
  } catch (e) {
    // No raw engine text on screen — "missing-price: X — refusing to value
    // it silently" was reaching this card verbatim (user report).
    ecoErr = friendlyRefusal((e as Error).message);
  }

  // UI-review #6 (owner-approved 2026-09-01): THE ANSWER first, one card,
  // before any supporting table. A loss leads with the loss.
  const losing = eco !== null && eco.netPerWeek < 0;
  box.append(el('div', { class: `v9-verdict${losing ? ' v9-verdict-loss' : ''}` },
    el('p', { class: 'v9-big v9-verdict-main' },
      eco !== null
        ? (losing
          ? `This plan LOSES ${fmt(-eco.netPerWeek)} ISK/week building ${r.product}`
          : `You'll clear ~${fmt(eco.netPerWeek)} ISK/week building ${r.product}`)
        : `You'll make ${fmt(r.realizedPerWeek)} ${r.product}/week`),
    el('p', { class: 'v9-muted' },
      `${fmt(r.realizedPerWeek)} units/wk · ${r.slotsUsed} colonies`
      + (eco === null && ecoErr !== null ? ` — ISK not shown: ${ecoErr}` : '')),
    // 4-both (owner 2026-09-02): tweak AFTER seeing the answer — these chips
    // reveal the matching control (even in Simple) and take you to it.
    el('div', { class: 'v9-row v9-tweaks' },
      el('button', {
        class: 'btn small',
        click: () => {
          revealSourcing = true; sourcingOpen = true;
          document.getElementById('sec3')?.classList.remove('collapsed');
          rerender();
          document.getElementById('sec3')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }, '⚙ Adjust where parts come from'),
      (s.mode === 'max' || s.mode === 'quota' || s.mode === 'qol')
        ? el('button', {
          class: 'btn small',
          click: () => {
            revealMix = true;
            document.getElementById('sec3')?.classList.remove('collapsed');
            rerender();
            document.getElementById('sec3')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        }, '+ Add a second product')
        : null,
    ),
  ));

  // The rest lives under three plain tabs: what to build, the money, and why.
  const panes = {
    plan: el('div', { class: 'v9-pane' }),
    money: el('div', { class: 'v9-pane' }),
    why: el('div', { class: 'v9-pane' }),
  } as const;
  const tabBtns = new Map<keyof typeof panes, HTMLElement>();
  const showPane = (key: keyof typeof panes): void => {
    for (const [k, pane] of Object.entries(panes)) pane.hidden = k !== key;
    for (const [k, b] of tabBtns) b.classList.toggle('active', k === key);
  };
  const tabbar = el('div', { class: 'v9-tabbar' },
    ...([['plan', 'Plan — what to build'], ['money', 'Money'], ['why', 'Why this plan']] as const).map(([k, label]) => {
      const b = el('button', { class: 'btn small v9-tab', click: () => showPane(k) }, label);
      tabBtns.set(k, b);
      return b;
    }));
  box.append(tabbar, panes.plan, panes.money, panes.why);

  // PLAN — the build itself.
  panes.plan.append(characterDashboard(r));
  panes.plan.append(
    el('h3', {}, 'Build sheet (copy-paste)'),
    el('textarea', { class: 'v9-template', readonly: 'readonly' }, colonyTemplate(r)),
    el('p', { class: 'v9-muted' }, r.notes.join(' · ')),
  );

  // MONEY — the ledger-backed numbers.
  if (eco !== null) {
    panes.money.append(el('div', { class: 'v9-cards' },
      el('div', { class: 'v9-card' }, el('h4', {}, 'Net'), el('p', { class: 'v9-big' }, `${fmt(eco.netPerWeek)} ISK/wk`)),
      el('div', { class: 'v9-card' }, el('h4', {}, 'Per session'), el('p', {}, `${fmt(eco.netPerSession)} ISK × ${fmt1(eco.sessionsPerWeek)} sessions/wk`)),
      el('div', { class: 'v9-card' }, el('h4', {}, 'Gross'), el('p', {}, `${fmt(eco.grossPerWeek)} ISK/wk`)),
    ));
    panes.money.append(el('details', { class: 'v9-ledger' },
      el('summary', {}, `Ledger (${eco.ledger.lines.length} lines — reconciles exactly to net)`),
      el('table', { class: 'v9-table' },
        ...eco.ledger.lines.map((l) => el('tr', {}, el('td', {}, l.label), el('td', { class: l.isk < 0 ? 'v9-neg' : 'v9-pos' }, fmt(l.isk)))),
        el('tr', { class: 'v9-total' }, el('td', {}, 'NET'), el('td', {}, fmt(eco.ledger.net))),
      ),
    ));
  } else {
    panes.money.append(el('div', { class: 'v9-warn' }, `Output solved, ISK not shown: ${ecoErr ?? 'prices missing'}`));
  }

  // WHY — quality, insights, deep analytics.
  panes.why.append(el('div', { class: 'v9-cards' },
    el('div', { class: 'v9-card' }, el('h4', {}, 'Answer quality'), el('p', {}, `${r.method}${r.method === 'exhaustive' ? ' (exact for this world)' : ''} — ${bound.toFixed(1)}% of the relaxation bound`)),
  ));
  const quick = [optimalityInsight(r), ...bottleneckReport(r), runwayInsight(r)];
  panes.why.append(el('h3', {}, 'Insights'), el('div', { class: 'v9-cards' }, ...quick.map(insightCard)));

  const deepBtn = el('button', {
    class: 'btn',
    click: () => {
      deepBtn.textContent = 'Computing (re-solves every alternative)…';
      setTimeout(() => {
        try {
          const report = analyze(toWorld(s), r, toMarket(s));
          const quickIds = new Set(quick.map((q) => q.id));
          const deep = report.insights.filter((i) => !quickIds.has(i.id) && !i.id.startsWith('slack:'));
          const cadence = el('table', { class: 'v9-table' },
            el('tr', {}, el('th', {}, 'Program'), el('th', {}, 'Sessions/wk'), el('th', {}, 'Net ISK/wk'), el('th', {}, 'Net ISK/session')),
            ...report.cadence.map((c) => el('tr', {},
              el('td', {}, `${c.programHours}h`),
              el('td', {}, fmt1(c.sessionsPerWeek)),
              el('td', {}, c.netPerWeek === null ? '—' : fmt(c.netPerWeek)),
              el('td', {}, c.netPerSession === null ? '—' : fmt(c.netPerSession)),
            )),
          );
          deepBtn.replaceWith(el('div', {},
            el('div', { class: 'v9-cards' }, ...deep.map(insightCard)),
            el('h3', {}, 'Cadence: ISK/week vs ISK/login'), cadence,
          ));
        } catch (e) {
          deepBtn.replaceWith(el('div', { class: 'v9-warn' }, `Deep analytics could not run: ${friendlyRefusal((e as Error).message)}`));
        }
      }, 30);
    },
  }, 'Deep analytics (what-ifs & cadence — takes a moment)');
  if (state.advancedMode) panes.why.append(deepBtn);
  else panes.why.append(el('p', { class: 'v9-muted' }, 'More what-ifs live in Advanced (top right).'));

  showPane('plan');
  box.append(...extra);
  return box;
}

/** The accuracy ladder's honesty end: every number built on a stand-in is
 * labeled with EXACTLY which stand-ins are in play. Returns null when nothing
 * was assumed (the Exact promise). */
function estimateBanner(): HTMLElement | null {
  const assumptions: string[] = [];
  const assumed = assumedDensityCount(state);
  if (assumed > 0 && state.spaceBand !== null) {
    assumptions.push(`${assumed} density value${assumed === 1 ? '' : 's'} assumed at ${QUICK_DENSITY_PCT[state.spaceBand]}% (${BAND_LABELS[state.spaceBand]} typical) — scan your planets for real numbers.`);
  }
  // The costs assumption only matters when ISK is actually on screen —
  // an unpriced solve shows output, not net.
  if (state.costsSource !== 'user' && Object.keys(state.prices).length > 0) {
    assumptions.push(`${costsSourceLabel()} Edit or confirm them in section 3.`);
  }
  if (assumptions.length === 0) return null;
  return el('div', { class: 'v9-warn v9-estimate' },
    el('b', {}, 'ESTIMATE — these numbers stand in for details you have not provided yet:'),
    ...assumptions.map((a) => el('div', {}, `• ${a}`)));
}

/** Disclose the sourcing the tool chose — every input, with its reason. */
function suggestionCard(s: SourcingSuggestion): HTMLElement {
  const pinned = Object.keys(state.sourcingOverrides).length;
  // Default make-in-house pins on intermediates are the quiet baseline —
  // one line, not a paragraph per part.
  const makePins = s.notes.filter((n) => n.mode === 'make' && /pinned/.test(n.reason));
  const loudNotes = s.notes.filter((n) => !makePins.includes(n));
  return el('div', { class: 'v9-card v9-suggest' },
    el('h4', {}, 'Sourcing — chosen for you'),
    ...loudNotes.map((n) => el('p', {}, el('b', {}, `${n.p1}: ${n.mode}`), ` — ${n.reason}`)),
    makePins.length > 0
      ? el('p', { class: 'v9-muted' }, `${makePins.length} intermediate part${makePins.length === 1 ? '' : 's'} made in-house (${makePins.map((n) => n.p1).join(', ')}) — “buy finished” under Adjust sourcing cuts the chain there.`)
      : null,
    el('p', { class: 'v9-muted' },
      s.refined
        ? 'Choices were price-compared: each alternative re-solved (fast solver) and settled through the one ledger, single deterministic pass — the plan below is the full solve of the winner.'
        : `Heuristic choice${s.refinementSkipped !== undefined ? ` — ${s.refinementSkipped}` : ''}.`,
    ),
    pinned > 0 ? el('p', { class: 'v9-muted' }, `${pinned} input${pinned === 1 ? '' : 's'} pinned by you (never overruled).`) : null,
    el('p', { class: 'v9-muted' }, 'To overrule any of these, pin it under “Adjust sourcing” in section 1.'),
  );
}

/** Review P1: refusals speak English. Engine refusal strings are precise but
 * read like a stack trace ("quota-unreachable: place-extract: ..."); map the
 * known codes to plain sentences and keep the raw text one click away. */
function friendlyRefusal(raw: string): string {
  const quota = raw.startsWith('quota-unreachable: ');
  const inner = quota ? raw.slice('quota-unreachable: '.length) : raw;
  let m: RegExpMatchArray | null;
  // Review #9: placement refusals get the rule that explains them — one
  // character places one colony per planet, so planets (or characters) are
  // usually the unlock.
  const placementNudge = ' One character can place only one colony per planet — adding planets (or characters) unlocks more colonies.';
  if ((m = inner.match(/^place-extract: only (\d+)\/(\d+) colonies placeable for (.+)$/)) !== null)
    return `This target doesn't fit: ${m[3]} needs ${m[2]} extraction colonies, but only ${m[1]} can be placed.${placementNudge}`;
  if (inner.startsWith('place-ht:'))
    return `No Barren or Temperate planet has room for the high-tech colony this plan needs.${placementNudge}`;
  if (inner.startsWith('place-factory:'))
    return `No planet capacity is left to place a factory colony.${placementNudge}`;
  if ((m = inner.match(/^needs (\d+) colonies, operation has (\d+) slots$/)) !== null)
    return `This target needs ${m[1]} colonies, but your characters have ${m[2]} colony slots between them.`;
  if ((m = inner.match(/^the buildable plan realizes (.+?)\/wk, short of (.+?)\/wk$/)) !== null)
    return `The best buildable plan makes ${m[1]}/wk — short of the ${m[2]}/wk target.`;
  if ((m = inner.match(/^no-planet-for: (.+?) \((.+?)\)/)) !== null)
    return `No accessible planet carries ${m[2]}, which the plan needs to extract for ${m[1]}.`;
  if ((m = inner.match(/^no-capacity-for: (.+)$/)) !== null)
    return `Your planets don't have enough extraction capacity for ${m[1]}.${placementNudge}`;
  if (inner.startsWith('quota-invalid:'))
    return 'The weekly target must be a number above zero.';
  if ((m = inner.match(/^mix-line-failed: (.+?): (.+)$/)) !== null)
    return `${m[1]} (one line of your mix): ${friendlyRefusal(m[2] ?? '')}`;
  if ((m = inner.match(/^mix-(?:invalid|infeasible): (.+)$/)) !== null)
    return `Mix: ${m[1]}.`;
  if (inner === 'the operation cannot carry this blend at that rate')
    return 'This blend can’t be carried at that total rate — your characters can’t cover every line of the mix at once.';
  if ((m = inner.match(/^missing-price: (.+?) — refusing to (?:value|cost) it silently$/)) !== null)
    return `No Jita price is loaded for ${m[1]} yet — press “Fetch live Jita prices” in section 3 (or enter its quote) and try again.`;
  if (inner.startsWith('no-viable-product:'))
    return 'No product could be ranked — usually prices are missing. Fetch Jita prices in section 3, then try again.';
  if (inner.startsWith('qol-invalid:'))
    return 'The sessions-per-week budget must be a number above zero (and at least one program length must fit inside it).';
  if ((m = inner.match(/^qol-infeasible: (.+) cannot be produced/)) !== null)
    return `${m[1]} can't be produced from these planets at any program length — no combination covers its chain.`;
  if ((m = inner.match(/^infeasible: (.+) cannot be produced/)) !== null)
    return `${m[1]} can't be produced from these planets — no combination of them covers its whole chain.`;
  if (inner.startsWith('infeasible:'))
    return 'Nothing can be produced from this setup — check that your planets carry the resources this chain needs.';
  if ((m = inner.match(/^duplicate planet name "(.+)"/)) !== null)
    return `Two planets share the name “${m[1]}” — duplicate names make a plan ambiguous. Rename one in section 3.`;
  if (inner.startsWith('pack-overflow'))
    return 'The plan’s facilities don’t physically fit its colonies — this shouldn’t happen; please report it with your save file.';
  if (inner.startsWith('judge-rejected:'))
    return 'The independent judge rejected this plan, so the tool refuses to show it — this shouldn’t happen; please report it with your save file.';
  return quota ? `This quota can't be met: ${inner}` : inner;
}

/** One refusal block: plain sentence, optional one-click achievable target,
 * raw engine text behind a summary for bug reports. */
function refusalBox(raw: string, opts?: { achievable?: number | undefined; onSetTarget?: ((n: number) => void) | undefined }): HTMLElement {
  const kids: (HTMLElement | null)[] = [el('p', { class: 'v9-refusal-msg' }, friendlyRefusal(raw))];
  if (opts?.achievable !== undefined && Number.isFinite(opts.achievable) && opts.achievable > 0) {
    const n = Math.floor(opts.achievable);
    kids.push(el('p', {},
      `Best achievable with your current setup: ${fmt(opts.achievable)}/wk. `,
      ...(opts.onSetTarget !== undefined && n > 0
        ? [el('button', { class: 'btn small', click: () => opts.onSetTarget!(n) }, `Set target to ${fmt(n)}/wk`)]
        : []),
    ));
  }
  kids.push(el('details', { class: 'v9-refusal-raw' },
    el('summary', {}, 'Engine detail'),
    el('code', {}, raw)));
  kids.push(el('p', { class: 'v9-muted v9-reset-hint' },
    'Something stuck? Press ⟲ Reset on the section involved, re-fetch Jita prices, and solve again.'));
  return el('div', { class: 'v9-warn' }, ...kids);
}

function runSolve(): void {
  const resultsBox = byId('resultsPanel');
  const gate = currentReadiness();
  if (!gate.ready) {
    const sec4g = document.getElementById('sec4');
    if (sec4g) sec4g.classList.remove('collapsed');
    resultsBox.replaceChildren(el('div', { class: 'v9-warn' },
      'Not ready to solve yet:\n' + gate.missing.map((m) => `• ${m}`).join('\n')));
    return;
  }
  const sec4 = document.getElementById('sec4');
  if (sec4) sec4.classList.remove('collapsed');
  resultsBox.replaceChildren(el('p', {}, 'Solving…'));
  const summary = document.getElementById('sec4Summary');
  setTimeout(() => {
    try {
      const world = toWorld(state);
      const banner = estimateBanner();
      if (state.mode === 'compare') {
        const { ranked, excluded } = comparative(world, toMarket(state), undefined, state.sourcingOverrides);
        if (summary) summary.textContent = `${ranked.length} viable products ranked${banner !== null ? ' (estimate)' : ''}`;
        announce(`Comparison complete: ${ranked.length} viable products ranked.`);
        // Rank order first; the user picks/confirms a product, THEN gets the
        // full best-path plan for it (goal switches to max output of that
        // product, so the choice is visible and revisitable in section 1).
        const pickPlan = (product: string, rankedSourcing?: Readonly<Record<string, Sourcing>>): void => {
          state.product = product;
          state.mode = 'max';
          state.modeChosen = true;
          // Seed sourcing so the plan can REPRODUCE the path that ranked:
          //   1. mine-it defaults, world-aware — an ore none of your planets
          //      carry is pinned 'buy' (a blanket extract pin dead-ended the
          //      pick at the scan gate — sweep finding);
          //   2. the ranked row's OWN sourcing on top — including any
          //      intermediate 'buy' cut comparative's second chance applied
          //      (without it, "make everything" defaults refuse a product
          //      that only ranked via the cut — sweep finding);
          //   3. pins made during Compare last: never overruled.
          const base = extractDefaults(product);
          try {
            const have = new Set(state.planets.flatMap((p) => p.resources.filter((r) => r.w > 0).map((r) => r.p0)));
            for (const p1 of p1InputsOf(product)) {
              try { if (!have.has(oreOf(p1))) base[p1] = 'buy'; } catch { /* not a p1 */ }
            }
          } catch { /* keep plain defaults */ }
          if (rankedSourcing !== undefined) {
            const inChain = new Set<string>([...p1InputsOf(product), ...chainIntermediates(product)]);
            for (const [k, v] of Object.entries(rankedSourcing)) {
              if (inChain.has(k)) base[k] = v;
            }
          }
          const kept = Object.fromEntries(Object.entries(state.sourcingOverrides)
            .filter(([k]) => p1InputsOf(product).includes(k) || chainIntermediates(product).includes(k)));
          state.sourcingOverrides = { ...base, ...kept };
          persist(); rerender();
          announce(`${product} picked from the comparison — planning its best path.`);
          runSolve();
        };
        // Split the exclusions: "no price loaded" is a fixable data gap, not
        // a verdict — one clear line with the fix, never a 40-bullet wall of
        // "missing-price: … refusing to value it silently" (user report).
        const priceMissing = excluded.filter((x) => x.reason.startsWith('missing-price:'));
        const otherExcluded = excluded.filter((x) => !x.reason.startsWith('missing-price:'));
        resultsBox.replaceChildren(
          ...(banner !== null ? [banner] : []),
          ...(priceMissing.length > 0 ? [el('div', { class: 'v9-warn' },
            el('p', { class: 'v9-refusal-msg' },
              `${priceMissing.length} product${priceMissing.length === 1 ? ' is' : 's are'} not ranked yet — no Jita price is loaded for ${priceMissing.length === 1 ? 'it' : 'them'}.`),
            el('p', {}, 'Press “Refresh now” in 3. MARKET (or enter quotes there), then solve again for the full ranking.'),
            el('details', {},
              el('summary', {}, 'Which products are waiting on a price'),
              el('p', { class: 'v9-muted' }, priceMissing.map((x) => x.product).join(' · '))),
          )] : []),
          // Audit B3: never truncate silently.
          el('p', { class: 'v9-muted' },
            (ranked.length > 15 ? `Top 15 shown of ${ranked.length} viable products. ` : `${ranked.length} viable product${ranked.length === 1 ? '' : 's'}. `)
            + 'Pick one and it is re-solved exactly — full plan, colonies, build sheet and analytics.'),
          el('table', { class: 'v9-table' },
            el('tr', {}, ...['#', 'Product', 'Net ISK/wk', 'Output/wk', 'Method', ''].map((h) => el('th', {}, h))),
            ...ranked.slice(0, 15).map((r, i) => el('tr', {},
              el('td', {}, String(i + 1)), el('td', {}, r.product),
              el('td', {}, fmt(r.economics.netPerWeek)), el('td', {}, fmt(r.result.realizedPerWeek)),
              el('td', {}, r.result.method),
              el('td', {}, el('button', { class: 'btn small', click: () => pickPlan(r.product, r.result.sourcing) }, 'Plan this →')),
            )),
          ),
          ...(otherExcluded.length > 0 ? [el('details', {},
            el('summary', {}, `${otherExcluded.length} product${otherExcluded.length === 1 ? '' : 's'} excluded — each with its reason${otherExcluded.length > 40 ? ' (first 40 shown)' : ''}`),
            el('ul', {}, ...otherExcluded.slice(0, 40).map((x) => el('li', {}, `${x.product}: ${friendlyRefusal(x.reason)}`))))] : []),
        );
        return;
      }
      if (state.mode === 'profit') {
        // Maximize profits (owner spec): product AND sourcing chosen
        // automatically — rank everything with the user's pins applied, then
        // give the winner the full treatment (price-compared suggested
        // sourcing that may buy intermediates, exact final solve).
        const { ranked, excluded } = comparative(world, toMarket(state), undefined, state.sourcingOverrides);
        if (ranked.length === 0) {
          resultsBox.replaceChildren(refusalBox(`no-viable-product: all candidates excluded (${excluded.length} reasons recorded)`));
          return;
        }
        const best = ranked[0]!;
        const pins = Object.fromEntries(Object.entries(state.sourcingOverrides)
          .filter(([k]) => { try { return p1InputsOf(best.product).includes(k) || chainIntermediates(best.product).includes(k); } catch { return false; } }));
        const bestSuggestion = suggestSourcing(world, best.product, toMarket(state), pins);
        let bestResult: SolveResult = best.result;
        const exact = solveMax(world, best.product, bestSuggestion.sourcing);
        if (!('error' in exact)) bestResult = exact;
        let bestEco: number = best.economics.netPerWeek;
        try { bestEco = economics(bestResult, toMarket(state), state.programHours).netPerWeek; } catch { /* keep ranking net */ }
        const headline = el('div', { class: 'v9-card v9-profit-pick' },
          el('h4', {}, 'Pick for me chose'),
          el('p', { class: 'v9-big' }, `${best.product} — ${fmt(bestEco)} ISK/wk net`),
          el('p', { class: 'v9-muted' }, `Ranked #1 of ${ranked.length} viable products. Pin anything under Adjust sourcing to constrain the next run.`),
          el('details', {},
            el('summary', {}, `Runners-up (top 10 of ${ranked.length})`),
            el('ul', {}, ...ranked.slice(0, 10).map((r, i) => el('li', {}, `#${i + 1} ${r.product} — ${fmt(r.economics.netPerWeek)} ISK/wk`)))),
        );
        if (summary) summary.textContent = `${best.product} · ${fmt(bestResult.realizedPerWeek)}/wk · maximize profits${banner !== null ? ' (estimate)' : ''}`;
        announce(`Pick for me chose ${best.product}: ${fmt(bestEco)} ISK per week.`);
        const rendered = renderResult(bestResult, state, [suggestionCard(bestSuggestion)]);
        rendered.prepend(headline);
        if (banner !== null) rendered.prepend(banner);
        resultsBox.replaceChildren(rendered);
        return;
      }
      if (mixIsActive(state)) {
        // PRODUCT MIX (owner spec): several products at a fixed percentage
        // ratio. Sourcing is suggested per line (pins applied); characters
        // are partitioned between lines; every line is judge-checked.
        const entries: MixEntry[] = state.mix.map((e) => ({
          product: e.product, share: e.pct,
          sourcing: suggestSourcing(world, e.product, toMarket(state), pinsFor(e.product)).sourcing,
        }));
        let mr: MixResult | { error: string; achievablePerWeek?: number };
        let cadence = state.programHours;
        if (state.mode === 'quota') {
          mr = solveMixQuota(world, entries, state.quotaPerWeek);
        } else if (state.mode === 'qol') {
          const cands = [6, 12, 24, 48, 96, 168, 336].filter((h) => 168 / h <= state.qolSessions + 1e-9);
          let best: { r: MixResult; net: number; h: number } | null = null;
          for (const h of cands) {
            const r = solveMixMax({ ...world, programHours: h }, entries);
            if ('error' in r) continue;
            let net = 0; let priced = true;
            for (const l of r.lines) {
              try { net += economics(l.result, toMarket(state), h).netPerWeek; } catch { priced = false; break; }
            }
            if (!priced) continue;
            if (best === null || net > best.net) best = { r, net, h };
          }
          if (best === null) {
            resultsBox.replaceChildren(refusalBox('mix-infeasible: no cadence inside your session budget can be priced and carried — fetch Jita prices in section 3 and check the mix'));
            return;
          }
          mr = best.r; cadence = best.h;
        } else {
          mr = solveMixMax(world, entries);
        }
        if ('error' in mr) {
          resultsBox.replaceChildren(refusalBox(mr.error, {
            achievable: mr.achievablePerWeek,
            onSetTarget: (n) => { state.quotaPerWeek = n; persist(); rerender(); runSolve(); },
          }));
          return;
        }
        // Bundle header: one row per line, combined net when fully priced.
        let totalNet: number | null = 0;
        const lineNet = new Map<string, number>();
        for (const l of mr.lines) {
          try { const n = economics(l.result, toMarket(state), cadence).netPerWeek; lineNet.set(l.product, n); if (totalNet !== null) totalNet += n; }
          catch { totalNet = null; }
        }
        const bundleCard = el('div', { class: 'v9-card v9-mix-summary' },
          el('h4', {}, 'Your mix — planned'),
          el('table', { class: 'v9-table' },
            el('tr', {}, ...['Product', 'Share', 'Planned/wk', 'Net ISK/wk', 'Characters'].map((h) => el('th', {}, h))),
            ...mr.lines.map((l) => el('tr', {},
              el('td', {}, l.product),
              el('td', {}, `${fmt1(l.sharePct)}%`),
              el('td', {}, fmt(l.result.realizedPerWeek)),
              el('td', {}, lineNet.has(l.product) ? fmt(lineNet.get(l.product)!) : '— (unpriced)'),
              el('td', {}, l.characters.join(', ')),
            )),
          ),
          el('p', { class: 'v9-big' }, totalNet !== null ? `${fmt(totalNet)} ISK/wk combined net` : `${fmt(mr.bundlePerWeek)} blended units/wk`),
          state.mode === 'qol' ? el('p', { class: 'v9-muted' }, `Chosen cadence: ${cadence}h programs (${fmt1(168 / cadence)} sessions/wk).`) : null,
          el('p', { class: 'v9-muted' }, mr.note),
        );
        const lineBlocks = mr.lines.map((l, i) => {
          const d = el('details', { class: 'v9-mix-line' },
            el('summary', {}, `${l.product} — full plan (${l.characters.join(', ')})`),
            renderResult(l.result, state, []));
          if (i === 0) d.setAttribute('open', 'open');
          return d;
        });
        if (summary) summary.textContent = `mix: ${mr.lines.map((l) => l.product).join(' + ')} · ${fmt(mr.bundlePerWeek)}/wk${banner !== null ? ' (estimate)' : ''}`;
        announce(`Mix planned: ${mr.lines.map((l) => `${fmt(l.result.realizedPerWeek)} ${l.product}`).join(', ')} per week.`);
        resultsBox.replaceChildren(...(banner !== null ? [banner] : []), bundleCard, ...lineBlocks);
        return;
      }
      // Sourcing is an OUTPUT here: the tool picks per input from the goal,
      // the world and (when loaded) prices; user pins are applied verbatim.
      const suggestion = suggestSourcing(world, state.product, toMarket(state), state.sourcingOverrides);
      const sourcing = suggestion.sourcing;
      let result: SolveResult;
      const extra: HTMLElement[] = [suggestionCard(suggestion)];
      if (state.mode === 'quota') {
        const q = solveQuota(world, state.product, state.quotaPerWeek, sourcing);
        if ('error' in q) {
          resultsBox.replaceChildren(refusalBox(q.error, {
            achievable: q.achievablePerWeek,
            onSetTarget: (n) => { state.quotaPerWeek = n; persist(); rerender(); runSolve(); },
          }));
          return;
        }
        result = q;
      } else if (state.mode === 'qol') {
        const q = qolSolve(world, state.product, toMarket(state), state.qolSessions, sourcing);
        if ('error' in q) { resultsBox.replaceChildren(refusalBox(q.error)); return; }
        result = q.result;
        extra.push(el('p', { class: 'v9-muted' }, `Chosen cadence: ${q.programHours}h programs (${fmt1(168 / q.programHours)} sessions/wk).`));
      } else {
        const r = solveMax(world, state.product, sourcing);
        if ('error' in r) { resultsBox.replaceChildren(refusalBox(r.error)); return; }
        result = r;
      }
      if (summary) summary.textContent = `${fmt(result.realizedPerWeek)} ${result.product}/wk · ${result.method}${banner !== null ? ' (estimate)' : ''}`;
      announce(`Solved: ${fmt(result.realizedPerWeek)} ${result.product} per week using ${result.slotsUsed} colonies.`);
      const rendered = renderResult(result, state, extra);
      if (banner !== null) rendered.prepend(banner);
      resultsBox.replaceChildren(rendered);
    } catch (e) {
      resultsBox.replaceChildren(refusalBox((e as Error).message));
      announce('Solve failed — see the results section for the reason.');
    }
  }, 30);
}

/** Audit #14: write the screen-reader live region v8 used to announce results. */
function announce(text: string): void {
  const region = document.getElementById('calcAnnounce');
  if (region) region.textContent = text;
}

// ---------------------------------------------------------------------------
// Shell wiring: hero buttons, flat rate, sticky bar — the carried-over skin's
// controls, driven by v9 state.
// ---------------------------------------------------------------------------

function syncModeButtons(): void {
  document.getElementById('modeSimpleBtn')?.classList.toggle('active', !state.advancedMode);
  document.getElementById('modeAdvancedBtn')?.classList.toggle('active', state.advancedMode);
}

function wireShell(): void {
  document.getElementById('modeSimpleBtn')?.addEventListener('click', () => {
    state.advancedMode = false; persist(); rerender(); syncModeButtons();
  });
  document.getElementById('modeAdvancedBtn')?.addEventListener('click', () => {
    state.advancedMode = true; persist(); rerender(); syncModeButtons();
  });
  syncModeButtons();
  document.getElementById('stickyCalcBtn')?.addEventListener('click', runSolve);
  const info = document.getElementById('stickyCalcInfo');
  if (info) info.textContent = 'Judge-checked plans · one ledger · answers carry their optimality bound';

  // Review P1: the fixed bottom bar must reserve its REAL height (it varies
  // with wrapping, zoom and the bigger SOLVE button) so it never covers the
  // last rows of a section; scroll-padding keeps focused controls above it.
  const bar = document.getElementById('stickyCalc');
  if (bar !== null) {
    const reserve = (): void => {
      const h = Math.ceil(bar.getBoundingClientRect().height) + 16;
      document.body.style.paddingBottom = `${h}px`;
      document.documentElement.style.scrollPaddingBottom = `${h}px`;
    };
    reserve();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(reserve).observe(bar);
    window.addEventListener('resize', reserve);
  }

  document.getElementById('saveDataBtn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ solvingPiV9: 1, state }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `solving-pi-v9-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    const s = document.getElementById('saveLoadStatus');
    if (s) s.textContent = 'Saved a file with everything you have entered.';
  });
  const loadInput = document.getElementById('loadDataInput') as HTMLInputElement | null;
  document.getElementById('loadDataBtn')?.addEventListener('click', () => loadInput?.click());
  loadInput?.addEventListener('change', async () => {
    const f = loadInput.files?.[0];
    if (f === undefined) return;
    try {
      const parsed = JSON.parse(await f.text()) as { solvingPiV9?: number; state?: UiState };
      if (parsed.solvingPiV9 !== 1 || parsed.state === undefined) throw new Error('not a Solving PI v9 save file');
      // Same sanitizer as the autosave path — a hand-edited or corrupt file
      // must never smuggle illegal planets/modes past validation.
      state = sanitizeState(parsed.state);
      persist(); rerender();
      const s = document.getElementById('saveLoadStatus');
      if (s) s.textContent = `Loaded ${f.name}.`;
    } catch (e) {
      const s = document.getElementById('saveLoadStatus');
      // JSON parser noise ("Unexpected token …") means nothing to a user.
      const msg = (e as Error).message;
      if (s) s.textContent = `Could not load that file: ${/Unexpected|JSON|token/i.test(msg) ? 'it is not valid save-file data' : msg}. Use a file made by “Save My Data”.`;
    }
  });
  document.getElementById('resetAllBtn')?.addEventListener('click', () => {
    if (confirm('Reset everything to defaults?')) { state = defaultState(); persist(); rerender(); }
  });

  // Per-section resets (v8 chrome, v9 state slices). Each resets ONLY its own
  // section's slice, after a confirm that names what is about to go.
  const resets: Record<string, { what: string; run: () => void }> = {
    sec3: {
      what: 'your goal — product, mode, detail level, space band and sourcing pins',
      run: () => {
        const d = defaultState();
        state.product = d.product; state.mode = d.mode; state.modeChosen = d.modeChosen;
        state.detailLevel = d.detailLevel; state.spaceBand = d.spaceBand;
        state.quotaPerWeek = d.quotaPerWeek; state.qolSessions = d.qolSessions;
        state.sourcingOverrides = d.sourcingOverrides;
        state.mix = d.mix;
      },
    },

    sec1: { what: 'your characters AND all planets with their scan values', run: () => { state.characters = []; state.charactersDone = false; state.planets = defaultState().planets; flatRateUndo = null; } },
    sec2: {
      what: 'all prices, fees and freight rates',
      run: () => {
        const d = defaultState();
        state.prices = d.prices; state.priceNote = d.priceNote; state.fees = d.fees;
        state.freight = d.freight; state.sellBasis = d.sellBasis; state.buyBasis = d.buyBasis;
        state.costsSource = d.costsSource;
      },
    },
    sec4: {
      what: 'the solved results shown below (your inputs are kept)',
      run: () => {
        document.getElementById('resultsPanel')?.replaceChildren();
        const sum = document.getElementById('sec4Summary');
        if (sum) sum.textContent = '';
      },
    },
  };
  for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-reset]')) {
    const target = btn.dataset['reset'] ?? '';
    const r = resets[target];
    if (r === undefined) continue;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!confirm(`Reset this section? This clears ${r.what}.`)) return;
      r.run();
      persist(); rerender();
      announce('Section reset to defaults.');
    });
  }

  wireSystemSearch();

  // UI-review #9: a working example beats any explanation. Fictional sample
  // world (never anyone's real colonies — non-negotiable), prices fetch
  // themselves, SOLVE is one press away.
  document.getElementById('loadExampleBtn')?.addEventListener('click', () => {
    if ((state.planets.length > 0 || state.characters.length > 0)
      && !confirm('Load the example? This replaces what you have entered (Save My Data first if you want to keep it).')) return;
    const ex = defaultState();
    ex.mode = 'compare'; ex.modeChosen = true; // the example arrives ready
    ex.characters = [
      { name: 'Main', icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 },
      { name: 'Alt 1', icLevel: 4, ccuLevel: 5, customsCodeLevel: 4, accountingLevel: 4, brokerRelationsLevel: 3 },
    ];
    ex.charactersDone = true;
    const exPlanet = (name: string, type: PlanetType, pct: number): UiPlanet => ({
      name, type, system: 'Sample', minimized: false,
      resources: resourcesOf(type).map((p0, i) => ({ p0, w: wFromDensityPct(pct - i * 4) })),
    });
    ex.planets = [
      exPlanet('Sample I', 'Storm', 92), exPlanet('Sample II', 'Gas', 88),
      exPlanet('Sample III', 'Barren', 85), exPlanet('Sample IV', 'Lava', 90),
      exPlanet('Sample V', 'Plasma', 87),
    ];
    ex.detailLevel = 'refined';
    state = ex;
    prevNextStep = 'boot'; // let auto-advance re-place the open section
    persist(); rerender();
    if (unpricedNeeded().length > 0) void refreshJitaPrices(undefined, { fillOnly: true });
    announce('Example loaded — press SOLVE to see a full plan. RESET EVERYTHING clears it.');
    document.getElementById('main')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('applyFlatRate')?.addEventListener('click', () => {
    const pct = Number((document.getElementById('flatRate') as HTMLInputElement | null)?.value ?? 65);
    if (!Number.isFinite(pct) || pct <= 0) return;
    flatRateUndo = structuredClone(state.planets);
    const w = wFromDensityPct(pct);
    for (const p of state.planets) for (const r of p.resources) r.w = w;
    const st = document.getElementById('flatRateStatus');
    if (st) st.textContent = `Applied ${pct}% (w=${fmt1(w)}) to every resource on every planet — an estimate, not your real numbers.`;
    persist(); rerender();
  });
  // Per-security-band quick buttons: set the flat-density field to the band's
  // typical value (same anchors as the Quick estimate detail level).
  for (const bandBtn of document.querySelectorAll<HTMLButtonElement>('button[data-band]')) {
    const band = bandBtn.dataset['band'] as SpaceBand | undefined;
    if (band === undefined || !(SPACE_BANDS as readonly string[]).includes(band)) continue;
    bandBtn.addEventListener('click', () => {
      const input = document.getElementById('flatRate') as HTMLInputElement | null;
      if (input) input.value = String(QUICK_DENSITY_PCT[band]);
      // Recording the band here also feeds the Quick-estimate detail level
      // (and its cost prefill) — this box is the single space-type control.
      state.spaceBand = band;
      if (state.costsSource !== 'user') applyCostPreset(band);
      persist(); rerender();
      const st = document.getElementById('flatRateStatus');
      if (st) st.textContent = `${BAND_LABELS[band]} recorded (typical ${QUICK_DENSITY_PCT[band]}%). Press “Apply to all planets” to write it into every resource — or leave your scans alone; Quick estimate uses the band only where you haven't scanned.`;
    });
  }

  document.getElementById('clearFlatRate')?.addEventListener('click', () => {
    if (flatRateUndo === null) return;
    state.planets = flatRateUndo;
    flatRateUndo = null;
    const st = document.getElementById('flatRateStatus');
    if (st) st.textContent = 'Restored the densities you had before the flat rate.';
    persist(); rerender();
  });
}

// ---------------------------------------------------------------------------
// System search: name index loads lazily on first focus (never at page load —
// functional-audit #8); planets import with ESI names/types and the planet
// type's full resource set awaiting scan values.
// ---------------------------------------------------------------------------

let systemIndex: SystemIndex | null = null;
let systemIndexLoading: Promise<SystemIndex> | null = null;

function ensureSystemIndex(status: HTMLElement | null): Promise<SystemIndex> {
  if (systemIndex !== null) return Promise.resolve(systemIndex);
  if (systemIndexLoading === null) {
    if (status) status.textContent = 'Loading the system list from ESI…';
    systemIndexLoading = loadSystemIndex(defaultEsiJson(), (done, total) => {
      if (status) status.textContent = `Loading the system list from ESI… ${done}/${total}`;
    }).then((idx) => {
      systemIndex = idx;
      if (status) status.textContent = `${idx.count.toLocaleString('en-US')} systems loaded — type a name.`;
      return idx;
    }).catch((e: Error) => {
      systemIndexLoading = null;
      if (status) status.textContent = `System list failed to load: ${e.message} — add planets by hand or retry.`;
      throw e;
    });
  }
  return systemIndexLoading;
}

function wireSystemSearch(): void {
  const input = document.getElementById('sysSearch') as HTMLInputElement | null;
  const list = document.getElementById('sysSearchList') as HTMLDataListElement | null;
  const btn = document.getElementById('sysAddBtn');
  const status = document.getElementById('sysSearchStatus');
  if (input === null || list === null || btn === null) return;

  input.addEventListener('focus', () => { void ensureSystemIndex(status).catch(() => { /* shown in status */ }); });
  input.addEventListener('input', () => {
    if (systemIndex === null) return;
    list.replaceChildren(...searchSystems(systemIndex, input.value).map((name) => el('option', { value: name })));
  });

  const runImport = async (): Promise<void> => {
    const idx = await ensureSystemIndex(status);
    const entry = idx.byName.get(input.value.trim().toLowerCase());
    if (entry === undefined) {
      if (status) status.textContent = `"${input.value.trim()}" is not a known system — pick one from the list.`;
      return;
    }
    if (status) status.textContent = `Loading planets of ${entry.name}…`;
    try {
      const imported = await importSystem(defaultEsiJson(), entry.id);
      let added = 0, skipped = 0;
      for (const p of imported.planets) {
        if (state.planets.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) { skipped++; continue; }
        state.planets.push({
          name: p.name,
          type: p.type,
          system: imported.system,
          // Game truth (library 11): the resource SET is fixed by planet type.
          // Densities load at the 70% site default until the user changes them.
          resources: defaultResources(p.type),
          minimized: state.planets.length > 0,
        });
        added++;
      }
      persist(); rerender();
      const sec1 = document.getElementById('sec1');
      if (sec1) sec1.classList.remove('collapsed');
      if (status) {
        status.textContent = `${imported.system}: ${added} planet${added === 1 ? '' : 's'} added` +
          (skipped > 0 ? `, ${skipped} already present` : '') +
          '. Names and types are ESI facts; densities loaded at the 70% default — replace them with your scans (or use the batch import).';
      }
      announce(`${imported.system}: ${added} planets loaded from ESI.`);
      input.value = '';
    } catch (e) {
      if (status) status.textContent = `Import failed: ${(e as Error).message}`;
    }
  };
  btn.addEventListener('click', () => { void runImport(); });
  input.addEventListener('keydown', (ev) => { if ((ev as KeyboardEvent).key === 'Enter') void runImport(); });
}

// ---------------------------------------------------------------------------
// The bridge — the ONLY surface the legacy skin may call.
// ---------------------------------------------------------------------------

interface BatchPlanet {
  system: string;
  name: string;
  type: string | null;
  densities: Record<string, number>; // integer percent from OCR
  capturedAt: string | null;
}

function deliverBatch(planets: BatchPlanet[]): {
  accepted: number; rejected: number;
  verdicts: Array<{ ok: boolean; reason?: string }>;
} {
  let accepted = 0, rejected = 0;
  const verdicts: Array<{ ok: boolean; reason?: string }> = [];
  for (const bp of planets) {
    const type = (PLANET_TYPES as readonly string[]).includes(bp.type ?? '') ? (bp.type as PlanetType) : null;
    if (type === null) {
      rejected++;
      verdicts.push({ ok: false, reason: 'planet type unrecognized — fewer than 3 resources matched; add this planet by hand' });
      continue;
    }
    const legal = resourcesOf(type);
    const resources = Object.entries(bp.densities)
      .filter(([p0, pct]) => legal.includes(p0) && Number.isFinite(pct) && pct > 0)
      .map(([p0, pct]) => ({ p0, w: wFromDensityPct(pct) }));
    if (resources.length === 0) {
      rejected++;
      verdicts.push({ ok: false, reason: `no readable densities are legal on a ${type} planet — check the scan` });
      continue;
    }
    // Audit #5: the OCR planet name is already "SYSTEM ROMAN" — never prefix twice.
    const name = bp.name.toLowerCase().startsWith(bp.system.toLowerCase())
      ? bp.name.trim()
      : `${bp.system} ${bp.name}`.trim();
    const existing = state.planets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing !== undefined) {
      existing.type = type;
      existing.resources = resources;
      existing.system = bp.system;
      if (bp.capturedAt) existing.scannedAt = bp.capturedAt;
    } else {
      const planet: UiPlanet = { name, type, resources, system: bp.system, minimized: state.planets.length > 0 };
      if (bp.capturedAt) planet.scannedAt = bp.capturedAt;
      state.planets.push(planet);
    }
    accepted++;
    verdicts.push({ ok: true });
  }
  persist(); rerender();
  return { accepted, rejected, verdicts };
}

/** v8-shaped planet list for the market-reference hover popup.
 * Audit #4: the popup renders `system` too — omitting it printed "undefined". */
function readPlanetsForLegacy(): Array<{ name: string; system: string; type: string; densities: Record<string, number> }> {
  return state.planets.map((p) => ({
    name: p.name,
    system: p.system ?? '',
    type: p.type,
    densities: Object.fromEntries(p.resources.map((r) => [r.p0, Math.round(densityPctFromW(Math.max(r.w, 1)))])),
  }));
}

declare global {
  interface Window {
    __v9?: {
      deliverBatch: typeof deliverBatch;
      readPlanets: typeof readPlanetsForLegacy;
    };
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/** Re-entrancy guard (bug-hunt find): replacing a section's children while an
 * input inside it holds focus fires blur→change on the detached node, whose
 * handler calls rerender() AGAIN mid-replaceChildren — the browser then
 * throws "node to be removed is no longer a child". One render runs at a
 * time; a nested request coalesces into one trailing pass. */
let rendering = false;
let renderQueued = false;
function rerender(): void {
  if (state.autoDetail) state.detailLevel = inferDetailLevel(state);
  if (rendering) { renderQueued = true; return; }
  rendering = true;
  try {
    do {
      renderQueued = false;
      renderOperation();
      renderPlanets();
      renderMarket();
      renderGoal();
      updateSolveGate();
      refreshChainsViz(); // keep node price/m³ tags in step with the Market section
    } while (renderQueued);
  } finally {
    rendering = false;
  }
}

/** Keep the sticky Solve in step with the gate (the Goal section's button is
 * rebuilt each render; this one persists). */
/** Page-order map: visible step number → section element id. */
// Streamline batch (owner 2026-09-02): FOUR steps — Goal, What You Have
// (characters + planets merged), Market, Results.
const STEP_SECTIONS: ReadonlyArray<readonly [number, string]> = [
  [1, 'sec3'], [2, 'sec1'], [3, 'sec2'], [4, 'sec4'],
];
function stepOfMissing(msg: string): number {
  const m = /section (\d)/.exec(msg);
  return m !== null ? Number(m[1]) : 1;
}
function shortAction(msg: string): string {
  // First clause, minus the "(section N)" pointer — the step number carries it.
  let s = msg.split(' — ')[0]!.replace(/\s*\(section \d\)/, '').trim();
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s.charAt(0).toLowerCase() + s.slice(1);
}
/** UI-review #1 (owner-approved 2026-09-01): one step open at a time. When
 * the next-step pointer MOVES FORWARD, the finished section folds away and
 * the new one opens; moving backward only opens the section that needs
 * attention (nothing the user reopened is fought). First paint opens the
 * current step and folds the other planner steps. */
let prevNextStep: number | null | 'boot' = 'boot';
const SEC_OF_STEP = new Map(STEP_SECTIONS.map(([step, id]) => [step, id]));
function autoAdvance(next: number | null): void {
  const setFold = (step: number, fold: boolean): void => {
    if (step === 5) return; // Results opens itself on solve
    document.getElementById(SEC_OF_STEP.get(step) ?? '')?.classList.toggle('collapsed', fold);
  };
  if (prevNextStep === 'boot') {
    prevNextStep = next;
    if (next === null) return; // returning user, all set — leave the page as built
    for (const [step] of STEP_SECTIONS) setFold(step, step !== next);
    return;
  }
  if (next === prevNextStep) return;
  const prev = prevNextStep;
  prevNextStep = next;
  // Owner 2026-09-02: moving FORWARD is the user's Next press — never fold
  // a section out from under them mid-edit. Moving BACKWARD (something new
  // is missing) still opens the section that needs attention.
  if (next !== null && prev !== null && next < prev) setFold(next, false);
}

/** The next-step pilot light: ✓ on finished sections, → on the one that needs
 * attention, and the sticky bar always names the single next action — plus
 * five matching dots in the bar itself (UI-review #7). */
function renderStepDots(currentStep: number | null, doneSteps: ReadonlySet<number>): void {
  const box = document.getElementById('stickyDots');
  if (box === null) return;
  box.replaceChildren(...STEP_SECTIONS.map(([step]) => {
    const cls = doneSteps.has(step) ? 'done' : step === currentStep ? 'now' : 'todo';
    return el('span', { class: `v9-dot v9-dot-${cls}`, title: `Step ${step}` },
      doneSteps.has(step) ? '✓' : String(step));
  }));
}
function renderStepChips(currentStep: number | null, doneSteps: ReadonlySet<number>): void {
  renderStepDots(currentStep, doneSteps);
  autoAdvance(currentStep === 4 ? null : currentStep);
  for (const [step, secId] of STEP_SECTIONS) {
    const title = document.querySelector(`#${secId} .section-title`);
    if (title === null) continue;
    let chip = title.querySelector<HTMLElement>('.v9-step-chip');
    if (chip === null) {
      chip = el('span', { class: 'v9-step-chip' });
      title.prepend(chip);
    }
    const state = doneSteps.has(step) ? 'done' : step === currentStep ? 'now' : 'todo';
    chip.textContent = state === 'done' ? '✓' : state === 'now' ? '→' : '';
    chip.className = `v9-step-chip v9-chip-${state}`;
    chip.title = state === 'done' ? 'This step is complete'
      : state === 'now' ? 'Your next step is here' : '';
  }
}
function updateSolveGate(): void {
  const btn = document.getElementById('stickyCalcBtn');
  const info = document.getElementById('stickyCalcInfo');
  if (btn === null) return;
  const readiness = currentReadiness();
  const missingSteps = new Set(readiness.missing.map(stepOfMissing));
  if (readiness.ready) {
    btn.removeAttribute('disabled');
    const gaps = unpricedNeeded();
    if (gaps.length > 0) {
      // Sequencing nudge: solvable, but ISK numbers will be missing/partial.
      const tip = `Next → Step 3: fetch live Jita prices — then SOLVE for the most accurate numbers (${gaps.length} commodit${gaps.length === 1 ? 'y is' : 'ies are'} unpriced). The fetch button is in 3. MARKET.`;
      btn.setAttribute('title', tip);
      if (info) info.textContent = `Next → Step 3: fetch live Jita prices — then press SOLVE (${gaps.length} unpriced)`;
      renderStepChips(3, new Set([1, 2]));
    } else {
      btn.setAttribute('title', 'Judge-checked plans · one ledger · answers carry their optimality bound');
      if (info) info.textContent = 'Ready — press SOLVE';
      renderStepChips(4, new Set([1, 2, 3]));
    }
  } else {
    btn.setAttribute('disabled', 'disabled');
    btn.setAttribute('title', readiness.missing.join('\n'));
    const first = readiness.missing[0] ?? '';
    const step = stepOfMissing(first);
    if (info) info.textContent = `Next → Step ${step}: ${shortAction(first)}${readiness.missing.length > 1 ? ` (+${readiness.missing.length - 1} more after that)` : ''}`;
    const done = new Set<number>();
    for (const [s] of STEP_SECTIONS) if (s < 4 && !missingSteps.has(s)) done.add(s);
    done.delete(step);
    renderStepChips(step, done);
  }
}

function selfTest(): void {
  try {
    const world: SolveWorld = {
      operation: operation([character({ name: 'smoke', icLevel: 2, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 })]),
      planets: [
        { name: 'S-1', type: 'Storm', resources: { 'Aqueous Liquids': 13000, 'Ionic Solutions': 12000 } },
        { name: 'S-2', type: 'Gas', resources: { 'Aqueous Liquids': 9000, 'Ionic Solutions': 11000 } },
        { name: 'S-3', type: 'Barren', resources: {} },
      ],
      programHours: 6,
    };
    const r = solveMax(world, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
    if ('error' in r) throw new Error(r.error);
    if (!r.verdict.legal || r.realizedPerWeek <= 0) throw new Error('selftest: implausible result');

    // The solve gate itself must block what it should and pass what it should.
    const blockedNoPlanets = solveReadiness({ planets: [], product: 'Coolant', sourcing: { Water: 'extract', Electrolytes: 'extract' }, mode: 'max', prices: {} });
    const blockedNoScan = solveReadiness({
      planets: [{ name: 'G', type: 'Storm', resources: [{ p0: 'Aqueous Liquids', w: 0 }] }],
      product: 'Water', sourcing: { Water: 'extract' }, mode: 'max', prices: {},
    });
    const open = solveReadiness({
      planets: [{ name: 'G', type: 'Storm', resources: [{ p0: 'Aqueous Liquids', w: 9000 }] }],
      product: 'Water', sourcing: { Water: 'extract' }, mode: 'max', prices: {},
    });
    if (blockedNoPlanets.ready || blockedNoScan.ready || !open.ready) throw new Error('selftest: solve gate misjudged');

    // Accuracy-ladder gating: no goal blocks everything; quick+band passes an
    // unscanned world; quick without a band blocks it; exact demands own costs.
    const unscanned: UiPlanet[] = [{ name: 'U', type: 'Storm', resources: [{ p0: 'Aqueous Liquids', w: 0 }] }];
    const noGoal = solveReadiness({ planets: unscanned, product: 'Water', sourcing: {}, mode: 'max', prices: {}, modeChosen: false });
    const quickBand = solveReadiness({ planets: unscanned, product: 'Water', sourcing: { Water: 'extract' }, mode: 'max', prices: {}, detailLevel: 'quick', spaceBand: 'nullsec' });
    const quickNoBand = solveReadiness({ planets: unscanned, product: 'Water', sourcing: { Water: 'extract' }, mode: 'max', prices: {}, detailLevel: 'quick', spaceBand: null });
    const exactDefaultCosts = solveReadiness({
      planets: [{ name: 'G', type: 'Storm', resources: [{ p0: 'Aqueous Liquids', w: 9000 }] }],
      product: 'Water', sourcing: { Water: 'extract' }, mode: 'max', prices: {}, detailLevel: 'exact', costsSource: 'default',
    });
    if (noGoal.ready || !quickBand.ready || quickNoBand.ready || exactDefaultCosts.ready) {
      throw new Error('selftest: accuracy-ladder gate misjudged');
    }

    // Suggested sourcing must cover every input with a named reason.
    const sug = suggestSourcing(world, 'Coolant', { ...toMarket(defaultState()), prices: {} });
    if (sug.notes.length === 0 || sug.notes.some((n) => n.reason === '' || !['extract', 'refine', 'buy'].includes(n.mode))) {
      throw new Error('selftest: sourcing suggestion incomplete');
    }
    document.body.dataset['gate'] = 'pass';

    // Price fetch depends on typeID resolution: the merged registry must cover
    // commodities the generated (partial) registry lacks, via the legacy map.
    const ids = mergedIds();
    for (const name of ['Coolant', 'Electrolytes', 'Robotics', 'Broadcast Node']) {
      const id = ids.typeIdOf(name);
      if (!(id > 0)) throw new Error(`selftest: typeID unresolved for ${name}`);
    }
    document.body.dataset['typeids'] = 'pass';

    document.body.dataset['selftest'] = 'pass';
  } catch (e) {
    document.body.dataset['selftest'] = `fail: ${(e as Error).message}`;
  }
}

// ---------------------------------------------------------------------------
// REGION SCOUT (owner spec 2026-08-31): pick a region → rank its systems for
// the current goal. Map facts (planet types, security) come from the baked
// SDE file when this deploy ships one, else live from ESI's public universe
// endpoints (cached). Densities are ASSUMED at the security band's typical
// value — the same Quick-estimate model, same disclosure — so every number
// here is labeled an estimate. Traffic (kills/jumps, public ESI) is its own
// column, never blended into the ISK.
// ---------------------------------------------------------------------------

function secBandOf(security: number, wormhole: boolean): SpaceBand {
  if (wormhole) return 'wormhole';
  if (security >= 0.45) return 'highsec';
  if (security > 0.0) return 'lowsec';
  return 'nullsec';
}

function initRegionScout(): void {
  const panel = document.getElementById('scoutPanel');
  if (panel === null) return;

  let baked: UniverseMap | null = null;
  let bakedTried = false;
  const getBaked = async (): Promise<UniverseMap | null> => {
    if (!bakedTried) { baked = await loadBakedMap(fetchStaticJson); bakedTried = true; }
    return baked;
  };
  let regions: MapRegion[] = [];
  let activity: { at: number; map: ReadonlyMap<number, SystemActivity> } | null = null;
  let scanning = false;

  const regionSel = el('select', { class: 'v9-scout-region' }, el('option', { value: '' }, 'Choose a region…'));
  const scanBtn = el('button', { class: 'btn' }, 'Scout this region');
  const status = el('p', { class: 'v9-muted' }, 'Pick a region and the scout ranks its systems for your current goal.');
  const results = el('div', {});
  panel.replaceChildren(
    el('div', { class: 'v9-row' }, el('label', {}, 'Region ', regionSel), scanBtn),
    status, results,
  );

  const fetchStaticJson = async (url: string): Promise<unknown> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const ensureRegions = async (): Promise<void> => {
    if (regions.length > 0) return;
    const map = await getBaked();
    if (map !== null) {
      regions = map.regions.map((r) => ({ id: r.id, name: r.name }));
    } else {
      status.textContent = 'Reading the region list from EVE’s public map service…';
      try {
        const cached = localStorage.getItem('solvingpi.scout.regions');
        regions = cached !== null ? JSON.parse(cached) as MapRegion[] : await loadRegionList(defaultEsiJson());
        try { localStorage.setItem('solvingpi.scout.regions', JSON.stringify(regions)); } catch { /* storage full */ }
      } catch (e) {
        status.textContent = `Could not load the region list (${(e as Error).message}). Check your connection and try again.`;
        return;
      }
    }
    regionSel.replaceChildren(
      el('option', { value: '' }, 'Choose a region…'),
      ...regions.map((r) => el('option', { value: String(r.id) }, r.name)),
    );
    status.textContent = `${regions.length} regions ready. Choose one and press “Scout this region”.`;
  };
  regionSel.addEventListener('focus', () => { void ensureRegions(); });

  // The two banners (owner pick 2026-09-02, "Option 10") ARE the switch —
  // the old SPECIFIC SYSTEMS / SCOUT A REGION toggle is gone. One source of
  // planets at a time on screen; scouting never touches the saved world
  // until the user presses "Load planets →".
  const searchBanner = document.getElementById('chooseSearch');
  const scoutBanner = document.getElementById('chooseScout');
  const mineWrap = document.getElementById('sec1Mine');
  const scoutWrap = document.getElementById('scoutWrap');
  const showScout = (on: boolean): void => {
    if (mineWrap) mineWrap.hidden = on;
    if (scoutWrap) scoutWrap.hidden = !on;
    searchBanner?.classList.toggle('active', !on && (sec1ToolsChosen || state.planets.length > 0));
    scoutBanner?.classList.toggle('active', on);
    if (on) void ensureRegions();
  };
  showScoutView = showScout;
  searchBanner?.addEventListener('click', () => {
    sec1ToolsChosen = true;
    showScout(false);
    rerender();
    (document.getElementById('sysSearch') as HTMLInputElement | null)?.focus();
  });
  scoutBanner?.addEventListener('click', () => showScout(true));

  const systemsFor = async (regionId: number): Promise<{ systems: MapSystem[]; skipped: number; live: boolean }> => {
    const map = await getBaked();
    if (map !== null) {
      const r = map.regions.find((x) => x.id === regionId);
      if (r !== undefined) return { systems: [...r.systems], skipped: 0, live: false };
    }
    const key = `solvingpi.scout.region.${regionId}`;
    try {
      const cached = localStorage.getItem(key);
      if (cached !== null) {
        const parsed = JSON.parse(cached) as { systems: MapSystem[]; skipped: number };
        return { ...parsed, live: true };
      }
    } catch { /* re-crawl */ }
    const crawled = await crawlRegion(defaultEsiJson(), regionId, (done, total) => {
      status.textContent = `Reading systems from EVE’s public map service… ${done} of ${total} (kept for next time).`;
    });
    const out = { systems: crawled.systems, skipped: crawled.skippedPlanets };
    try { localStorage.setItem(key, JSON.stringify(out)); } catch { /* storage full */ }
    return { ...out, live: true };
  };

  const ensureActivity = async (): Promise<ReadonlyMap<number, SystemActivity> | null> => {
    if (activity !== null && Date.now() - activity.at < 3_600_000) return activity.map;
    try {
      const map = await loadActivity(defaultEsiJson());
      activity = { at: Date.now(), map };
      return map;
    } catch { return null; /* offline — traffic column shows “—” */ }
  };

  const runScout = async (): Promise<void> => {
    if (scanning) return;
    const regionId = Number(regionSel.value);
    if (!(regionId > 0)) { status.textContent = 'Choose a region first.'; return; }
    if (!state.modeChosen) { status.textContent = 'Pick your goal in section 1 first — the scout ranks systems FOR that goal.'; return; }
    if (state.characters.length === 0) { status.textContent = 'Add your characters (section 2) first — the scout plans with YOUR roster.'; return; }
    const anyPrice = Object.values(state.prices).some((q) => q !== undefined && q.bid > 0 && q.ask > 0);
    if (!anyPrice) { status.textContent = 'Fetch live Jita prices in section 3 first — the scout ranks systems by estimated net ISK.'; return; }
    scanning = true; scanBtn.setAttribute('disabled', 'disabled');
    results.replaceChildren();
    try {
      const wormhole = isWormholeRegionId(regionId);
      const { systems, skipped, live } = await systemsFor(regionId);
      status.textContent = `Ranking ${systems.length} systems for your goal…`;
      const act = await ensureActivity();
      const infos: ScoutSystemInfo[] = systems.map((s) => ({
        id: s.id, name: s.name, security: s.security, planets: s.planets,
        assumedW: wFromDensityPct(QUICK_DENSITY_PCT[secBandOf(s.security, wormhole)]),
      }));
      const mixActive = mixIsActive(state) && state.mode !== 'compare' && state.mode !== 'profit';
      const rows = scoutSystems(
        infos,
        operation(state.characters.map((c) => character({ ...c }))),
        state.programHours,
        toMarket(state),
        {
          mode: state.mode, product: state.product,
          ...(state.mode === 'quota' ? { quotaPerWeek: state.quotaPerWeek } : {}),
          ...(mixActive ? { mix: state.mix.map((m) => ({ product: m.product, pct: m.pct })) } : {}),
          overrides: state.sourcingOverrides,
        },
      );
      const feasible = rows.filter((r) => r.feasible);
      const shown = rows.slice(0, 15);
      const regionName = regions.find((r) => r.id === regionId)?.name ?? 'this region';
      const loadPlanets = (row: (typeof rows)[number]): void => {
        let added = 0;
        for (const p of row.system.planets) {
          if (state.planets.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) continue;
          state.planets.push({
            name: p.name, type: p.type, system: row.system.name,
            resources: defaultResources(p.type), minimized: state.planets.length > 0,
          });
          added++;
        }
        persist(); rerender();
        document.getElementById('sec1')?.classList.remove('collapsed');
        showScout(false);
        const st = document.getElementById('flatRateStatus');
        if (st) st.textContent = `${row.system.name}: ${added} planet${added === 1 ? '' : 's'} loaded at the 70% default — replace with your scans.`;
        announce(`${row.system.name} planets loaded into the planner.`);
      };
      results.replaceChildren(
        el('div', { class: 'v9-estimate' },
          el('b', {}, 'ESTIMATE — '),
          `densities assumed at band typicals (${QUICK_DENSITY_PCT.highsec}/${QUICK_DENSITY_PCT.lowsec}/${QUICK_DENSITY_PCT.nullsec}/${QUICK_DENSITY_PCT.wormhole}% high/low/null/WH) — scan values only exist in game.`
          + (skipped > 0 ? ` ${skipped} unsupported planet${skipped === 1 ? '' : 's'} left out.` : '')),
        el('p', { class: 'v9-muted' },
          `${regionName}: ${feasible.length} of ${rows.length} systems fit your goal. Traffic is live (last hour), shown beside the ISK — never inside it.`),
        el('table', { class: 'v9-table' },
          el('tr', {}, ...['#', 'System', 'Sec', 'Planets', 'Est. net ISK/wk', 'Plan', 'Traffic (1h)', ''].map((h) => el('th', {}, h))),
          ...shown.map((r, i) => {
            const badge = activityBadge(act?.get(r.system.id));
            const a = act?.get(r.system.id);
            return el('tr', {},
              el('td', {}, String(i + 1)),
              el('td', {}, el('b', {}, r.system.name)),
              el('td', {}, wormhole ? 'WH' : r.system.security.toFixed(1)),
              el('td', {}, planetTypeCounts(r.system.planets).map(([t, n]) => `${n}× ${t}`).join(' · ') || 'none'),
              el('td', {}, r.feasible ? fmt(r.netPerWeek) : '—'),
              el('td', { title: r.note }, r.feasible ? r.product : friendlyRefusal(r.note)),
              el('td', {}, el('span', { class: `v9-scout-badge v9-scout-${badge.tone}`,
                title: act === null ? 'Live traffic unavailable right now' : `Last hour: ${a?.jumps ?? 0} jumps, ${(a?.shipKills ?? 0) + (a?.podKills ?? 0)} player kills, ${a?.npcKills ?? 0} NPC kills` },
                act === null ? '—' : badge.label)),
              el('td', {}, r.feasible
                ? el('button', { class: 'btn small', click: () => loadPlanets(r) }, 'Load planets →')
                : null),
            );
          }),
        ),
        ...(rows.length > 15 ? [el('p', { class: 'v9-muted' }, `${rows.length - 15} more systems ranked below the top 15.`)] : []),
      );
      status.textContent = live && baked === null
        ? 'Ranked. (This deploy has no baked map file, so the region was read live and kept for next time.)'
        : 'Ranked.';
      announce(`Region scouted: ${feasible.length} systems fit your goal.`);
    } catch (e) {
      status.textContent = `Scout failed: ${(e as Error).message}. Check your connection and try again.`;
    } finally {
      scanning = false; scanBtn.removeAttribute('disabled');
    }
  };
  scanBtn.addEventListener('click', () => { void runScout(); });
}

window.__v9 = { deliverBatch, readPlanets: readPlanetsForLegacy };
wireShell();
initRegionScout();
rerender();
// UI-review #2 (owner-approved 2026-09-01): live prices fetch THEMSELVES on
// arrival — step 4 stops being a chore. fillOnly: quotes the user typed are
// never touched; failures back off quietly (priceNote explains, manual entry
// always works).
if (unpricedNeeded().length > 0) void refreshJitaPrices(undefined, { fillOnly: true });
initChainsViz((name) => state.prices[name]);
selfTest();
document.body.dataset['smoke'] = 'ok';
