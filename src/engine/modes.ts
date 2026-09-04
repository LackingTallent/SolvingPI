/**
 * Modes: forward (max profit), backward (quota), attention-first (QOL), and
 * comparative (ranked frontier). Modes differ ONLY in objective and direction —
 * every one of them prices through settle() and proposes through the judge.
 * A missing price refuses BY NAME; nothing is silently assumed zero.
 */
import { solveMax, solveQuota, type SolveResult, type SolveWorld } from './allocator.js';
import { settle, type LedgerResult, type PriceBasis } from './ledger.js';
import { steadyState } from './flow.js';
import { tierOf, SCHEMATICS } from '../spec/schematics.js';
import { TIER_VOLUME_M3 } from '../spec/constants.js';
import { iskPerM3, iskPerQty, m3, qty } from '../units.js';
import type { CustomsContext } from '../world/tax.js';
import { chainIntermediates, type Sourcing } from './chain.js';
import { p1InputsOf, oreOf } from './chain.js';
import { HOURS_PER_WEEK } from './flow.js';

export interface Quote {
  readonly bid: number;
  readonly ask: number;
  /** Regional units traded per day (ESI market history). Optional — saturation
   * analytics report "unavailable" by name when absent, never guess. */
  readonly dailyVolume?: number;
  /** Order-book depth, best-first (truth audit T-09): with it, 'immediate'
   * trades WALK the book for the week's whole quantity instead of pricing
   * everything at top-of-book — a 1-unit spoof order can no longer set the
   * price of an entire week's output. Absent → top-of-book (disclosed). */
  readonly bids?: ReadonlyArray<{ readonly price: number; readonly qty: number }>;
  readonly asks?: ReadonlyArray<{ readonly price: number; readonly qty: number }>;
}
export type PriceSet = Readonly<Record<string, Quote>>;

export interface MarketContext {
  readonly prices: PriceSet;
  readonly sellBasis: PriceBasis;   // immediate → bid, patient → ask
  readonly buyBasis: PriceBasis;    // immediate → ask, patient → bid
  readonly fees: { readonly salesTaxRate: number; readonly brokerRate: number };
  readonly customs: CustomsContext;
  readonly freightOutPerM3: number; // production system → market
  readonly freightInPerM3: number;  // market → production system
}

const MARKET_KEYS = ['prices', 'sellBasis', 'buyBasis', 'fees', 'customs', 'freightOutPerM3', 'freightInPerM3'] as const;

function checkMarket(m: MarketContext): void {
  const unknown = Object.keys(m).filter((k) => !(MARKET_KEYS as ReadonlyArray<string>).includes(k));
  if (unknown.length > 0) throw new Error(`market context: unknown keys: ${unknown.join(', ')}`);
  for (const k of ['freightOutPerM3', 'freightInPerM3'] as const) {
    if (!Number.isFinite(m[k]) || m[k] < 0) throw new Error(`${k} must be >= 0, got ${m[k]}`);
  }
}

/** Volume-weighted price from walking the book for `need` units. If the
 * visible book (top 15 levels) runs dry, the overflow does NOT fill at the
 * last level — that was optimistic (Round-2 math audit measured ~28% overstated
 * sell proceeds on thin books). Instead the book's own price-vs-quantity slope
 * is extrapolated linearly through the overflow: walking bids the slope is
 * negative (proceeds keep falling), walking asks it is positive (costs keep
 * rising), so the fill is conservative on both sides by construction. */
function walkBook(levels: ReadonlyArray<{ price: number; qty: number }>, need: number, top: number): number {
  if (levels.length === 0 || need <= 0) return top;
  let value = 0;
  let left = need;
  let last = top;
  for (const l of levels) {
    if (left <= 0) break;
    const take = Math.min(left, l.qty);
    value += take * l.price;
    left -= take;
    last = l.price;
  }
  if (left > 0) {
    const walked = need - left;
    const first = levels[0]!.price;
    const slope = walked > 0 ? (last - first) / walked : 0; // ISK per unit of depth, in the book's own direction
    const avgOverflow = Math.max(0, last + slope * (left / 2));
    value += left * avgOverflow;
  }
  return value / need;
}
/** Effective unit sell price for a weekly quantity (T-09: 'immediate' walks
 * the bid book when depth is present; 'patient' rests at the ask). */
function sellPrice(m: MarketContext, commodity: string, qtyPerWeek = 0): number {
  const q = m.prices[commodity];
  if (q === undefined) throw new Error(`missing-price: ${commodity} — refusing to value it silently`);
  if (m.sellBasis !== 'immediate') return q.ask;
  // Array.isArray, not just !== undefined (Round-4 hardening): depth from a
  // corrupted save must degrade to top-of-book, never iterate garbage.
  return Array.isArray(q.bids) ? walkBook(q.bids, qtyPerWeek, q.bid) : q.bid;
}
function buyPrice(m: MarketContext, commodity: string, qtyPerWeek = 0): number {
  const q = m.prices[commodity];
  if (q === undefined) throw new Error(`missing-price: ${commodity} — refusing to cost it silently`);
  if (m.buyBasis !== 'immediate') return q.bid;
  return Array.isArray(q.asks) ? walkBook(q.asks, qtyPerWeek, q.ask) : q.ask;
}

export interface Economics {
  readonly ledger: LedgerResult;
  readonly netPerWeek: number;
  readonly grossPerWeek: number;
  readonly sessionsPerWeek: number;
  readonly netPerSession: number;
  /** Weekly quantities sold, incl. surplus P1 (labeled). */
  readonly sold: ReadonlyArray<{ commodity: string; qtyPerWeek: number }>;
  readonly notes: ReadonlyArray<string>;
}

/**
 * Price a solved plan. Customs is derived from ACTUAL colony flows: every
 * commodity leaving a colony pays export, everything arriving pays import —
 * exactly the POCO/skyhook reality, no per-tab special cases (v8's Product/QOL
 * cards hardcoded these to zero; here there is no second code path to rot).
 */
export function economics(result: SolveResult, market: MarketContext, programHours: number): Economics {
  checkMarket(market);
  const notes: string[] = [];

  // Aggregate colony boundary flows (per hour) — kept per colony too, so
  // customs can charge each colony at ITS OWN character's Customs Code
  // Expertise (truth audit T-11: the roster's best level no longer pays
  // everyone's fees).
  const cceByCharacter = new Map<string, number>();
  for (const c of result.plan.operation.characters) cceByCharacter.set(c.name, c.customsCodeLevel);
  const exportsPerHour = new Map<string, number>();
  const importsPerHour = new Map<string, number>();
  const colonyFlows: Array<{ character: string; exports: Map<string, number>; imports: Map<string, number> }> = [];
  for (const colony of result.plan.colonies) {
    const flow = steadyState(colony.plan);
    const cx = new Map<string, number>();
    const ci = new Map<string, number>();
    for (const [name, f] of flow.perHour) {
      if (f.net > 1e-9) {
        exportsPerHour.set(name, (exportsPerHour.get(name) ?? 0) + f.net);
        cx.set(name, (cx.get(name) ?? 0) + f.net);
      }
    }
    for (const imp of colony.plan.imports) {
      importsPerHour.set(imp.commodity, (importsPerHour.get(imp.commodity) ?? 0) + imp.qtyPerHour);
      ci.set(imp.commodity, (ci.get(imp.commodity) ?? 0) + imp.qtyPerHour);
    }
    colonyFlows.push({ character: colony.characterName, exports: cx, imports: ci });
  }

  // What actually leaves the operation for market = exports − internal re-imports.
  const soldPerWeek = new Map<string, number>();
  for (const [name, exp] of exportsPerHour) {
    if (tierOf(name) === 0) { notes.push(`surplus P0 ${name} left unexported (not sold)`); continue; }
    const internal = Math.min(exp, importsPerHour.get(name) ?? 0);
    const outbound = (exp - internal) * HOURS_PER_WEEK;
    if (outbound > 1e-6) soldPerWeek.set(name, outbound);
  }
  const purchasedPerWeek = new Map<string, number>();
  for (const p of result.plan.logistics?.purchases ?? []) {
    purchasedPerWeek.set(p.commodity, (purchasedPerWeek.get(p.commodity) ?? 0) + p.qtyPerHour * HOURS_PER_WEEK);
  }

  // Ledger lines — 'immediate' trades walk the order book for the week's
  // whole quantity when depth is present (T-09).
  const sales = [...soldPerWeek].map(([commodity, q]) => ({
    commodity, qty: qty(q), unitPrice: iskPerQty(sellPrice(market, commodity, q)), basis: market.sellBasis,
  }));
  const purchases = [...purchasedPerWeek].map(([commodity, q]) => ({
    commodity, qty: qty(q), unitPrice: iskPerQty(buyPrice(market, commodity, q)), basis: market.buyBasis,
  }));
  {
    // Slippage disclosure: how far walked prices sit from top-of-book.
    let topValue = 0, walkedValue = 0;
    for (const [commodity, q] of soldPerWeek) {
      const quote = market.prices[commodity];
      if (quote?.bids !== undefined && market.sellBasis === 'immediate') {
        topValue += q * quote.bid;
        walkedValue += q * sellPrice(market, commodity, q);
      }
    }
    if (topValue > 0 && topValue - walkedValue > topValue * 0.005) {
      notes.push(`slippage: selling the week's volume into the book averages ${(100 * (topValue - walkedValue) / topValue).toFixed(1)}% below top-of-book — priced accordingly`);
    }
  }
  // Customs per colony at its own character's CCE (T-11); flows from colonies
  // whose character is unknown fall back to the market context's level.
  const customs = colonyFlows.flatMap(({ character, exports: cx, imports: ci }) => {
    const cce = cceByCharacter.get(character);
    const ctx = cce === undefined ? market.customs : { ...market.customs, customsCodeLevel: cce };
    return [
      ...[...cx].filter(([n]) => tierOf(n) !== 0).map(([commodity, perHour]) => ({
        label: `export ${commodity} (${character})`, tier: tierOf(commodity), qty: qty(perHour * HOURS_PER_WEEK),
        direction: 'export' as const, ctx,
      })),
      ...[...ci].map(([commodity, perHour]) => ({
        label: `import ${commodity} (${character})`, tier: tierOf(commodity), qty: qty(perHour * HOURS_PER_WEEK),
        direction: 'import' as const, ctx,
      })),
    ];
  });
  let outboundM3 = 0;
  for (const [name, q] of soldPerWeek) outboundM3 += q * TIER_VOLUME_M3[tierOf(name)];
  let inboundM3 = 0;
  for (const [name, q] of purchasedPerWeek) inboundM3 += q * TIER_VOLUME_M3[tierOf(name)];
  const freight = [
    ...(outboundM3 > 0 ? [{ label: 'to market', volumeM3: m3(outboundM3), ratePerM3: iskPerM3(market.freightOutPerM3) }] : []),
    ...(inboundM3 > 0 ? [{ label: 'from market', volumeM3: m3(inboundM3), ratePerM3: iskPerM3(market.freightInPerM3) }] : []),
  ];

  const ledger = settle({ sales, purchases, customs, freight, fees: market.fees });
  const sessionsPerWeek = HOURS_PER_WEEK / programHours;
  notes.push('sessions/week = 168 / program hours (each session restarts every extractor)');
  return {
    ledger,
    netPerWeek: ledger.net,
    grossPerWeek: ledger.gross,
    sessionsPerWeek,
    netPerSession: ledger.net / sessionsPerWeek,
    sold: [...soldPerWeek].map(([commodity, qtyPerWeek]) => ({ commodity, qtyPerWeek })),
    notes,
  };
}

/** Default sourcing policy: extract what the world offers, buy the rest. */
export function defaultSourcing(world: SolveWorld, product: string): Record<string, Sourcing> {
  const available = new Set<string>();
  for (const p of world.planets) for (const p0 of Object.keys(p.resources)) available.add(p0);
  const sourcing: Record<string, Sourcing> = {};
  for (const p1 of p1InputsOf(product)) {
    sourcing[p1] = available.has(oreOf(p1)) ? 'extract' : 'buy';
  }
  if (tierOf(product) === 1 && sourcing[product] === 'buy') sourcing[product] = 'refine';
  return sourcing;
}

export interface RankedOption {
  readonly product: string;
  readonly result: SolveResult;
  readonly economics: Economics;
}

/** Candidate products the chain data offers (P1..P4). */
export function allProducts(): string[] {
  return [...SCHEMATICS.keys()];
}

/**
 * Comparative mode: solve every candidate and rank by net/week. Candidates
 * whose chains are infeasible or unpriced are EXCLUDED WITH A NAMED REASON,
 * never silently dropped.
 *
 * RANKING TRUTH (Round-4 audit, 2026-09-03): the heuristic default sourcing
 * ("extract whatever ore you have") is availability-blind, not ISK-blind-
 * proof — a product could be reported at a fraction of its true reachable
 * net just because its ore happened to be scanned (measured: 25M reported vs
 * 318M reachable, a 44-place ranking error). When prices are loaded, every
 * candidate is now ranked at the BEST of several whole-chain sourcing
 * postures (heuristic / buy-all-P1s / final-step-only), and the top rows get
 * a per-input improvement sweep on top. User pins are never overruled by any
 * posture. `keepGround` (the scout) only admits plans that extract something.
 */
export function comparative(
  world: SolveWorld,
  market: MarketContext,
  candidates: ReadonlyArray<string> = allProducts(),
  overrides: Readonly<Record<string, Sourcing>> = {},
  options: { readonly secondChance?: boolean; readonly economic?: boolean; readonly keepGround?: boolean; readonly sweepTop?: number } = {},
): { ranked: RankedOption[]; excluded: Array<{ product: string; reason: string }> } {
  const ranked: RankedOption[] = [];
  const excluded: Array<{ product: string; reason: string }> = [];
  const economic = options.economic !== false && Object.keys(market.prices).length > 0;
  const keepGround = options.keepGround === true;

  /** Solve + price one sourcing; null when infeasible, unpriceable, or (scout)
   * ground-unused. Never throws. */
  const evalSourcing = (product: string, s: Readonly<Record<string, Sourcing>>): { result: SolveResult; eco: Economics } | null => {
    try {
      const r = solveMax(world, product, s, { method: 'greedy' });
      if ('error' in r) return null;
      if (keepGround && Object.keys(r.builtExtractP1).length === 0) return null;
      return { result: r, eco: economics(r, market, world.programHours) };
    } catch { return null; }
  };

  for (const product of candidates) {
    try {
      const sourcing = defaultSourcing(world, product);
      // User sourcing preferences apply to every candidate whose chain they
      // touch (owner spec: Compare respects Adjust sourcing).
      const p1s = new Set(Object.keys(sourcing));
      const inters = new Set(chainIntermediates(product));
      for (const [k, v] of Object.entries(overrides)) {
        if (p1s.has(k) && v !== 'make') sourcing[k] = v;
        else if (inters.has(k) && (v === 'buy' || v === 'make')) sourcing[k] = v;
      }
      if (tierOf(product) === 1 && sourcing[product] === 'buy') sourcing[product] = 'refine';

      if (economic) {
        // Posture set — pins (keys present in overrides) are never touched.
        const postures: Array<Record<string, Sourcing>> = [sourcing];
        const allBuy: Record<string, Sourcing> = { ...sourcing };
        for (const p1 of p1s) {
          if (overrides[p1] !== undefined) continue;
          allBuy[p1] = p1 === product ? 'refine' : 'buy';
        }
        postures.push(allBuy);
        if (tierOf(product) >= 2 && options.secondChance !== false) {
          const cut: Record<string, Sourcing> = { ...sourcing };
          for (const i of Object.keys(SCHEMATICS.get(product)!.inputs)) {
            if (tierOf(i) >= 1 && overrides[i] !== 'make') cut[i] = 'buy';
          }
          postures.push(cut);
        }
        let best: { result: SolveResult; eco: Economics } | null = null;
        for (const s of postures) {
          const e = evalSourcing(product, s);
          if (e !== null && (best === null || e.eco.netPerWeek > best.eco.netPerWeek)) best = e;
        }
        if (best !== null) {
          ranked.push({ product, result: best.result, economics: best.eco });
          continue;
        }
        // No posture both solved and priced — fall through to the classic
        // path so the exclusion carries its NAMED reason (never a silent drop).
      }

      // Classic path (also the no-prices path): heuristic sourcing, with the
      // feasibility-only second chance, and exceptions naming the exclusion.
      let result = solveMax(world, product, sourcing, { method: 'greedy' });
      if ('error' in result && tierOf(product) >= 2 && options.secondChance !== false) {
        // Second chance (owner spec): a chain that doesn't FIT can still be
        // profitable when its direct inputs are bought finished — e.g. buy
        // P3s, run one P4 factory. Try that cut before excluding.
        const cut: Record<string, Sourcing> = { ...sourcing };
        for (const i of Object.keys(SCHEMATICS.get(product)!.inputs)) {
          if (tierOf(i) >= 1 && overrides[i] !== 'make') cut[i] = 'buy';
        }
        const retry = solveMax(world, product, cut, { method: 'greedy' });
        if (!('error' in retry)) result = retry;
      }
      if ('error' in result) { excluded.push({ product, reason: result.error }); continue; }
      if (keepGround && Object.keys(result.builtExtractP1).length === 0) {
        excluded.push({ product, reason: 'ground-unused: only bought-input assembly fits here' });
        continue;
      }
      const eco = economics(result, market, world.programHours);
      ranked.push({ product, result, economics: eco });
    } catch (e) {
      excluded.push({ product, reason: (e as Error).message });
    }
  }
  ranked.sort((a, b) => b.economics.netPerWeek - a.economics.netPerWeek);

  // Improvement sweep on the rows where ranking precision matters most —
  // the shared per-row helper below, so a chunked caller (worker/fallback)
  // that merges chunks and then sweeps its top rows produces EXACTLY this
  // function's output. The sweep only ever RAISES a row's net, so the
  // "ranked by net" invariant is preserved.
  if (economic && ranked.length > 0) {
    const K = Math.min(options.sweepTop ?? 20, ranked.length);
    for (let i = 0; i < K; i++) {
      ranked[i] = sweepRankedRow(world, market, ranked[i]!, overrides, keepGround);
    }
    ranked.sort((a, b) => b.economics.netPerWeek - a.economics.netPerWeek);
  }
  return { ranked, excluded };
}

/**
 * Per-input improvement sweep for one ranked row (Round-4 ranking truth):
 * every alternative mode per un-pinned P1 is tried once, any strict net
 * improvement kept (≤ ~30 extra greedy solves). Pure — returns the improved
 * row (or the row unchanged). Chunked callers MUST apply this to their
 * merged top rows exactly as comparative() does, or chunked and whole-run
 * rankings drift apart.
 */
export function sweepRankedRow(
  world: SolveWorld,
  market: MarketContext,
  row: RankedOption,
  overrides: Readonly<Record<string, Sourcing>> = {},
  keepGround = false,
): RankedOption {
  let cur = { result: row.result, eco: row.economics };
  let curSourcing: Record<string, Sourcing> = { ...row.result.sourcing };
  for (const p1 of Object.keys(defaultSourcing(world, row.product))) {
    if (overrides[p1] !== undefined) continue;
    for (const mode of ['extract', 'refine', 'buy'] as const) {
      if (mode === curSourcing[p1]) continue;
      if (p1 === row.product && mode === 'buy') continue;
      const trial = { ...curSourcing, [p1]: mode };
      try {
        const r = solveMax(world, row.product, trial, { method: 'greedy' });
        if ('error' in r) continue;
        if (keepGround && Object.keys(r.builtExtractP1).length === 0) continue;
        const eco = economics(r, market, world.programHours);
        if (eco.netPerWeek > cur.eco.netPerWeek * (1 + 1e-9) + 1e-9) {
          cur = { result: r, eco };
          curSourcing = trial;
        }
      } catch { /* unpriceable alternative — not a candidate */ }
    }
  }
  return { product: row.product, result: cur.result, economics: cur.eco };
}

/** Forward mode: the single best option. */
export function maxProfit(
  world: SolveWorld,
  market: MarketContext,
  candidates?: ReadonlyArray<string>,
  overrides: Readonly<Record<string, Sourcing>> = {},
): { best: RankedOption; ranked: RankedOption[]; excluded: Array<{ product: string; reason: string }> } | { error: string } {
  const { ranked, excluded } = comparative(world, market, candidates ?? allProducts(), overrides);
  const best = ranked[0];
  if (best === undefined) {
    return { error: `no-viable-product: all candidates excluded (${excluded.length} reasons recorded)` };
  }
  return { best, ranked, excluded };
}

/** Backward mode: hit a quota with minimal colonies. */
export function quota(
  world: SolveWorld,
  product: string,
  targetPerWeek: number,
  market: MarketContext,
  sourcing?: Readonly<Record<string, Sourcing>>,
): { result: SolveResult; economics: Economics } | { error: string; achievablePerWeek?: number } {
  const s = sourcing ?? defaultSourcing(world, product);
  const r = solveQuota(world, product, targetPerWeek, s);
  if ('error' in r) return r;
  return { result: r, economics: economics(r, market, world.programHours) };
}

/** Attention-first mode: best net within a login budget (sessions per week). */
export function qolSolve(
  world: SolveWorld,
  product: string,
  market: MarketContext,
  maxSessionsPerWeek: number,
  sourcing?: Readonly<Record<string, Sourcing>>,
): { result: SolveResult; economics: Economics; programHours: number } | { error: string } {
  if (!Number.isFinite(maxSessionsPerWeek) || maxSessionsPerWeek <= 0)
    return { error: `qol-invalid: maxSessionsPerWeek must be > 0, got ${maxSessionsPerWeek}` };
  // Truth audit 2026-09-03: the old 7-point grid ([6,12,24,48,96,168,336])
  // could leave a third of a user's session budget unexplored between its
  // ~2x jumps. Program length is near-continuous in game; a denser grid
  // costs a few more solves and honors "best ISK for my play time".
  const candidates = [6, 8, 10, 12, 16, 20, 24, 32, 48, 72, 96, 120, 168, 240, 336]
    .filter((h) => HOURS_PER_WEEK / h <= maxSessionsPerWeek + 1e-9);
  if (candidates.length === 0) return { error: 'qol-invalid: even 14-day programs exceed that session budget' };
  const s = sourcing ?? defaultSourcing(world, product);
  let best: { result: SolveResult; economics: Economics; programHours: number } | null = null;
  for (const programHours of candidates) {
    const w: SolveWorld = { ...world, programHours };
    const r = solveMax(w, product, s);
    if ('error' in r) continue;
    const eco = economics(r, market, programHours);
    if (best === null || eco.netPerWeek > best.economics.netPerWeek) best = { result: r, economics: eco, programHours };
  }
  return best ?? { error: `qol-infeasible: ${product} cannot be produced at any cadence in this world` };
}
