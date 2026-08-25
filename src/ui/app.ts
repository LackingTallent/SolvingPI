/**
 * Solving PI v9 — prototype UI. Thin, honest shell over the engine:
 * every number on screen comes from the engine's spec/solver/ledger modules;
 * the UI computes nothing itself. No sliders. Disclosures always visible.
 */
import { loadState, saveState, defaultState, type UiState, type UiPlanet } from './state.js';
import { P0_SPAWNS, PLANET_TYPES, SCHEMATICS, tierOf, type PlanetType } from '../spec/schematics.js';
import { resourcesOf } from '../world/planets.js';
import { character, operation } from '../world/characters.js';
import { densityPctFromW, wFromDensityPct, DENSITY_REFERENCE_W } from '../world/density.js';
import { solveMax, solveQuota, type SolveResult, type SolveWorld } from '../engine/allocator.js';
import { comparative, defaultSourcing, economics, qolSolve, type MarketContext } from '../engine/modes.js';
import { oreOf, p1InputsOf, type Sourcing } from '../engine/chain.js';
import { analyze, bottleneckReport, optimalityInsight, runwayInsight, type Insight } from '../engine/analytics.js';
import { idRegistry } from '../data/ids.js';
import { fetchPrices } from '../data/prices.js';

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

// ---------------------------------------------------------------------------
// State ↔ engine adapters
// ---------------------------------------------------------------------------

let state: UiState = loadState();
function persist(): void { saveState(state); }

function toWorld(s: UiState): SolveWorld {
  return {
    operation: operation(s.characters.map((c) => character({ ...c }))),
    planets: s.planets.map((p) => ({
      name: p.name,
      type: p.type,
      resources: Object.fromEntries(p.resources.filter((r) => r.w > 0).map((r) => [r.p0, r.w])),
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

// ---------------------------------------------------------------------------
// Result rendering
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

function insightCard(i: Insight): HTMLElement {
  return el('div', { class: 'card insight' },
    el('h4', {}, i.title),
    el('p', {}, i.detail),
    el('p', { class: 'muted' }, `inputs: ${i.inputs.join(' · ')}`),
  );
}

function renderResult(r: SolveResult, s: UiState, extra: HTMLElement[] = []): HTMLElement {
  const box = el('div', {});
  const bound = r.upperBoundPerWeek > 0 ? (r.realizedPerWeek / r.upperBoundPerWeek) * 100 : 100;
  const summary = el('div', { class: 'cards' },
    el('div', { class: 'card' }, el('h4', {}, 'Output'), el('p', { class: 'big' }, `${fmt(r.realizedPerWeek)} ${r.product}/wk`)),
    el('div', { class: 'card' }, el('h4', {}, 'Answer quality'), el('p', {}, `${r.method}${r.method === 'exhaustive' ? ' (exact for this world)' : ''} — ${bound.toFixed(1)}% of the relaxation bound`)),
    el('div', { class: 'card' }, el('h4', {}, 'Slots'), el('p', {}, `${r.slotsUsed} colonies used`)),
  );
  box.append(summary);

  let eco: ReturnType<typeof economics> | null = null;
  try {
    eco = economics(r, toMarket(s), s.programHours);
  } catch (e) {
    box.append(el('div', { class: 'warn' }, `Not priced: ${(e as Error).message}`));
  }
  if (eco !== null) {
    box.append(el('div', { class: 'cards' },
      el('div', { class: 'card' }, el('h4', {}, 'Net'), el('p', { class: 'big' }, `${fmt(eco.netPerWeek)} ISK/wk`)),
      el('div', { class: 'card' }, el('h4', {}, 'Per session'), el('p', {}, `${fmt(eco.netPerSession)} ISK × ${fmt1(eco.sessionsPerWeek)} sessions/wk`)),
      el('div', { class: 'card' }, el('h4', {}, 'Gross'), el('p', {}, `${fmt(eco.grossPerWeek)} ISK/wk`)),
    ));
    const ledger = el('details', {},
      el('summary', {}, `Ledger (${eco.ledger.lines.length} lines — reconciles exactly to net)`),
      el('table', { class: 'ledger' },
        ...eco.ledger.lines.map((l) => el('tr', {}, el('td', {}, l.label), el('td', { class: l.isk < 0 ? 'neg' : 'pos' }, fmt(l.isk)))),
        el('tr', { class: 'total' }, el('td', {}, 'NET'), el('td', {}, fmt(eco.ledger.net))),
      ),
    );
    box.append(ledger);
  }

  const quick = [optimalityInsight(r), ...bottleneckReport(r), runwayInsight(r)];
  box.append(el('h3', {}, 'Insights'), el('div', { class: 'cards' }, ...quick.map(insightCard)));

  const deepBtn = el('button', {
    click: () => {
      deepBtn.textContent = 'Computing (re-solves every alternative)…';
      setTimeout(() => {
        try {
          const report = analyze(toWorld(s), r, toMarket(s));
          const deepIds = new Set(quick.map((q) => q.id));
          const deep = report.insights.filter((i) => !deepIds.has(i.id) && !i.id.startsWith('slack:'));
          const cadence = el('table', { class: 'ledger' },
            el('tr', {}, el('th', {}, 'Program'), el('th', {}, 'Sessions/wk'), el('th', {}, 'Net ISK/wk'), el('th', {}, 'Net ISK/session')),
            ...report.cadence.map((c) => el('tr', {},
              el('td', {}, `${c.programHours}h`),
              el('td', {}, fmt1(c.sessionsPerWeek)),
              el('td', {}, c.netPerWeek === null ? '—' : fmt(c.netPerWeek)),
              el('td', {}, c.netPerSession === null ? '—' : fmt(c.netPerSession)),
            )),
          );
          deepBtn.replaceWith(
            el('div', {},
              el('div', { class: 'cards' }, ...deep.map(insightCard)),
              el('h3', {}, 'Cadence: ISK/week vs ISK/login'), cadence,
            ),
          );
        } catch (e) {
          deepBtn.replaceWith(el('div', { class: 'warn' }, `Deep analytics needs prices: ${(e as Error).message}`));
        }
      }, 30);
    },
  }, 'Deep analytics (marginals, buy-vs-make, cadence, baseline)');
  box.append(deepBtn);

  box.append(
    el('h3', {}, 'Build sheet (copy-paste)'),
    el('textarea', { class: 'template', readonly: 'readonly', rows: '14' }, colonyTemplate(r)),
    el('p', { class: 'muted' }, r.notes.join(' · ')),
  );
  box.append(...extra);
  return box;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function numInput(value: number, min: number, max: number, step: number, onchange: (v: number) => void): HTMLElement {
  return el('input', {
    type: 'number', value: String(value), min: String(min), max: String(max), step: String(step),
    change: (ev) => { onchange(Number((ev.target as HTMLInputElement).value)); persist(); rerender(); },
  });
}

function sectionOperation(): HTMLElement {
  const rows = state.characters.map((c, i) =>
    el('tr', {},
      el('td', {}, el('input', {
        type: 'text', value: c.name,
        change: (ev) => { c.name = (ev.target as HTMLInputElement).value; persist(); rerender(); },
      })),
      el('td', {}, numInput(c.icLevel, 0, 5, 1, (v) => { c.icLevel = v; })),
      el('td', {}, numInput(c.ccuLevel, 0, 5, 1, (v) => { c.ccuLevel = v; })),
      el('td', {}, numInput(c.customsCodeLevel, 0, 5, 1, (v) => { c.customsCodeLevel = v; })),
      el('td', {}, numInput(c.accountingLevel, 0, 5, 1, (v) => { c.accountingLevel = v; })),
      el('td', {}, numInput(c.brokerRelationsLevel, 0, 5, 1, (v) => { c.brokerRelationsLevel = v; })),
      el('td', {}, `${1 + c.icLevel} planets`),
      el('td', {}, el('button', { class: 'small', click: () => { state.characters.splice(i, 1); persist(); rerender(); } }, '✕')),
    ),
  );
  const slots = state.characters.reduce((a, c) => a + 1 + c.icLevel, 0);
  return el('section', {},
    el('h2', {}, `1 · Operation — ${state.characters.length} character${state.characters.length === 1 ? '' : 's'}, ${slots} colony slots`),
    el('table', {},
      el('tr', {}, ...['Name', 'IC', 'CCU', 'CCE', 'Acct', 'Broker', 'Budget', ''].map((h) => el('th', {}, h))),
      ...rows,
    ),
    el('button', {
      click: () => {
        if (state.characters.length >= 50) { alert('Supported size is 1..50 characters.'); return; }
        state.characters.push({ name: `Alt ${state.characters.length}`, icLevel: 0, ccuLevel: 5, customsCodeLevel: 0, accountingLevel: 0, brokerRelationsLevel: 0 });
        persist(); rerender();
      },
    }, '+ character'),
  );
}

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
  const resRows = p.resources.map((r, ri) =>
    el('div', { class: 'resrow' },
      el('select', {
        change: (ev) => { r.p0 = (ev.target as HTMLSelectElement).value; persist(); rerender(); },
      }, ...resourcesOf(p.type).map((p0) => {
        const o = el('option', { value: p0 }, p0);
        if (p0 === r.p0) o.setAttribute('selected', 'selected');
        return o;
      })),
      el('input', {
        type: 'number', value: String(r.w), min: '1', step: 'any', title: 'raw qty_per_cycle from the survey window',
        change: (ev) => { r.w = Number((ev.target as HTMLInputElement).value); persist(); rerender(); },
      }),
      el('span', { class: 'muted' }, `= ${fmt1(densityPctFromW(Math.max(r.w, 1)))}% of the v8 reference (${fmt1(DENSITY_REFERENCE_W)})`),
      el('button', { class: 'small', click: () => { p.resources.splice(ri, 1); persist(); rerender(); } }, '✕'),
    ),
  );
  return el('div', { class: 'card planet' },
    el('div', { class: 'resrow' },
      el('input', {
        type: 'text', value: p.name,
        change: (ev) => { p.name = (ev.target as HTMLInputElement).value; persist(); rerender(); },
      }),
      typeSel,
      el('button', { class: 'small', click: () => { state.planets.splice(i, 1); persist(); rerender(); } }, 'remove planet'),
    ),
    ...resRows,
    el('button', {
      class: 'small',
      click: () => {
        const first = resourcesOf(p.type)[0];
        if (first === undefined) return;
        p.resources.push({ p0: first, w: Math.round(DENSITY_REFERENCE_W) });
        persist(); rerender();
      },
    }, '+ scanned resource'),
  );
}

function sectionPlanets(): HTMLElement {
  return el('section', {},
    el('h2', {}, `2 · Planets — raw survey units (w), % shown as translation`),
    el('p', { class: 'muted' }, 'Enter qty_per_cycle from the in-game survey window. Densities above 100% are real and never capped; the engine works in raw units.'),
    ...state.planets.map((p, i) => planetRow(p, i)),
    el('button', {
      click: () => { state.planets.push({ name: `Planet ${state.planets.length + 1}`, type: 'Barren', resources: [] }); persist(); rerender(); },
    }, '+ planet'),
  );
}

function neededCommodities(s: UiState): string[] {
  const names = new Set<string>([s.product]);
  try {
    const src = currentSourcing(s);
    for (const p1 of p1InputsOf(s.product)) {
      names.add(p1); // extracted P1 surplus gets sold, bought P1 gets priced
      if (src[p1] === 'refine') names.add(oreOf(p1));
    }
  } catch { /* product invalid mid-edit */ }
  return [...names];
}

function sectionMarket(): HTMLElement {
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
      el('td', {}, el('input', { type: 'number', value: String(q.bid), min: '0', step: 'any', change: upd('bid') })),
      el('td', {}, el('input', { type: 'number', value: String(q.ask), min: '0', step: 'any', change: upd('ask') })),
      el('td', {}, el('input', { type: 'number', value: String(q.dailyVolume ?? ''), min: '0', step: 'any', change: upd('dailyVolume') })),
    );
  });
  const fetchBtn = el('button', {
    click: () => {
      fetchBtn.textContent = 'Fetching Jita order books…';
      const names = neededCommodities(state);
      fetchPrices(names, {
        ids: idRegistry(),
        now: () => new Date().toISOString(),
        fetchJson: async (url) => {
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return { body: await res.json(), headers: {} };
        },
      }).then((snap) => {
        for (const [name, quote] of Object.entries(snap.prices)) state.prices[name] = { ...quote };
        state.priceNote = `Live: ${snap.source} at ${snap.fetchedAt}.` +
          (snap.unpriced.length > 0 ? ` UNPRICED: ${snap.unpriced.map((u) => `${u.name} (${u.reason})`).join('; ')}` : '');
        persist(); rerender();
      }).catch((e: Error) => {
        state.priceNote = `Live fetch failed: ${e.message} — enter quotes manually.`;
        persist(); rerender();
      });
    },
  }, 'Fetch live Jita prices (ESI)');
  return el('section', {},
    el('h2', {}, '3 · Market & costs'),
    el('p', { class: 'muted' }, state.priceNote),
    el('table', {},
      el('tr', {}, ...['Commodity', 'Best bid (instant sell)', 'Best ask (list / instant buy)', 'Daily volume (optional)'].map((h) => el('th', {}, h))),
      ...priceRows,
    ),
    fetchBtn,
    el('div', { class: 'resrow' },
      el('label', {}, 'Sales tax % ', numInput(state.fees.salesTaxPct, 0, 100, 0.001, (v) => { state.fees.salesTaxPct = v; })),
      el('label', {}, 'Broker % ', numInput(state.fees.brokerPct, 0, 100, 0.001, (v) => { state.fees.brokerPct = v; })),
      el('label', {}, 'Customs owner % ', numInput(state.fees.customsPct, 0, 100, 0.1, (v) => { state.fees.customsPct = v; })),
      el('label', {}, el('input', {
        type: 'checkbox', ...(state.fees.hisecNpc ? { checked: 'checked' } : {}),
        change: (ev) => { state.fees.hisecNpc = (ev.target as HTMLInputElement).checked; persist(); rerender(); },
      }), ' hisec NPC component'),
    ),
    el('div', { class: 'resrow' },
      el('label', {}, 'Freight out ISK/m³ ', numInput(state.freight.outPerM3, 0, 1e6, 1, (v) => { state.freight.outPerM3 = v; })),
      el('label', {}, 'Freight in ISK/m³ ', numInput(state.freight.inPerM3, 0, 1e6, 1, (v) => { state.freight.inPerM3 = v; })),
      el('label', {}, 'Sell ', basisSelect(state.sellBasis, (v) => { state.sellBasis = v; })),
      el('label', {}, 'Buy ', basisSelect(state.buyBasis, (v) => { state.buyBasis = v; })),
    ),
  );
}

function basisSelect(value: 'immediate' | 'patient', set: (v: 'immediate' | 'patient') => void): HTMLElement {
  return el('select', {
    change: (ev) => { set((ev.target as HTMLSelectElement).value as 'immediate' | 'patient'); persist(); rerender(); },
  }, ...(['immediate', 'patient'] as const).map((b) => {
    const o = el('option', { value: b }, b === 'immediate' ? 'immediate (hit orders, no broker)' : 'patient (rest orders, broker fee)');
    if (b === value) o.setAttribute('selected', 'selected');
    return o;
  }));
}

function sectionGoal(): HTMLElement {
  const productSel = el('select', {
    change: (ev) => { state.product = (ev.target as HTMLSelectElement).value; state.sourcingOverrides = {}; persist(); rerender(); },
  }, ...[...SCHEMATICS.keys()].sort((a, b) => tierOf(a) - tierOf(b) || a.localeCompare(b)).map((name) => {
    const o = el('option', { value: name }, `P${tierOf(name)} — ${name}`);
    if (name === state.product) o.setAttribute('selected', 'selected');
    return o;
  }));

  let sourcingRows: HTMLElement[] = [];
  try {
    const src = currentSourcing(state);
    sourcingRows = Object.entries(src).map(([p1, mode]) =>
      el('div', { class: 'resrow' },
        el('span', {}, p1),
        el('select', {
          change: (ev) => { state.sourcingOverrides[p1] = (ev.target as HTMLSelectElement).value as Sourcing; persist(); rerender(); },
        }, ...(['extract', 'refine', 'buy'] as const).filter((m) => !(p1 === state.product && m === 'buy')).map((m) => {
          const label = m === 'extract' ? 'extract (mine it)' : m === 'refine' ? 'refine (buy ore, 150:1)' : 'buy finished';
          const o = el('option', { value: m }, label);
          if (m === mode) o.setAttribute('selected', 'selected');
          return o;
        })),
      ),
    );
  } catch { /* product mid-edit */ }

  const modes: Array<[UiState['mode'], string]> = [
    ['max', 'Maximum output/profit from my planets'],
    ['quota', 'Hit a weekly quota with minimal colonies'],
    ['qol', 'Best net within a login budget'],
    ['compare', 'Compare every product (ranked frontier)'],
  ];
  return el('section', {},
    el('h2', {}, '4 · Goal'),
    el('div', { class: 'resrow' }, el('label', {}, 'Product '), productSel,
      el('label', {}, ' Program '),
      el('select', {
        change: (ev) => { state.programHours = Number((ev.target as HTMLSelectElement).value); persist(); rerender(); },
      }, ...[6, 12, 24, 48, 96, 168, 336].map((h) => {
        const o = el('option', { value: String(h) }, `${h}h (${fmt1(168 / h)} sessions/wk)`);
        if (h === state.programHours) o.setAttribute('selected', 'selected');
        return o;
      })),
    ),
    el('h3', {}, 'Sourcing per input'), ...sourcingRows,
    el('div', {}, ...modes.map(([m, label]) => el('label', { class: 'mode' },
      (() => {
        const r = el('input', { type: 'radio', name: 'mode', value: m, change: () => { state.mode = m; persist(); rerender(); } });
        if (state.mode === m) r.setAttribute('checked', 'checked');
        return r;
      })(), ` ${label}`,
    ))),
    state.mode === 'quota'
      ? el('label', {}, 'Target/week ', numInput(state.quotaPerWeek, 1, 1e9, 1, (v) => { state.quotaPerWeek = v; }))
      : null,
    state.mode === 'qol'
      ? el('label', {}, 'Max sessions/week ', numInput(state.qolSessions, 0.5, 28, 0.5, (v) => { state.qolSessions = v; }))
      : null,
  );
}

// ---------------------------------------------------------------------------
// Solve + results
// ---------------------------------------------------------------------------

const resultsBox = el('div', {});

function runSolve(): void {
  resultsBox.replaceChildren(el('p', {}, 'Solving…'));
  setTimeout(() => {
    try {
      const world = toWorld(state);
      if (state.mode === 'compare') {
        const market = toMarket(state);
        const { ranked, excluded } = comparative(world, market);
        resultsBox.replaceChildren(
          el('h2', {}, '5 · Results — ranked frontier'),
          el('table', {},
            el('tr', {}, ...['#', 'Product', 'Net ISK/wk', 'Output/wk', 'Method'].map((h) => el('th', {}, h))),
            ...ranked.slice(0, 15).map((r, i) => el('tr', {},
              el('td', {}, String(i + 1)), el('td', {}, r.product),
              el('td', {}, fmt(r.economics.netPerWeek)), el('td', {}, fmt(r.result.realizedPerWeek)),
              el('td', {}, r.result.method),
            )),
          ),
          el('details', {}, el('summary', {}, `${excluded.length} products excluded (each with a named reason)`),
            el('ul', {}, ...excluded.slice(0, 40).map((x) => el('li', {}, `${x.product}: ${x.reason}`)))),
        );
        return;
      }
      const sourcing = currentSourcing(state);
      let result: SolveResult;
      const extra: HTMLElement[] = [];
      if (state.mode === 'quota') {
        const q = solveQuota(world, state.product, state.quotaPerWeek, sourcing);
        if ('error' in q) {
          resultsBox.replaceChildren(el('div', { class: 'warn' },
            `${q.error}${q.achievablePerWeek !== undefined ? ` — achievable: ${fmt(q.achievablePerWeek)}/wk` : ''}`));
          return;
        }
        result = q;
      } else if (state.mode === 'qol') {
        const q = qolSolve(world, state.product, toMarket(state), state.qolSessions, sourcing);
        if ('error' in q) { resultsBox.replaceChildren(el('div', { class: 'warn' }, q.error)); return; }
        result = q.result;
        extra.push(el('p', { class: 'muted' }, `Chosen cadence: ${q.programHours}h programs (${fmt1(168 / q.programHours)} sessions/wk).`));
      } else {
        const r = solveMax(world, state.product, sourcing);
        if ('error' in r) { resultsBox.replaceChildren(el('div', { class: 'warn' }, r.error)); return; }
        result = r;
      }
      resultsBox.replaceChildren(el('h2', {}, '5 · Results'), renderResult(result, state, extra));
    } catch (e) {
      resultsBox.replaceChildren(el('div', { class: 'warn' }, (e as Error).message));
    }
  }, 30);
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const root = document.getElementById('app')!;

function rerender(): void {
  root.replaceChildren(
    el('header', {},
      el('h1', {}, 'Solving PI'),
      el('p', { class: 'muted' },
        'v9 prototype — verified physics, one ledger, judge-validated plans. ',
        el('a', { href: 'https://github.com/LackingTallent/SolvingPI', target: '_blank', rel: 'noreferrer' }, 'about'),
      ),
    ),
    sectionOperation(),
    sectionPlanets(),
    sectionMarket(),
    sectionGoal(),
    el('section', {},
      el('button', { class: 'solve', click: runSolve }, 'Solve'),
      el('button', {
        class: 'small', click: () => {
          if (confirm('Reset everything to defaults?')) { state = defaultState(); persist(); rerender(); }
        },
      }, 'reset'),
    ),
    resultsBox,
  );
}

// ---------------------------------------------------------------------------
// Self-test: the page proves its own wiring on load (kills "alive but
// unwired" — v8's worst failure shape). A canned world is solved end-to-end;
// success stamps data attributes the smoke test reads from the DOM.
// ---------------------------------------------------------------------------

function selfTest(): void {
  try {
    const world: SolveWorld = {
      operation: operation([character({ name: 'smoke', icLevel: 2, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 })]),
      planets: [
        { name: 'S-1', type: 'Storm', resources: { 'Aqueous Liquids': 13000, 'Ionic Solutions': 12000 } },
        { name: 'S-2', type: 'Gas', resources: { 'Aqueous Liquids': 9000, 'Ionic Solutions': 11000 } },
        { name: 'S-3', type: 'Barren', resources: {} }, // factory site: one colony per char per planet
      ],
      programHours: 6,
    };
    const r = solveMax(world, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
    if ('error' in r) throw new Error(r.error);
    if (!r.verdict.legal || r.realizedPerWeek <= 0) throw new Error('selftest: implausible result');
    document.body.dataset['selftest'] = 'pass';
  } catch (e) {
    document.body.dataset['selftest'] = `fail: ${(e as Error).message}`;
  }
}

rerender();
selfTest();
document.body.dataset['smoke'] = 'ok';
