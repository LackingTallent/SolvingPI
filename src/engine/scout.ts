/**
 * REGION SCOUT — rank the systems of a region for the user's goal.
 *
 * Owner spec 2026-08-31: pick a region in space; the tool says which systems
 * suit the chosen goal best. The hard truth shaping this module: resource
 * DENSITIES exist nowhere outside the in-game scan view — no API publishes
 * them. What IS knowable remotely is each system's planet TYPES and security
 * status. So the scout builds a phantom world per system — the user's REAL
 * characters, the system's REAL planet types, densities ASSUMED at the
 * security band's typical value (the same Quick-estimate model, same
 * disclosure) — and runs the real solver on it. Every number it produces is
 * an estimate by construction and must be labeled as one by the caller.
 *
 * The ranking pass mirrors compare mode — greedy solves with the honest
 * upper-bound certificate, sourcing overrides applied per candidate — with
 * one deliberate difference (ranking-truth fix 2026-09-03): the scout ranks
 * what each system's own GROUND enables, so the buy-everything assembly cut
 * is disabled and plans that extract nothing locally do not score. Without
 * that, every system with one Barren planet tied at the same pure-assembly
 * number and the "ranking" collapsed to alphabetical tie order.
 */
import { resourcesOf } from '../world/planets.js';
import type { SolveWorld } from './allocator.js';
import { comparative, type MarketContext } from './modes.js';
import { solveMixMax, type MixEntry } from './mix.js';
import { economics } from './modes.js';
import type { PlanetType } from '../spec/schematics.js';
import type { Sourcing } from './chain.js';

export interface ScoutPlanet {
  readonly name: string;
  readonly type: PlanetType;
}

export interface ScoutSystemInfo {
  readonly id: number;
  readonly name: string;
  /** ESI security_status (wormhole systems ~ -0.99; band decided by caller). */
  readonly security: number;
  readonly planets: ReadonlyArray<ScoutPlanet>;
  /** Assumed qty_per_cycle for every resource here (band typical — caller
   * converts its band model once, so this module stays band-agnostic). */
  readonly assumedW: number;
}

export interface ScoutGoal {
  readonly mode: 'max' | 'quota' | 'qol' | 'compare' | 'profit';
  /** Required for max/quota/qol unless a mix is given. */
  readonly product?: string;
  readonly quotaPerWeek?: number;
  /** Blend entries (≥2 activates mix scoring in max/quota/qol). */
  readonly mix?: ReadonlyArray<{ readonly product: string; readonly pct: number }>;
  readonly overrides?: Readonly<Record<string, Sourcing>>;
}

export interface ScoutRow {
  readonly system: ScoutSystemInfo;
  /** true when the goal is met in this system (quota met, or any plan found). */
  readonly feasible: boolean;
  /** Ranking metric: estimated net ISK/week of the best plan found. */
  readonly netPerWeek: number;
  readonly outputPerWeek: number;
  /** Fractional upper bound of the winning plan — the tie-breaking
   * "headroom" metric: more/better ground raises it even when the built
   * plan is roster-limited (ranking-truth fix 2026-09-03). */
  readonly headroomPerWeek: number;
  /** The product the estimate is for (compare/profit pick their own). */
  readonly product: string;
  /** Plain-words note: what was solved, or why nothing fits. */
  readonly note: string;
}

/** Planet-type counts of a system, for the row summary. */
export function planetTypeCounts(planets: ReadonlyArray<ScoutPlanet>): ReadonlyArray<[PlanetType, number]> {
  const m = new Map<PlanetType, number>();
  for (const p of planets) m.set(p.type, (m.get(p.type) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function worldFor(system: ScoutSystemInfo, operation: SolveWorld['operation'], programHours: number, stackingPenalty: number): SolveWorld {
  return {
    operation,
    planets: system.planets.map((p) => ({
      name: p.name,
      type: p.type,
      resources: Object.fromEntries(resourcesOf(p.type).map((p0) => [p0, system.assumedW])),
    })),
    programHours,
    stackingPenalty,
  };
}

/**
 * Score every system for the goal. Never throws for a bad system — a system
 * where nothing fits ranks last with its reason in `note`. Throws only on an
 * unusable goal (no product for a product goal), which is a caller bug.
 */
export function scoutSystem(
  system: ScoutSystemInfo,
  operation: SolveWorld['operation'],
  programHours: number,
  market: MarketContext,
  goal: ScoutGoal,
  stackingPenalty = 0,
): ScoutRow {
  const overrides = goal.overrides ?? {};
  const mixActive = (goal.mix?.length ?? 0) >= 2 && goal.mode !== 'compare' && goal.mode !== 'profit';
  if (!mixActive && goal.mode !== 'compare' && goal.mode !== 'profit' && (goal.product === undefined || goal.product === ''))
    throw new Error(`scout-goal-invalid: mode "${goal.mode}" needs a product`);
  if (system.planets.length === 0) {
    return { system, feasible: false, netPerWeek: 0, outputPerWeek: 0, headroomPerWeek: 0, product: '', note: 'no planets in this system' };
  }
  const world = worldFor(system, operation, programHours, stackingPenalty);
  try {
    if (mixActive) {
      // Blend: default sourcing per line from THIS system's ground, user
      // pins applied on top (never overruled).
      const entries: MixEntry[] = goal.mix!.map((m) => {
        const { ranked } = comparative(world, market, [m.product], overrides, { secondChance: false, keepGround: true, sweepTop: 5 });
        const sourcing = ranked[0]?.result.sourcing;
        if (sourcing === undefined) throw new Error(`mix-line-unfit: ${m.product} cannot be made here`);
        return { product: m.product, share: m.pct, sourcing };
      });
      const r = solveMixMax(world, entries);
      if ('error' in r) {
        return { system, feasible: false, netPerWeek: 0, outputPerWeek: 0, headroomPerWeek: 0, product: '', note: r.error };
      }
      let net = 0;
      for (const line of r.lines) net += economics(line.result, market, programHours).netPerWeek;
      return {
        system, feasible: true, netPerWeek: net, outputPerWeek: r.bundlePerWeek,
        headroomPerWeek: r.lines.reduce((a, l) => a + l.result.upperBoundPerWeek, 0),
        product: goal.mix!.map((m) => m.product).join(' + '),
        note: `blend of ${r.lines.length} products`,
      };
    }
    const candidates = goal.mode === 'compare' || goal.mode === 'profit' ? undefined : [goal.product!];
    // Ranking-truth fix 2026-09-03: no second-chance buy cut, and plans that
    // extract NOTHING from this system's ground do not score (keepGround) —
    // otherwise a pure bought-input assembly plan gives every system with one
    // usable factory planet the identical net and the ranking degenerates to
    // alphabetical tie order. Round-4: the economic posture/sweep runs here
    // too (bounded to the top 5), so a system is scored at the best net its
    // GROUND actually enables — not at whatever the availability heuristic
    // happened to pick (that broke dominance: a strictly better system could
    // rank below a worse one).
    const { ranked, excluded } = comparative(world, market, candidates, overrides, { secondChance: false, keepGround: true, sweepTop: 5 });
    const best = ranked.find((r) => Object.keys(r.result.builtExtractP1).length > 0);
    if (best === undefined) {
      const reason = ranked.length > 0
        ? 'ground unused — anything makeable here would be pure bought-input assembly'
        : (excluded[0]?.reason ?? 'nothing can be produced here');
      return { system, feasible: false, netPerWeek: 0, outputPerWeek: 0, headroomPerWeek: 0, product: goal.product ?? '', note: reason };
    }
    if (goal.mode === 'quota' && goal.quotaPerWeek !== undefined && goal.quotaPerWeek > 0) {
      const meets = best.result.realizedPerWeek >= goal.quotaPerWeek;
      return {
        system, feasible: meets, netPerWeek: best.economics.netPerWeek,
        outputPerWeek: best.result.realizedPerWeek,
        headroomPerWeek: best.result.upperBoundPerWeek,
        product: best.product,
        note: meets
          ? `meets the ${Math.round(goal.quotaPerWeek).toLocaleString('en-US')}/wk target`
          : `tops out at ${Math.round(best.result.realizedPerWeek).toLocaleString('en-US')}/wk — under target`,
      };
    }
    return {
      system, feasible: true, netPerWeek: best.economics.netPerWeek,
      outputPerWeek: best.result.realizedPerWeek,
      headroomPerWeek: best.result.upperBoundPerWeek,
      product: best.product,
      note: goal.mode === 'compare' || goal.mode === 'profit'
        ? `best product here: ${best.product}`
        : (goal.mode === 'qol' ? 'ranked by weekly net at your current program length' : 'max output plan'),
    };
  } catch (e) {
    return { system, feasible: false, netPerWeek: 0, outputPerWeek: 0, headroomPerWeek: 0, product: goal.product ?? '', note: (e as Error).message };
  }
}

/** Sort: feasible, then net, then HEADROOM (more/better ground), then planet
 * count — name is the last resort only, so equal-composition systems (which
 * genuinely tie under band-typical densities) stay adjacent but real ground
 * differences always outrank the alphabet. */
export function sortScoutRows(rows: ScoutRow[]): ScoutRow[] {
  rows.sort((a, b) => Number(b.feasible) - Number(a.feasible)
    || b.netPerWeek - a.netPerWeek
    || b.headroomPerWeek - a.headroomPerWeek
    || b.system.planets.length - a.system.planets.length
    || a.system.name.localeCompare(b.system.name));
  return rows;
}

export function scoutSystems(
  systems: ReadonlyArray<ScoutSystemInfo>,
  operation: SolveWorld['operation'],
  programHours: number,
  market: MarketContext,
  goal: ScoutGoal,
  stackingPenalty = 0,
): ScoutRow[] {
  return sortScoutRows(systems.map((s) => scoutSystem(s, operation, programHours, market, goal, stackingPenalty)));
}
