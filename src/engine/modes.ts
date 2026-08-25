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
import type { Sourcing } from './chain.js';
import { p1InputsOf, oreOf } from './chain.js';
import { HOURS_PER_WEEK } from './flow.js';

export interface Quote { readonly bid: number; readonly ask: number }
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

function sellPrice(m: MarketContext, commodity: string): number {
  const q = m.prices[commodity];
  if (q === undefined) throw new Error(`missing-price: ${commodity} — refusing to value it silently`);
  return m.sellBasis === 'immediate' ? q.bid : q.ask;
}
function buyPrice(m: MarketContext, commodity: string): number {
  const q = m.prices[commodity];
  if (q === undefined) throw new Error(`missing-price: ${commodity} — refusing to cost it silently`);
  return m.buyBasis === 'immediate' ? q.ask : q.bid;
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

  // Aggregate colony boundary flows (per hour).
  const exportsPerHour = new Map<string, number>();
  const importsPerHour = new Map<string, number>();
  for (const colony of result.plan.colonies) {
    const flow = steadyState(colony.plan);
    for (const [name, f] of flow.perHour) {
      if (f.net > 1e-9) exportsPerHour.set(name, (exportsPerHour.get(name) ?? 0) + f.net);
    }
    for (const imp of colony.plan.imports) {
      importsPerHour.set(imp.commodity, (importsPerHour.get(imp.commodity) ?? 0) + imp.qtyPerHour);
    }
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

  // Ledger lines.
  const sales = [...soldPerWeek].map(([commodity, q]) => ({
    commodity, qty: qty(q), unitPrice: iskPerQty(sellPrice(market, commodity)), basis: market.sellBasis,
  }));
  const purchases = [...purchasedPerWeek].map(([commodity, q]) => ({
    commodity, qty: qty(q), unitPrice: iskPerQty(buyPrice(market, commodity)), basis: market.buyBasis,
  }));
  const customs = [
    ...[...exportsPerHour].filter(([n]) => tierOf(n) !== 0).map(([commodity, perHour]) => ({
      label: `export ${commodity}`, tier: tierOf(commodity), qty: qty(perHour * HOURS_PER_WEEK),
      direction: 'export' as const, ctx: market.customs,
    })),
    ...[...importsPerHour].map(([commodity, perHour]) => ({
      label: `import ${commodity}`, tier: tierOf(commodity), qty: qty(perHour * HOURS_PER_WEEK),
      direction: 'import' as const, ctx: market.customs,
    })),
  ];
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
 */
export function comparative(
  world: SolveWorld,
  market: MarketContext,
  candidates: ReadonlyArray<string> = allProducts(),
): { ranked: RankedOption[]; excluded: Array<{ product: string; reason: string }> } {
  const ranked: RankedOption[] = [];
  const excluded: Array<{ product: string; reason: string }> = [];
  for (const product of candidates) {
    try {
      const sourcing = defaultSourcing(world, product);
      const result = solveMax(world, product, sourcing);
      if ('error' in result) { excluded.push({ product, reason: result.error }); continue; }
      const eco = economics(result, market, world.programHours);
      ranked.push({ product, result, economics: eco });
    } catch (e) {
      excluded.push({ product, reason: (e as Error).message });
    }
  }
  ranked.sort((a, b) => b.economics.netPerWeek - a.economics.netPerWeek);
  return { ranked, excluded };
}

/** Forward mode: the single best option. */
export function maxProfit(
  world: SolveWorld,
  market: MarketContext,
  candidates?: ReadonlyArray<string>,
): { best: RankedOption; ranked: RankedOption[]; excluded: Array<{ product: string; reason: string }> } | { error: string } {
  const { ranked, excluded } = comparative(world, market, candidates ?? allProducts());
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
  const candidates = [6, 12, 24, 48, 96, 168, 336].filter((h) => HOURS_PER_WEEK / h <= maxSessionsPerWeek + 1e-9);
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
