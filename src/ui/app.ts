/**
 * Solving PI v9 — the engine, mounted inside the v8.3 skin. The page shell
 * (hero, theme, clock, reference sections, screenshot OCR) is the carried-over
 * skin under static/legacy; this module renders the five planner steps into
 * the shell's section bodies and exposes window.__v9 — the ONLY bridge the
 * legacy layer may call (deliverBatch, readPlanets).
 * Every number on screen comes from the engine's spec/solver/ledger modules.
 */
import { loadState, saveState, defaultState, defaultResources, extractDefaults, type UiState, type UiPlanet } from './state.js';
import { PLANET_TYPES, SCHEMATICS, tierOf, type PlanetType } from '../spec/schematics.js';
import { resourcesOf } from '../world/planets.js';
import { character, operation } from '../world/characters.js';
import { densityPctFromW, wFromDensityPct, DENSITY_REFERENCE_W } from '../world/density.js';
import { solveMax, solveQuota, type SolveResult, type SolveWorld } from '../engine/allocator.js';
import { comparative, defaultSourcing, economics, qolSolve, type MarketContext } from '../engine/modes.js';
import { oreOf, p1InputsOf, type Sourcing } from '../engine/chain.js';
import { analyze, bottleneckReport, optimalityInsight, runwayInsight, type Insight } from '../engine/analytics.js';
import { idRegistry } from '../data/ids.js';
import { fetchPrices } from '../data/prices.js';
import { defaultEsiJson, importSystem, loadSystemIndex, searchSystems, type SystemIndex } from './esi-universe.js';
import { solveReadiness, type Readiness } from './readiness.js';
import { suggestSourcing, type SourcingSuggestion } from '../engine/suggest.js';
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
function persist(): void {
  saveState(state);
  const a = document.getElementById('autosaveStatus');
  if (a) a.textContent = 'Autosaved to this browser just now.';
  markResultsStale();
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
  const cce = Math.max(...s.characters.map((c) => c.customsCodeLevel));
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

function currentReadiness(): Readiness {
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
  const names = new Set<string>([s.product]);
  try {
    const src = currentSourcing(s);
    for (const p1 of p1InputsOf(s.product)) {
      names.add(p1);
      if (src[p1] === 'refine') names.add(oreOf(p1));
    }
  } catch { /* product invalid mid-edit */ }
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
      el('td', {}, el('button', { class: 'btn small', click: () => { state.characters.splice(i, 1); persist(); rerender(); } }, '✕')),
    ),
  );
  const slots = state.characters.reduce((a, c) => a + 1 + c.icLevel, 0);
  const summary = document.getElementById('sec0Summary');
  if (summary) summary.textContent = `${state.characters.length} character${state.characters.length === 1 ? '' : 's'} · ${slots} colony slots · ${state.programHours}h programs`;
  body.replaceChildren(
    el('p', { class: 'section-sub' },
      'Every character is modeled individually — the tool adds up what you tell it, never assumes everyone is maxed. Supported: 1 to 50 characters.'),
    el('table', { class: 'v9-table' },
      el('tr', {}, ...['Name', 'Interplanetary Consolidation', 'CC Upgrades', 'Customs Code', 'Accounting', 'Broker Relations', 'Planet budget', ''].map((h) => el('th', {}, h))),
      ...rows,
    ),
    el('button', {
      class: 'btn',
      click: () => {
        if (state.characters.length >= 50) { alert('Supported size is 1..50 characters.'); return; }
        state.characters.push({ name: `Alt ${state.characters.length}`, icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 });
        persist(); rerender();
      },
    }, '+ Add character'),
    el('div', { class: 'v9-row' },
      el('label', {}, 'Extraction program length ',
        el('select', {
          change: (ev) => { state.programHours = Number((ev.target as HTMLSelectElement).value); persist(); rerender(); },
        }, ...[6, 12, 24, 48, 96, 168, 336].map((h) => {
          const o = el('option', { value: String(h) }, `${h}h (${fmt1(168 / h)} sessions/wk)`);
          if (h === state.programHours) o.setAttribute('selected', 'selected');
          return o;
        })),
      ),
      el('span', { class: 'v9-muted' }, 'Short programs yield more per week; long ones need fewer logins. Results can show both sides of that trade in ISK.'),
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
      el('input', {
        class: 'v9-num', type: 'number', value: r.w > 0 ? String(r.w) : '', min: '0', step: 'any',
        placeholder: 'scan value',
        title: 'raw qty_per_cycle from the survey window',
        change: (ev) => {
          const v = Number((ev.target as HTMLInputElement).value);
          r.w = Number.isFinite(v) && v > 0 ? v : 0;
          persist(); rerender();
        },
      }),
      el('span', { class: r.w > 0 ? 'v9-muted' : 'v9-scan-tag' },
        r.w > 0 ? `= ${fmt1(densityPctFromW(r.w))}%` : 'awaiting scan — excluded from plans until set'),
      el('button', { class: 'btn small', click: () => { p.resources.splice(ri, 1); persist(); rerender(); } }, '✕'),
    ),
  );
  const unscanned = p.resources.filter((r) => !(r.w > 0)).length;
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
    })(), ' Complete & Collapse');

  if (p.minimized === true) {
    const scanned = p.resources.filter((r) => r.w > 0);
    const avg = scanned.length > 0
      ? scanned.reduce((a, r) => a + densityPctFromW(r.w), 0) / scanned.length : 0;
    return el('div', { class: 'v9-planet v9-planet-min' },
      el('div', { class: 'v9-row' },
        el('b', {}, p.name),
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
        class: 'v9-text', type: 'text', value: p.name,
        change: (ev) => { p.name = (ev.target as HTMLInputElement).value; persist(); rerender(); },
      }),
      typeSel,
      p.system ? el('span', { class: 'v9-muted' }, p.system) : null,
      p.scannedAt ? el('span', { class: 'v9-scan-tag', title: `Screenshot capture time: ${p.scannedAt}` }, `📷 ${p.scannedAt.slice(0, 10)}`) : null,
      unscanned > 0 ? el('span', { class: 'v9-scan-tag' }, `${unscanned} awaiting scan`) : null,
      el('button', { class: 'btn small', click: () => { state.planets.splice(i, 1); persist(); rerender(); } }, 'remove planet'),
      doneBox,
    ),
    ...resRows,
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
      }, '+ scanned resource');
      if (unused.length === 0) btn.setAttribute('disabled', 'disabled');
      return btn;
    })(),
  );
}

function renderPlanets(): void {
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
      'Planets load with every resource at the 70% default density — replace each with the raw per-cycle survey value from your scan (the familiar percentage appears alongside). Values above 100% are real and never capped — but output never exceeds what the buildings can process. Tick Complete & Collapse on a planet to minimize just that planet.'),
    ...groupBlocks,
    el('button', {
      class: 'btn',
      click: () => { state.planets.push({ name: `Planet ${state.planets.length + 1}`, type: 'Barren', resources: defaultResources('Barren'), minimized: false }); persist(); rerender(); },
    }, '+ Add planet'),
  );
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
    click: () => {
      fetchBtn.textContent = 'Fetching Jita order books…';
      const names = neededCommodities(state);
      let fetched = 0;
      fetchPrices(names, {
        ids: mergedIds(),
        now: () => new Date().toISOString(),
        fetchJson: async (url) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status} from ESI`);
          fetched++;
          fetchBtn.textContent = `Fetching Jita order books… (${Math.min(Math.ceil(fetched / 2), names.length)}/${names.length})`;
          return { body: await res.json(), headers: {} };
        },
      }).then((snap) => {
        for (const [name, quote] of Object.entries(snap.prices)) state.prices[name] = { ...quote };
        // Audit B2: developer error text ("run tools/gen-sde.mjs") means nothing
        // to a site visitor — translate it at the display boundary.
        const friendly = (reason: string): string =>
          reason.startsWith('missing-typeid')
            ? 'no type ID in this build — enter its quote manually'
            : reason;
        state.priceNote = `Live: ${snap.source} at ${snap.fetchedAt}.` +
          (snap.unpriced.length > 0 ? ` UNPRICED: ${snap.unpriced.map((u) => `${u.name} (${friendly(u.reason)})`).join('; ')}` : '');
        persist(); rerender();
      }).catch((e: Error) => {
        state.priceNote = `Live fetch failed: ${e.message} — enter quotes manually.`;
        persist(); rerender();
      });
    },
  }, 'Fetch live Jita prices (ESI)');
  body.replaceChildren(
    el('p', { class: 'section-sub v9-muted' }, state.priceNote),
    el('table', { class: 'v9-table' },
      el('tr', {}, ...['Commodity', 'Best bid (instant sell)', 'Best ask (list / instant buy)', 'Daily volume (optional)'].map((h) => el('th', {}, h))),
      ...priceRows,
    ),
    fetchBtn,
    el('div', { class: 'v9-row fin-presets' },
      el('span', { class: 'fin-preset-label' }, 'Typical costs for:'),
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
  );
}

// ---------------------------------------------------------------------------
// Section 1 on the page — Goal (physically #sec3; ordered first)
// ---------------------------------------------------------------------------

function renderGoal(): void {
  const body = byId('sec3Body');
  const summary = document.getElementById('sec3Summary');
  const modeLabel = { max: 'max profit', quota: 'quota', qol: 'login budget', compare: 'compare all' }[state.mode];
  if (summary) {
    summary.textContent = !state.modeChosen ? 'pick a goal'
      : state.mode === 'compare' ? modeLabel
        : `${state.product} · ${modeLabel}`;
  }
  const productSel = el('select', {
    change: (ev) => { state.product = (ev.target as HTMLSelectElement).value; state.sourcingOverrides = extractDefaults(state.product); persist(); rerender(); },
  }, ...[...SCHEMATICS.keys()].sort((a, b) => tierOf(a) - tierOf(b) || a.localeCompare(b)).map((name) => {
    const o = el('option', { value: name }, `P${tierOf(name)} — ${name}`);
    if (name === state.product) o.setAttribute('selected', 'selected');
    return o;
  }));

  // Listed A to Z; Compare is the pre-selected default.
  const modes: Array<[UiState['mode'], string]> = [
    ['qol', 'Best net within a login budget'],
    ['compare', 'Compare every product (ranked frontier)'],
    ['quota', 'Hit a weekly quota with minimal colonies'],
    ['max', 'Maximum output of my chosen product'],
  ];
  const modeBlock = el('div', {}, ...modes.map(([m, label]) => el('label', { class: 'v9-mode' },
    (() => {
      const r = el('input', {
        type: 'radio', name: 'v9mode', value: m,
        change: () => { state.mode = m; state.modeChosen = true; persist(); rerender(); },
      });
      // Nothing is pre-checked until the user actually chooses a goal.
      if (state.modeChosen && state.mode === m) r.setAttribute('checked', 'checked');
      return r;
    })(), ` ${label}`,
  )));

  if (!state.modeChosen) {
    // Progressive disclosure: THE GOAL IS THE FIRST AND ONLY QUESTION.
    // Product, sourcing, detail level and Solve all appear only once a goal
    // exists to shape them — the goal decides whether a product is even asked.
    body.replaceChildren(
      el('h3', {}, 'What do you want?'),
      modeBlock,
      el('p', { class: 'v9-muted' },
        'Pick a goal to continue. You will NOT have to fill everything in — the tool suggests sourcing and can stand in typical values until you provide your own.'),
    );
    return;
  }

  // --- Detail level (accuracy ladder) ---------------------------------------
  const levels: Array<[UiState['detailLevel'], string, string]> = [
    ['quick', 'Quick estimate', 'typical values stand in for anything you have not entered — instant numbers, clearly labeled an estimate'],
    ['refined', 'Refined', 'your real scans required; typical cost presets still allowed (results say so)'],
    ['exact', 'Exact', 'everything is yours — scans entered, costs confirmed; numbers carry no assumptions'],
  ];
  const detailBlock = el('div', { class: 'v9-detail' },
    el('h3', {}, 'Detail level'),
    ...levels.map(([lv, label, desc]) => el('label', { class: 'v9-mode' },
      (() => {
        const r = el('input', {
          type: 'radio', name: 'v9detail', value: lv,
          change: () => { state.detailLevel = lv; persist(); rerender(); },
        });
        if (state.detailLevel === lv) r.setAttribute('checked', 'checked');
        return r;
      })(), ` ${label} — ${desc}`,
    )),
  );

  // Quick rung: the security band that supplies typical densities (and offers
  // the matching cost prefill for section 4).
  let bandRow: HTMLElement | null = null;
  if (state.detailLevel === 'quick') {
    const bandSel = el('select', {
      change: (ev) => {
        const v = (ev.target as HTMLSelectElement).value;
        state.spaceBand = (SPACE_BANDS as readonly string[]).includes(v) ? (v as SpaceBand) : null;
        if (state.spaceBand !== null && state.costsSource !== 'user') applyCostPreset(state.spaceBand);
        persist(); rerender();
      },
    },
      (() => { const o = el('option', { value: '' }, 'choose…'); if (state.spaceBand === null) o.setAttribute('selected', 'selected'); return o; })(),
      ...SPACE_BANDS.map((b) => {
        const o = el('option', { value: b }, `${BAND_LABELS[b]} — assume ${QUICK_DENSITY_PCT[b]}% density`);
        if (state.spaceBand === b) o.setAttribute('selected', 'selected');
        return o;
      }));
    const assumed = assumedDensityCount(state);
    bandRow = el('div', { class: 'v9-row' },
      el('label', {}, 'Your space ', bandSel),
      el('span', { class: 'v9-muted' },
        state.spaceBand === null
          ? QUICK_DENSITY_DISCLOSURE
          : `${assumed} unscanned value${assumed === 1 ? '' : 's'} will assume ${QUICK_DENSITY_PCT[state.spaceBand]}% (${BAND_LABELS[state.spaceBand]} typical). ${state.costsSource === 'user' ? 'Your own cost rates are kept.' : 'Typical costs were prefilled into section 4 — edit them any time.'}`),
    );
  }

  // --- Sourcing: suggested by default, pinnable per input -------------------
  let sourcingBlock: HTMLElement | null = null;
  if (state.mode !== 'compare') {
    let rows: HTMLElement[] = [];
    try {
      const heuristic = currentSourcing(state);
      rows = Object.entries(heuristic).map(([p1, mode]) => {
        const pinned = p1 in state.sourcingOverrides;
        return el('div', { class: 'v9-row' },
          el('span', {}, p1),
          el('select', {
            change: (ev) => {
              const v = (ev.target as HTMLSelectElement).value;
              if (v === 'auto') delete state.sourcingOverrides[p1];
              else state.sourcingOverrides[p1] = v as Sourcing;
              persist(); rerender();
            },
          },
            (() => {
              const o = el('option', { value: 'auto' }, `Suggested (auto — currently ${mode})`);
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
      });
    } catch { /* product mid-edit */ }
    sourcingBlock = el('details', { class: 'v9-sourcing' },
      el('summary', {}, 'Adjust sourcing (default: mine it)'),
      el('p', { class: 'v9-muted' },
        'Every input starts on extract (mine it). Set any input to Suggested (auto) and the tool picks for it — from your goal, your systems and (when loaded) prices — naming each choice with its reason.'),
      ...rows,
    );
  }

  const children: Array<Node | null> = [
    el('h3', {}, 'What do you want?'),
    modeBlock,
    // The goal dictates whether a product is even a question: compare ranks
    // ALL products itself, so no product dropdown exists in that mode.
    state.mode !== 'compare'
      ? el('div', { class: 'v9-row' }, el('label', {}, 'Product '), productSel)
      : null,
    state.mode === 'quota'
      ? el('label', {}, 'Target/week ', numInput(state.quotaPerWeek, 1, 1e9, 1, (v) => { state.quotaPerWeek = v; }))
      : null,
    state.mode === 'qol'
      ? el('label', {}, 'Max sessions/week ', numInput(state.qolSessions, 0.5, 28, 0.5, (v) => { state.qolSessions = v; }))
      : null,
    detailBlock,
    bandRow,
    sourcingBlock,
    (() => {
      const readiness = currentReadiness();
      const btn = el('button', { class: 'btn primary', click: runSolve }, 'Solve');
      if (!readiness.ready) {
        btn.setAttribute('disabled', 'disabled');
        btn.setAttribute('title', readiness.missing.join('\n'));
      }
      const row = el('div', { class: 'v9-row' }, btn);
      if (!readiness.ready) {
        row.append(el('div', { class: 'v9-muted' },
          el('b', {}, 'Solve unlocks when: '),
          ...readiness.missing.map((m) => el('div', {}, `• ${m}`))));
      }
      return row;
    })(),
  ];
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
  box.append(el('div', { class: 'v9-cards' },
    el('div', { class: 'v9-card' }, el('h4', {}, 'Output'), el('p', { class: 'v9-big' }, `${fmt(r.realizedPerWeek)} ${r.product}/wk`)),
    el('div', { class: 'v9-card' }, el('h4', {}, 'Answer quality'), el('p', {}, `${r.method}${r.method === 'exhaustive' ? ' (exact for this world)' : ''} — ${bound.toFixed(1)}% of the relaxation bound`)),
    el('div', { class: 'v9-card' }, el('h4', {}, 'Slots'), el('p', {}, `${r.slotsUsed} colonies used`)),
  ));

  let eco: ReturnType<typeof economics> | null = null;
  try {
    eco = economics(r, toMarket(s), s.programHours);
  } catch (e) {
    box.append(el('div', { class: 'v9-warn' }, `Not priced: ${(e as Error).message}`));
  }
  if (eco !== null) {
    box.append(el('div', { class: 'v9-cards' },
      el('div', { class: 'v9-card' }, el('h4', {}, 'Net'), el('p', { class: 'v9-big' }, `${fmt(eco.netPerWeek)} ISK/wk`)),
      el('div', { class: 'v9-card' }, el('h4', {}, 'Per session'), el('p', {}, `${fmt(eco.netPerSession)} ISK × ${fmt1(eco.sessionsPerWeek)} sessions/wk`)),
      el('div', { class: 'v9-card' }, el('h4', {}, 'Gross'), el('p', {}, `${fmt(eco.grossPerWeek)} ISK/wk`)),
    ));
    box.append(el('details', { class: 'v9-ledger' },
      el('summary', {}, `Ledger (${eco.ledger.lines.length} lines — reconciles exactly to net)`),
      el('table', { class: 'v9-table' },
        ...eco.ledger.lines.map((l) => el('tr', {}, el('td', {}, l.label), el('td', { class: l.isk < 0 ? 'v9-neg' : 'v9-pos' }, fmt(l.isk)))),
        el('tr', { class: 'v9-total' }, el('td', {}, 'NET'), el('td', {}, fmt(eco.ledger.net))),
      ),
    ));
  }

  box.append(characterDashboard(r));

  const quick = [optimalityInsight(r), ...bottleneckReport(r), runwayInsight(r)];
  box.append(el('h3', {}, 'Insights'), el('div', { class: 'v9-cards' }, ...quick.map(insightCard)));

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
          deepBtn.replaceWith(el('div', { class: 'v9-warn' }, `Deep analytics needs prices: ${(e as Error).message}`));
        }
      }, 30);
    },
  }, 'Deep analytics (marginals, buy-vs-make, cadence, baseline)');
  box.append(deepBtn);

  box.append(
    el('h3', {}, 'Build sheet (copy-paste)'),
    el('textarea', { class: 'v9-template', readonly: 'readonly' }, colonyTemplate(r)),
    el('p', { class: 'v9-muted' }, r.notes.join(' · ')),
  );
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
    assumptions.push(`${costsSourceLabel()} Edit or confirm them in section 4.`);
  }
  if (assumptions.length === 0) return null;
  return el('div', { class: 'v9-warn v9-estimate' },
    el('b', {}, 'ESTIMATE — these numbers stand in for details you have not provided yet:'),
    ...assumptions.map((a) => el('div', {}, `• ${a}`)));
}

/** Disclose the sourcing the tool chose — every input, with its reason. */
function suggestionCard(s: SourcingSuggestion): HTMLElement {
  const pinned = Object.keys(state.sourcingOverrides).length;
  return el('div', { class: 'v9-card v9-suggest' },
    el('h4', {}, 'Sourcing — chosen for you'),
    ...s.notes.map((n) => el('p', {}, el('b', {}, `${n.p1}: ${n.mode}`), ` — ${n.reason}`)),
    el('p', { class: 'v9-muted' },
      s.refined
        ? 'Choices were price-compared: each alternative re-solved (fast solver) and settled through the one ledger, single deterministic pass — the plan below is the full solve of the winner.'
        : `Heuristic choice${s.refinementSkipped !== undefined ? ` — ${s.refinementSkipped}` : ''}.`,
    ),
    pinned > 0 ? el('p', { class: 'v9-muted' }, `${pinned} input${pinned === 1 ? '' : 's'} pinned by you (never overruled).`) : null,
    el('p', { class: 'v9-muted' }, 'To overrule any of these, pin it under “Adjust sourcing” in section 1.'),
  );
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
        const { ranked, excluded } = comparative(world, toMarket(state));
        if (summary) summary.textContent = `${ranked.length} viable products ranked${banner !== null ? ' (estimate)' : ''}`;
        announce(`Comparison complete: ${ranked.length} viable products ranked.`);
        // Rank order first; the user picks/confirms a product, THEN gets the
        // full best-path plan for it (goal switches to max output of that
        // product, so the choice is visible and revisitable in section 1).
        const pickPlan = (product: string): void => {
          state.product = product;
          state.mode = 'max';
          state.modeChosen = true;
          state.sourcingOverrides = extractDefaults(product);
          persist(); rerender();
          announce(`${product} picked from the comparison — planning its best path.`);
          runSolve();
        };
        resultsBox.replaceChildren(
          ...(banner !== null ? [banner] : []),
          // Audit B3: never truncate silently.
          el('p', { class: 'v9-muted' },
            (ranked.length > 15 ? `Top 15 shown of ${ranked.length} viable products. ` : `${ranked.length} viable product${ranked.length === 1 ? '' : 's'}. `)
            + 'Ranked with the fast solver (each answer carries its optimality bound); pick one and it is re-solved exactly — full plan, colonies, build sheet and analytics.'),
          el('table', { class: 'v9-table' },
            el('tr', {}, ...['#', 'Product', 'Net ISK/wk', 'Output/wk', 'Method', ''].map((h) => el('th', {}, h))),
            ...ranked.slice(0, 15).map((r, i) => el('tr', {},
              el('td', {}, String(i + 1)), el('td', {}, r.product),
              el('td', {}, fmt(r.economics.netPerWeek)), el('td', {}, fmt(r.result.realizedPerWeek)),
              el('td', {}, r.result.method),
              el('td', {}, el('button', { class: 'btn small', click: () => pickPlan(r.product) }, 'Plan this →')),
            )),
          ),
          el('details', {},
            el('summary', {}, `${excluded.length} products excluded (each with a named reason)${excluded.length > 40 ? ' — first 40 shown' : ''}`),
            el('ul', {}, ...excluded.slice(0, 40).map((x) => el('li', {}, `${x.product}: ${x.reason}`)))),
        );
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
          resultsBox.replaceChildren(el('div', { class: 'v9-warn' },
            `${q.error}${q.achievablePerWeek !== undefined ? ` — achievable: ${fmt(q.achievablePerWeek)}/wk` : ''}`));
          return;
        }
        result = q;
      } else if (state.mode === 'qol') {
        const q = qolSolve(world, state.product, toMarket(state), state.qolSessions, sourcing);
        if ('error' in q) { resultsBox.replaceChildren(el('div', { class: 'v9-warn' }, q.error)); return; }
        result = q.result;
        extra.push(el('p', { class: 'v9-muted' }, `Chosen cadence: ${q.programHours}h programs (${fmt1(168 / q.programHours)} sessions/wk).`));
      } else {
        const r = solveMax(world, state.product, sourcing);
        if ('error' in r) { resultsBox.replaceChildren(el('div', { class: 'v9-warn' }, r.error)); return; }
        result = r;
      }
      if (summary) summary.textContent = `${fmt(result.realizedPerWeek)} ${result.product}/wk · ${result.method}${banner !== null ? ' (estimate)' : ''}`;
      announce(`Solved: ${fmt(result.realizedPerWeek)} ${result.product} per week using ${result.slotsUsed} colonies.`);
      const rendered = renderResult(result, state, extra);
      if (banner !== null) rendered.prepend(banner);
      resultsBox.replaceChildren(rendered);
    } catch (e) {
      resultsBox.replaceChildren(el('div', { class: 'v9-warn' }, (e as Error).message));
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

function wireShell(): void {
  document.getElementById('stickyCalcBtn')?.addEventListener('click', runSolve);
  const info = document.getElementById('stickyCalcInfo');
  if (info) info.textContent = 'Judge-checked plans · one ledger · answers carry their optimality bound';

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
      state = { ...defaultState(), ...parsed.state };
      persist(); rerender();
      const s = document.getElementById('saveLoadStatus');
      if (s) s.textContent = `Loaded ${f.name}.`;
    } catch (e) {
      const s = document.getElementById('saveLoadStatus');
      if (s) s.textContent = `Could not load that file: ${(e as Error).message}`;
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
      },
    },
    sec0: { what: 'your operation — all characters and their skills', run: () => { state.characters = defaultState().characters; } },
    sec1: { what: 'ALL planets and their scan values', run: () => { state.planets = defaultState().planets; flatRateUndo = null; } },
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
      const st = document.getElementById('flatRateStatus');
      if (st) st.textContent = `${BAND_LABELS[band]} typical: ${QUICK_DENSITY_PCT[band]}% — press “Apply to all planets” to use it. ${QUICK_DENSITY_DISCLOSURE}`;
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

function rerender(): void {
  renderOperation();
  renderPlanets();
  renderMarket();
  renderGoal();
  updateSolveGate();
}

/** Keep the sticky Solve in step with the gate (the Goal section's button is
 * rebuilt each render; this one persists). */
function updateSolveGate(): void {
  const btn = document.getElementById('stickyCalcBtn');
  const info = document.getElementById('stickyCalcInfo');
  if (btn === null) return;
  const readiness = currentReadiness();
  if (readiness.ready) {
    btn.removeAttribute('disabled');
    btn.removeAttribute('title');
    if (info) info.textContent = 'Judge-checked plans · one ledger · answers carry their optimality bound';
  } else {
    btn.setAttribute('disabled', 'disabled');
    btn.setAttribute('title', readiness.missing.join('\n'));
    if (info) info.textContent = `Solve unlocks when: ${readiness.missing[0] ?? ''}${readiness.missing.length > 1 ? ` (+${readiness.missing.length - 1} more — see section 1)` : ''}`;
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

window.__v9 = { deliverBatch, readPlanets: readPlanetsForLegacy };
wireShell();
rerender();
selfTest();
document.body.dataset['smoke'] = 'ok';
