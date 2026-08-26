/**
 * Sourcing suggestion — the tool picks the sourcing plan FROM the goal,
 * instead of demanding the user type one in. Two layers, both disclosed:
 *
 *  1. Heuristic (always available, no prices needed): extract an input when
 *     its ore is scanned somewhere in the user's systems, buy it otherwise;
 *     a P1 *product* with no ore falls back to refine (buying the product is
 *     not production). This is defaultSourcing()'s rule, restated per input
 *     with a named reason.
 *
 *  2. Price refinement (runs only when the market can price the alternatives):
 *     a single deterministic coordinate pass over the inputs — for each, all
 *     three modes are FULLY RE-SOLVED and settled through the one ledger, and
 *     the best net wins, with the ISK/week delta named. This is the same
 *     machinery as the deep-analytics buy-vs-make table. On worlds large
 *     enough that ~3 solves per input would stall the browser, refinement is
 *     skipped and SAYS SO — deep analytics remains the thorough path.
 *
 * Explicit user overrides are never second-guessed: they are applied last and
 * labeled "your choice".
 */
import { oreOf, type Sourcing } from './chain.js';
import { solveMax, type SolveWorld } from './allocator.js';
import { defaultSourcing, economics, type MarketContext } from './modes.js';

export interface SuggestionNote {
  readonly p1: string;
  readonly mode: Sourcing;
  readonly reason: string;
}

export interface SourcingSuggestion {
  readonly sourcing: Record<string, Sourcing>;
  readonly notes: ReadonlyArray<SuggestionNote>;
  /** true when the price-comparison pass ran (not just the heuristic). */
  readonly refined: boolean;
  /** Why refinement did not run, when it didn't. */
  readonly refinementSkipped?: string;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Above these sizes the ~3-solves-per-input refinement pass could stall an
 * interactive solve; the heuristic answers and deep analytics stays the
 * thorough path. Named so the skip reason can cite them. */
export const REFINE_MAX_PLANETS = 24;
export const REFINE_MAX_INPUTS = 6;

export function suggestSourcing(
  world: SolveWorld,
  product: string,
  market: MarketContext | null,
  overrides: Readonly<Record<string, Sourcing>> = {},
): SourcingSuggestion {
  const sourcing = defaultSourcing(world, product);
  const reasons = new Map<string, string>();
  for (const [p1, mode] of Object.entries(sourcing)) {
    if (mode === 'extract') reasons.set(p1, `you have ${oreOf(p1)} scanned in your systems`);
    else if (mode === 'refine') reasons.set(p1, `no scanned ${oreOf(p1)} — buy the ore and refine it (buying the product itself is not production)`);
    else reasons.set(p1, `no scanned ${oreOf(p1)} in your systems — buy it finished`);
  }

  // Feasibility ladder: when the extract-what-you-have heuristic cannot fit
  // this operation AT ALL (deep chains need many colonies; small operations
  // have few slots), fall back to buying the inputs in — the smallest
  // physical chain — exactly as a real operator would. Disclosed per input.
  {
    const withOverrides = { ...sourcing };
    for (const [p1, mode] of Object.entries(overrides)) if (p1 in withOverrides) withOverrides[p1] = mode;
    const probe = solveMax(world, product, withOverrides, { method: 'greedy' });
    if ('error' in probe) {
      const allBuy: Record<string, Sourcing> = {};
      for (const p1 of Object.keys(sourcing)) {
        allBuy[p1] = p1 === product ? 'refine' : 'buy';
        if (p1 in overrides) allBuy[p1] = overrides[p1]!;
      }
      const probeBuy = solveMax(world, product, allBuy, { method: 'greedy' });
      if (!('error' in probeBuy)) {
        for (const p1 of Object.keys(sourcing)) {
          if (p1 in overrides || allBuy[p1] === sourcing[p1]) continue;
          sourcing[p1] = allBuy[p1]!;
          reasons.set(p1, `the fuller chain does not fit this operation (${probe.error}) — ${allBuy[p1] === 'refine' ? 'buying ore and refining' : 'buying it in'} keeps the plan feasible`);
        }
      }
    }
  }

  const free = Object.keys(sourcing).filter((p1) => !(p1 in overrides)).sort();
  let refined = false;
  let refinementSkipped: string | undefined;

  if (market === null || Object.keys(market.prices).length === 0) {
    refinementSkipped = 'no prices loaded — heuristic only (fetch prices in section 4 for a cost-compared suggestion)';
  } else if (world.planets.length > REFINE_MAX_PLANETS || free.length > REFINE_MAX_INPUTS) {
    refinementSkipped = `world too large for the interactive price comparison (${world.planets.length} planets, ${free.length} inputs) — heuristic used; run Deep analytics for the full buy-vs-make table`;
  } else {
    // Apply overrides BEFORE evaluating, so alternatives are judged in the
    // context the user actually pinned.
    for (const [p1, mode] of Object.entries(overrides)) if (p1 in sourcing) sourcing[p1] = mode;
    for (const p1 of free) {
      let best: { mode: Sourcing; net: number } | null = null;
      for (const mode of ['extract', 'refine', 'buy'] as const) {
        if (p1 === product && mode === 'buy') continue;
        try {
          // Fast solver: this is a ranking pass over alternatives (up to 18
          // solves); the final plan itself is solved with 'auto'.
          const r = solveMax(world, product, { ...sourcing, [p1]: mode }, { method: 'greedy' });
          if ('error' in r) continue;
          const net = economics(r, market, world.programHours).netPerWeek;
          if (best === null || net > best.net) best = { mode, net };
        } catch { /* unpriced or infeasible alternative — not a candidate */ }
      }
      if (best === null) continue; // keep heuristic; nothing priceable
      refined = true;
      if (best.mode !== sourcing[p1]) {
        const prevReason = reasons.get(p1) ?? '';
        reasons.set(p1, `${best.mode} beats ${sourcing[p1]} on settled net (heuristic said ${sourcing[p1]}: ${prevReason})`);
        sourcing[p1] = best.mode;
      } else {
        reasons.set(p1, `${reasons.get(p1) ?? ''} — and it wins the full price comparison (net ${fmt(best.net)} ISK/wk)`);
      }
    }
    if (!refined && refinementSkipped === undefined) {
      refinementSkipped = 'no alternative could be priced — heuristic used';
    }
  }

  for (const [p1, mode] of Object.entries(overrides)) {
    if (p1 in sourcing) { sourcing[p1] = mode; reasons.set(p1, 'your choice (pinned in section 1)'); }
  }

  const notes = Object.keys(sourcing).sort().map((p1) => ({
    p1, mode: sourcing[p1]!, reason: reasons.get(p1) ?? '',
  }));
  const out: SourcingSuggestion = refinementSkipped !== undefined
    ? { sourcing, notes, refined, refinementSkipped }
    : { sourcing, notes, refined };
  return out;
}
