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
 * The ranking pass mirrors compare mode: greedy solves with the honest
 * upper-bound certificate, sourcing overrides applied per candidate, the
 * same second-chance intermediate-buy cut. One solve per system keeps a
 * 100-system region interactive.
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

function worldFor(system: ScoutSystemInfo, operation: SolveWorld['operation'], programHours: number): SolveWorld {
  return {
    operation,
    planets: system.planets.map((p) => ({
      name: p.name,
      type: p.type,
      resources: Object.fromEntries(resourcesOf(p.type).map((p0) => [p0, system.assumedW])),
    })),
    programHours,
  };
}

/**
 * Score every system for the goal. Never throws for a bad system — a system
 * where nothing fits ranks last with its reason in `note`. Throws only on an
 * unusable goal (no product for a product goal), which is a caller bug.
 */
export function scoutSystems(
  systems: ReadonlyArray<ScoutSystemInfo>,
  operation: SolveWorld['operation'],
  programHours: number,
  market: MarketContext,
  goal: ScoutGoal,
): ScoutRow[] {
  const overrides = goal.overrides ?? {};
  const mixActive = (goal.mix?.length ?? 0) >= 2 && goal.mode !== 'compare' && goal.mode !== 'profit';
  if (!mixActive && goal.mode !== 'compare' && goal.mode !== 'profit' && (goal.product === undefined || goal.product === ''))
    throw new Error(`scout-goal-invalid: mode "${goal.mode}" needs a product`);

  const rows: ScoutRow[] = [];
  for (const system of systems) {
    if (system.planets.length === 0) {
      rows.push({ system, feasible: false, netPerWeek: 0, outputPerWeek: 0, product: '', note: 'no planets in this system' });
      continue;
    }
    const world = worldFor(system, operation, programHours);
    try {
      if (mixActive) {
        // Blend: default sourcing per line from THIS system's ground, user
        // pins applied on top (never overruled).
        const entries: MixEntry[] = goal.mix!.map((m) => {
          const { ranked } = comparative(world, market, [m.product], overrides);
          const sourcing = ranked[0]?.result.sourcing;
          if (sourcing === undefined) throw new Error(`mix-line-unfit: ${m.product} cannot be made here`);
          return { product: m.product, share: m.pct, sourcing };
        });
        const r = solveMixMax(world, entries);
        if ('error' in r) {
          rows.push({ system, feasible: false, netPerWeek: 0, outputPerWeek: 0, product: '', note: r.error });
          continue;
        }
        let net = 0;
        for (const line of r.lines) net += economics(line.result, market, programHours).netPerWeek;
        rows.push({
          system, feasible: true, netPerWeek: net, outputPerWeek: r.bundlePerWeek,
          product: goal.mix!.map((m) => m.product).join(' + '),
          note: `blend of ${r.lines.length} products`,
        });
        continue;
      }
      const candidates = goal.mode === 'compare' || goal.mode === 'profit' ? undefined : [goal.product!];
      const { ranked, excluded } = comparative(world, market, candidates, overrides);
      const best = ranked[0];
      if (best === undefined) {
        const reason = excluded[0]?.reason ?? 'nothing can be produced here';
        rows.push({ system, feasible: false, netPerWeek: 0, outputPerWeek: 0, product: goal.product ?? '', note: reason });
        continue;
      }
      if (goal.mode === 'quota' && goal.quotaPerWeek !== undefined && goal.quotaPerWeek > 0) {
        const meets = best.result.realizedPerWeek >= goal.quotaPerWeek;
        rows.push({
          system, feasible: meets, netPerWeek: best.economics.netPerWeek,
          outputPerWeek: best.result.realizedPerWeek, product: best.product,
          note: meets
            ? `meets the ${Math.round(goal.quotaPerWeek).toLocaleString('en-US')}/wk target`
            : `tops out at ${Math.round(best.result.realizedPerWeek).toLocaleString('en-US')}/wk — under target`,
        });
        continue;
      }
      rows.push({
        system, feasible: true, netPerWeek: best.economics.netPerWeek,
        outputPerWeek: best.result.realizedPerWeek, product: best.product,
        note: goal.mode === 'compare' || goal.mode === 'profit'
          ? `best product here: ${best.product}`
          : (goal.mode === 'qol' ? 'ranked by weekly net at your current program length' : 'max output plan'),
      });
    } catch (e) {
      rows.push({ system, feasible: false, netPerWeek: 0, outputPerWeek: 0, product: goal.product ?? '', note: (e as Error).message });
    }
  }
  // Feasible first, then net; infeasible sorted by name so the tail is stable.
  rows.sort((a, b) => Number(b.feasible) - Number(a.feasible)
    || b.netPerWeek - a.netPerWeek
    || a.system.name.localeCompare(b.system.name));
  return rows;
}
