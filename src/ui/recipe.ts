/**
 * RECIPE CALCULATOR (reference tool, owner ask 2026-09-03): pick commodities
 * and batch sizes; get the exact inputs, their cost and freight volume, and
 * a build-time estimate for the factory count you have.
 *
 * Pure schematic math — quantities come straight from SCHEMATICS ratios
 * (game truth), prices from the same live quotes the rest of the site uses.
 * No allocator, no planets: this answers "what does this batch take?",
 * not "can my colonies do it?" (the planner answers that).
 */
import { SCHEMATICS, tierOf } from '../spec/schematics.js';
import { TIER_VOLUME_M3, type Tier } from '../spec/constants.js';

interface RecipeQuote { readonly bid: number; readonly ask: number }
type QuoteFn = (name: string) => RecipeQuote | undefined;

interface RecipeRow { product: string; units: number; factories: number }

let rows: RecipeRow[] = [{ product: 'Robotics', units: 1000, factories: 10 }];
let breakdown: 'direct' | 'p0' = 'direct';
let quoteOf: QuoteFn = () => undefined;
// "What can I build?" (owner ask 2026-09-03): pasted inventory state.
let pasteText = '';
let stock: Map<string, number> | null = null;
let unrecognized: string[] = [];

// Tiny local DOM helper (mirrors app.ts's el(); kept local so this module
// stays a leaf with no UI-layer imports).
function h(tag: string, attrs: Record<string, string> = {}, ...children: Array<Node | string | null>): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) if (c !== null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('en-US');
const fmtIsk = (n: number): string => `${fmt(n)} ISK`;

function fmtDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const hr = Math.floor((seconds % 86400) / 3600);
  const min = Math.round((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${hr}h`;
  if (hr > 0) return `${hr}h ${min}m`;
  return `${Math.max(1, min)}m`;
}

/** Recursive input demand. mode 'direct': one level down. mode 'p0': walk to
 * raw P0, collecting every intermediate made along the way. */
function demand(product: string, units: number, mode: 'direct' | 'p0'): {
  buy: Map<string, number>;
  make: Map<string, number>;
} {
  const buy = new Map<string, number>();
  const make = new Map<string, number>();
  const s = SCHEMATICS.get(product);
  if (s === undefined) return { buy, make };
  if (mode === 'direct') {
    for (const [input, perCycle] of Object.entries(s.inputs)) {
      buy.set(input, (buy.get(input) ?? 0) + (perCycle / s.outQty) * units);
    }
    return { buy, make };
  }
  const walk = (name: string, qty: number): void => {
    const schem = SCHEMATICS.get(name);
    if (schem === undefined || tierOf(name) === 0) {
      buy.set(name, (buy.get(name) ?? 0) + qty);
      return;
    }
    make.set(name, (make.get(name) ?? 0) + qty);
    for (const [input, perCycle] of Object.entries(schem.inputs)) {
      walk(input, (perCycle / schem.outQty) * qty);
    }
  };
  for (const [input, perCycle] of Object.entries(s.inputs)) {
    walk(input, (perCycle / s.outQty) * units);
  }
  return { buy, make };
}

/** Every commodity name the calculator knows (products + every input, P0s included). */
function allNames(): Map<string, string> {
  const m = new Map<string, string>(); // lowercase -> canonical
  for (const [name, schem] of SCHEMATICS) {
    m.set(name.toLowerCase(), name);
    for (const input of Object.keys(schem.inputs)) m.set(input.toLowerCase(), input);
  }
  return m;
}

/**
 * Parse a pasted inventory. Accepts the game's clipboard format (tab-separated
 * columns: name, quantity, group, volume, est. price) and plain "Name  1234"
 * lines. Unknown lines are reported by name, never silently dropped.
 */
function parseInventory(text: string): { stock: Map<string, number>; bad: string[] } {
  const names = allNames();
  const out = new Map<string, number>();
  const bad: string[] = [];
  const numeric = (tok: string): number | null => {
    const t = tok.trim();
    if (t === '' || /[a-z]/i.test(t)) return null;
    // Quantities are integers; commas/dots/spaces are thousands separators.
    // A trailing 2-digit decimal group (est. price columns) is cut off.
    const cut = t.replace(/[.,]\d{1,2}$/, '');
    const digits = cut.replace(/[^\d]/g, '');
    return digits === '' ? null : Number(digits);
  };
  // Round-2 robustness: parsing is O(lines × known-names) on prefix lines, so
  // cap a pathological paste instead of freezing the tab.
  const MAX_LINES = 2000;
  const allLines = text.split(/\r?\n/);
  if (allLines.length > MAX_LINES) bad.push(`…input capped at ${MAX_LINES.toLocaleString('en-US')} lines (${allLines.length.toLocaleString('en-US')} pasted)`);
  for (const rawLine of allLines.slice(0, MAX_LINES)) {
    const line = rawLine.trim();
    if (line === '') continue;
    let name: string | null = null;
    let qty: number | null = null;
    const fields = line.split('\t').map((f) => f.trim()).filter((f) => f !== '');
    if (fields.length > 1) {
      for (const f of fields) {
        const canon = names.get(f.toLowerCase());
        if (canon !== undefined && name === null) { name = canon; continue; }
        const n = numeric(f);
        if (n !== null && qty === null) qty = n;
      }
    } else {
      // "Name 1,234" — the name is the longest known prefix.
      const lower = line.toLowerCase();
      let matchLen = 0;
      for (const [k, canon] of names) {
        if (k.length > matchLen && lower.startsWith(k)) { name = canon; matchLen = k.length; }
      }
      if (name !== null) qty = numeric(line.slice(matchLen));
    }
    if (name === null) { bad.push(line.slice(0, 40)); continue; }
    out.set(name, (out.get(name) ?? 0) + (qty ?? 0));
  }
  return { stock: out, bad };
}

/** Can `stockIn` cover `units` of `product`? Stocked intermediates are spent
 * FIRST; the remainder is crafted from lower tiers (stated policy — a full
 * mix-and-match optimum would be an LP; this is the honest greedy). */
function craftable(product: string, units: number, stockIn: ReadonlyMap<string, number>): boolean {
  const pool = new Map(stockIn);
  let ok = true;
  const need = (name: string, qty: number): void => {
    if (!ok || qty <= 1e-9) return;
    const have = pool.get(name) ?? 0;
    const take = Math.min(have, qty);
    if (take > 0) pool.set(name, have - take);
    const remain = qty - take;
    if (remain <= 1e-9) return;
    const schem = SCHEMATICS.get(name);
    if (schem === undefined) { ok = false; return; } // P0 shortfall
    for (const [input, perCycle] of Object.entries(schem.inputs)) {
      need(input, (perCycle / schem.outQty) * remain);
      if (!ok) return;
    }
  };
  const s = SCHEMATICS.get(product);
  if (s === undefined) return false;
  for (const [input, perCycle] of Object.entries(s.inputs)) {
    need(input, (perCycle / s.outQty) * units);
    if (!ok) return false;
  }
  return ok;
}

/** Max whole units of `product` buildable from the stock (binary search). */
function maxBuildable(product: string, stockIn: ReadonlyMap<string, number>): number {
  if (!craftable(product, 1, stockIn)) return 0;
  let hi = 1;
  while (hi < 1e9 && craftable(product, hi * 2, stockIn)) hi *= 2;
  let lo = hi;
  hi = hi * 2;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (craftable(product, mid, stockIn)) lo = mid; else hi = mid;
  }
  return lo;
}

function facilityLabel(f: 'basic' | 'advanced' | 'hightech'): string {
  return f === 'basic' ? 'Basic' : f === 'advanced' ? 'Advanced' : 'High-tech';
}

function tierLabel(t: Tier): string { return `P${t}`; }

function render(): void {
  const panel = document.getElementById('recipePanel');
  if (panel === null) return;
  const products = [...SCHEMATICS.keys()].sort((a, b) => a.localeCompare(b));

  // ── Controls: one row per recipe line ─────────────────────────────────
  const controlRows = rows.map((row, i) => {
    const sel = h('select', { 'aria-label': 'Commodity to manufacture' },
      ...products.map((p) => {
        const o = h('option', { value: p }, `${p} (P${tierOf(p)})`);
        if (p === row.product) o.setAttribute('selected', 'selected');
        return o;
      }));
    sel.addEventListener('change', () => { row.product = (sel as HTMLSelectElement).value; render(); });
    const unitsIn = h('input', { class: 'v9-num', type: 'number', min: '1', step: '1', value: String(row.units), 'aria-label': 'Units to manufacture' }) as HTMLInputElement;
    unitsIn.addEventListener('change', () => {
      const v = Number(unitsIn.value);
      row.units = Number.isFinite(v) && v >= 1 ? Math.round(v) : row.units;
      unitsIn.value = String(row.units);
      render();
    });
    const facIn = h('input', { class: 'v9-num', type: 'number', min: '1', step: '1', value: String(row.factories), 'aria-label': 'Factories running this recipe' }) as HTMLInputElement;
    facIn.addEventListener('change', () => {
      const v = Number(facIn.value);
      row.factories = Number.isFinite(v) && v >= 1 ? Math.round(v) : row.factories;
      facIn.value = String(row.factories);
      render();
    });
    const rm = h('button', { class: 'btn small', title: 'Remove this recipe line', type: 'button' }, '✕');
    rm.addEventListener('click', () => { rows.splice(i, 1); if (rows.length === 0) rows.push({ product: 'Robotics', units: 1000, factories: 10 }); render(); });
    return h('div', { class: 'v9-row' },
      sel,
      h('label', {}, 'Units ', unitsIn),
      h('label', {}, 'Factories ', facIn),
      rows.length > 1 ? rm : null,
    );
  });

  const addBtn = h('button', { class: 'btn small', type: 'button' }, '+ Add commodity');
  addBtn.addEventListener('click', () => { rows.push({ product: 'Coolant', units: 1000, factories: 5 }); render(); });

  const modeBtn = (m: 'direct' | 'p0', label: string): HTMLElement => {
    const b = h('button', { class: `btn small src-choice${breakdown === m ? ' active' : ''}`, type: 'button' }, label);
    b.addEventListener('click', () => { breakdown = m; render(); });
    return b;
  };

  // ── Build plan per line ───────────────────────────────────────────────
  const planTable = h('table', { class: 'v9-table' },
    // Round-2 design fix: the qualifier lived only in a footnote — the header
    // itself must say what the number covers. In p0 mode intermediate tiers
    // build BEFORE the timed final step, so "final step only" is load-bearing.
    h('tr', {}, ...['Commodity', 'Units', 'Factory', 'Per factory', 'Factories', breakdown === 'p0' ? 'Build time (final step only)' : 'Build time'].map((x) => h('th', {}, x))),
    ...rows.map((row) => {
      const s = SCHEMATICS.get(row.product)!;
      const cycles = Math.ceil(row.units / s.outQty);
      const seconds = Math.ceil(cycles / row.factories) * s.cycleSeconds;
      const perHour = (s.outQty * 3600) / s.cycleSeconds;
      return h('tr', {},
        h('td', {}, row.product),
        h('td', {}, fmt(row.units)),
        h('td', {}, facilityLabel(s.facility)),
        h('td', {}, `${s.outQty}/cycle · ${fmt(perHour)}/hr · ${fmt(perHour * 24)}/day`),
        h('td', {}, String(row.factories)),
        h('td', {}, `${fmtDuration(seconds)} (${fmt(cycles)} cycles)`),
      );
    }),
  );

  // ── Aggregate demand across every line ────────────────────────────────
  const buyTotals = new Map<string, number>();
  const makeTotals = new Map<string, number>();
  for (const row of rows) {
    const d = demand(row.product, row.units, breakdown);
    for (const [n, q] of d.buy) buyTotals.set(n, (buyTotals.get(n) ?? 0) + q);
    for (const [n, q] of d.make) makeTotals.set(n, (makeTotals.get(n) ?? 0) + q);
  }
  const byTierThenName = (a: [string, number], b: [string, number]): number =>
    (tierOf(a[0]) - tierOf(b[0])) || a[0].localeCompare(b[0]);

  let totalCost = 0;
  let costComplete = true;
  let totalInM3 = 0;
  const unpriced: string[] = [];
  const shopRows = [...buyTotals.entries()].sort(byTierThenName).map(([name, rawQty]) => {
    const qty = Math.ceil(rawQty);
    const tier = tierOf(name);
    const m3 = qty * TIER_VOLUME_M3[tier];
    totalInM3 += m3;
    const q = quoteOf(name);
    const cost = q !== undefined && q.ask > 0 ? qty * q.ask : null;
    if (cost === null) { costComplete = false; unpriced.push(name); } else totalCost += cost;
    return h('tr', {},
      h('td', {}, name),
      h('td', {}, tierLabel(tier)),
      h('td', {}, fmt(qty)),
      h('td', {}, cost === null ? '—' : fmt(q!.ask)),
      h('td', {}, cost === null ? '—' : fmt(cost)),
      h('td', {}, fmt1(m3)),
    );
  });
  const shopTable = h('table', { class: 'v9-table' },
    h('tr', {}, ...['Input', 'Tier', 'Qty', 'Ask each', 'Cost (ISK)', 'm³'].map((x) => h('th', {}, x))),
    ...shopRows,
    h('tr', { class: 'v9-total' },
      h('td', {}, 'Total'), h('td', {}, ''), h('td', {}, ''), h('td', {}, ''),
      h('td', {}, `${fmt(totalCost)}${costComplete ? '' : ' + unpriced'}`),
      h('td', {}, fmt1(totalInM3)),
    ),
  );

  const makeRows = [...makeTotals.entries()].sort(byTierThenName).map(([name, rawQty]) => {
    const qty = Math.ceil(rawQty);
    const s = SCHEMATICS.get(name)!;
    const facHours = (qty / s.outQty) * (s.cycleSeconds / 3600);
    return h('tr', {},
      h('td', {}, name),
      h('td', {}, tierLabel(tierOf(name))),
      h('td', {}, fmt(qty)),
      h('td', {}, facilityLabel(s.facility)),
      h('td', {}, `${fmt1(facHours)} factory-hours`),
    );
  });

  // ── Output summary ────────────────────────────────────────────────────
  let outM3 = 0;
  let outValue = 0;
  let outPriced = true;
  for (const row of rows) {
    outM3 += row.units * TIER_VOLUME_M3[tierOf(row.product)];
    const q = quoteOf(row.product);
    if (q !== undefined && q.bid > 0) outValue += row.units * q.bid; else outPriced = false;
  }

  const children: Array<Node | null> = [
    h('p', { class: 'section-sub' },
      'Pick what to manufacture and how many. Quantities are exact schematic ratios; prices are the live Jita quotes from 3. MARKET.'),
    ...controlRows,
    h('div', { class: 'v9-row' }, addBtn,
      h('span', { class: 'v9-muted' }, 'Inputs:'), modeBtn('direct', 'Direct inputs'), modeBtn('p0', 'Everything from raw P0')),
    h('h3', {}, 'Build plan'),
    planTable,
    h('h3', {}, breakdown === 'direct' ? 'Shopping list — direct inputs' : 'Shopping list — raw P0'),
    shopTable,
    unpriced.length > 0
      ? h('p', { class: 'v9-muted' }, `Unpriced (press “Refresh now” in 3. MARKET): ${unpriced.join(', ')}.`)
      : null,
    ...(breakdown === 'p0' && makeRows.length > 0
      ? [h('h3', {}, 'You make these along the way'),
        h('table', { class: 'v9-table' },
          h('tr', {}, ...['Intermediate', 'Tier', 'Qty', 'Factory', 'Work'].map((x) => h('th', {}, x))),
          ...makeRows),
        h('p', { class: 'v9-muted' }, 'Intermediates are made, not bought — their factory work is listed; the batch time above covers the FINAL step only.')]
      : []),
    h('h3', {}, 'Output'),
    h('p', {},
      `${rows.map((r) => `${fmt(r.units)} ${r.product}`).join(' + ')} — ${fmt1(outM3)} m³ to haul` +
      (outValue > 0 ? `, worth ${fmtIsk(outValue)} at instant-sell${outPriced ? '' : ' (some outputs unpriced)'}` : '')),
    ...buildFromStockBlock(),
  ];
  panel.replaceChildren(...children.filter((c): c is Node => c !== null));
}

/** "What can I build from my materials?" — paste an inventory, get the
 * buildable board ranked by instant-sell value. */
function buildFromStockBlock(): HTMLElement[] {
  const ta = h('textarea', {
    class: 'v9-template', rows: '6',
    placeholder: 'Paste your materials here — straight from the game (select items → Ctrl+C) or one per line, e.g.\nWater\t8,000\nElectrolytes 8000',
    'aria-label': 'Materials list to analyze',
  }) as HTMLTextAreaElement;
  ta.value = pasteText;
  ta.addEventListener('input', () => { pasteText = ta.value; });
  const goBtn = h('button', { class: 'btn small', type: 'button' }, 'What can I build?');
  goBtn.addEventListener('click', () => {
    const parsed = parseInventory(pasteText);
    stock = parsed.stock;
    unrecognized = parsed.bad;
    render();
  });
  const clearBtn = h('button', { class: 'btn small', type: 'button' }, 'Clear');
  clearBtn.addEventListener('click', () => { pasteText = ''; stock = null; unrecognized = []; render(); });

  const out: HTMLElement[] = [
    h('h3', {}, 'What can I build from my materials?'),
    h('p', { class: 'section-sub' },
      'Paste a list of materials (the game’s inventory copy works as-is). Stocked intermediates are used first; the rest is crafted from your lower tiers.'),
    ta,
    h('div', { class: 'v9-row' }, goBtn, stock !== null ? clearBtn : null),
  ];
  if (stock === null) return out;

  const held = [...stock.entries()].filter(([, q]) => q > 0);
  out.push(h('p', { class: 'v9-muted' },
    held.length === 0
      ? 'No known PI materials recognized in the paste.'
      : `Recognized: ${held.map(([n, q]) => `${n} ×${fmt(q)}`).join(', ')}.`));
  if (unrecognized.length > 0) {
    out.push(h('p', { class: 'v9-muted' }, `Not recognized (skipped): ${unrecognized.slice(0, 8).join(' · ')}${unrecognized.length > 8 ? ` · +${unrecognized.length - 8} more` : ''}.`));
  }
  if (held.length === 0) return out;

  // Every product with a positive buildable count, ranked by instant-sell value.
  const options: Array<{ product: string; tier: Tier; units: number; value: number | null }> = [];
  for (const product of SCHEMATICS.keys()) {
    const units = maxBuildable(product, stock);
    if (units <= 0) continue;
    const q = quoteOf(product);
    options.push({ product, tier: tierOf(product), units, value: q !== undefined && q.bid > 0 ? units * q.bid : null });
  }
  if (options.length === 0) {
    out.push(h('p', {}, 'Nothing is buildable from these materials — every recipe is missing at least one input.'));
    return out;
  }
  options.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || b.tier - a.tier || a.product.localeCompare(b.product));
  out.push(
    h('p', { class: 'v9-muted' }, `${options.length} product${options.length === 1 ? ' is' : 's are'} buildable. Each row is the MAX if you spend your materials on that product alone — ranked by instant-sell value.`),
    h('table', { class: 'v9-table', id: 'recipeStockTable' },
      h('tr', {}, ...['Product', 'Tier', 'Max units (exclusive)', 'Value (instant sell)', ''].map((x) => h('th', {}, x))),
      ...options.slice(0, 20).map((o) => {
        const plan = h('button', { class: 'btn small', type: 'button', title: 'Load this batch into the calculator above' }, 'Plan batch ↑');
        plan.addEventListener('click', () => {
          rows = [{ product: o.product, units: o.units, factories: rows[0]?.factories ?? 5 }];
          render();
          document.getElementById('recipePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return h('tr', {},
          h('td', {}, o.product),
          h('td', {}, tierLabel(o.tier)),
          h('td', {}, fmt(o.units)),
          h('td', {}, o.value === null ? '—' : fmt(o.value)),
          h('td', {}, plan),
        );
      }),
    ),
  );
  if (options.length > 20) out.push(h('p', { class: 'v9-muted' }, `Top 20 of ${options.length} shown.`));
  return out;
}

/** Wire the tool. quote: live price lookup (same source as the whole site). */
export function initRecipe(quote: QuoteFn): void {
  quoteOf = quote;
  render();
}

/** Re-render with current quotes (call after a price refresh). */
export function refreshRecipe(): void {
  if (document.getElementById('recipePanel') !== null) render();
}
