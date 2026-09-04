/**
 * The analytics layer. Every insight here derives from a principle in
 * docs/library/20-economics-principles.md, is computed through the SAME
 * solver/ledger as the plans themselves (no side arithmetic), and cites its
 * inputs. No unexplained numbers; missing data is reported BY NAME.
 *
 * Principle map:
 *   marginal*        — #2 marginal analysis, not averages
 *   buyVsMake        — #8 make-or-buy is a price comparison
 *   patiencePremium  — #4 prices are realized, not quoted
 *   saturation       — #11 markets clear: your own volume moves the price
 *   rawP1Baseline    — #1 opportunity cost (the sell-raw baseline)
 *   cadenceInsights  — #6 time is the binding constraint
 *   bottleneck/runway— #7 throughput is governed by the bottleneck; buffers
 *                      are runway, not throughput
 *   optimality       — honesty about the solver itself (measured, not vibes)
 */
import { chainNeeds, type Sourcing } from './chain.js';
import { steadyState, runwayHours, HOURS_PER_WEEK } from './flow.js';
import { economics, type MarketContext } from './modes.js';
import { solveMax, ADV_PER_COLONY, HT_PER_COLONY, REFINERY_BASICS, P1_PER_BASIC_PER_WEEK, type SolveResult, type SolveWorld } from './allocator.js';
import { FACILITY } from '../spec/constants.js';
import { P1_FROM_P0 } from '../spec/schematics.js';
import { character } from '../world/characters.js';

export interface Insight {
  readonly id: string;
  readonly title: string;
  /** null = not computable from available data (detail names what is missing). */
  readonly value: number | null;
  readonly unit: string;
  readonly detail: string;
  /** What this number was computed from — the citation trail. */
  readonly inputs: ReadonlyArray<string>;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------
// Solver honesty
// ---------------------------------------------------------------------------

export function optimalityInsight(result: SolveResult): Insight {
  const ratio = result.upperBoundPerWeek > 0 ? result.realizedPerWeek / result.upperBoundPerWeek : 1;
  return {
    id: 'optimality',
    title: 'How good is this answer?',
    value: ratio,
    unit: 'fraction of the relaxation bound',
    detail: result.method === 'exhaustive'
      ? `Exhaustive search over colony-mix COUNTS (placement stays heuristic — not a full proof of optimality). Realized ${fmt(result.realizedPerWeek)}/wk vs relaxation bound ${fmt(result.upperBoundPerWeek)}/wk (${(ratio * 100).toFixed(1)}%; the bound itself is loose, so the true gap is smaller than it looks).`
      : `Greedy allocation, certified within ${((1 - ratio) * 100).toFixed(1)}% of the fractional upper bound ${fmt(result.upperBoundPerWeek)}/wk — a per-run measurement, not a projection.`,
    inputs: [`solver method: ${result.method}`, 'fractional relaxation upper bound'],
  };
}

// ---------------------------------------------------------------------------
// Bottleneck + slack (principle #7)
// ---------------------------------------------------------------------------

export function bottleneckReport(result: SolveResult): Insight[] {
  const unit = chainNeeds(result.product, 1, result.sourcing);
  const advColonies = result.plan.colonies.filter((c) => c.layout.advanced > 0).length;
  const htColonies = result.plan.colonies.filter((c) => c.layout.hightech > 0).length;
  const refineryColonies = new Map<string, number>();
  for (const c of result.plan.colonies) {
    if (c.layout.ecus === 0 && c.layout.basic > 0) {
      const p1 = c.plan.factories[0]?.schematic ?? '?';
      refineryColonies.set(p1, (refineryColonies.get(p1) ?? 0) + 1);
    }
  }
  const constraints: Array<{ name: string; maxRate: number }> = [];
  for (const [p1, perUnit] of Object.entries(unit.extractP1PerWeek)) {
    constraints.push({ name: `extraction of ${p1}`, maxRate: (result.builtExtractP1[p1] ?? 0) / perUnit });
  }
  for (const [p1, perUnit] of Object.entries(unit.refineP1PerWeek)) {
    constraints.push({ name: `refining of ${p1}`, maxRate: ((refineryColonies.get(p1) ?? 0) * REFINERY_BASICS * P1_PER_BASIC_PER_WEEK) / perUnit });
  }
  if (unit.advancedFacilities > 0) constraints.push({ name: 'advanced factory capacity', maxRate: (advColonies * ADV_PER_COLONY) / unit.advancedFacilities });
  if (unit.htFacilities > 0) constraints.push({ name: 'high-tech plant capacity', maxRate: (htColonies * HT_PER_COLONY) / unit.htFacilities });

  const binding = constraints.reduce((a, b) => (b.maxRate < a.maxRate ? b : a), constraints[0]!);
  return constraints.map((c) => ({
    id: c === binding ? 'bottleneck' : `slack:${c.name}`,
    title: c === binding ? `Bottleneck: ${c.name}` : `Slack: ${c.name}`,
    value: c.maxRate > 0 ? result.realizedPerWeek / c.maxRate : 0,
    unit: 'utilization',
    detail: c === binding
      ? `${c.name} caps the whole chain at ${fmt(c.maxRate)}/wk — every other stage waits on it. Add capacity HERE first.`
      : `${c.name} could sustain ${fmt(c.maxRate)}/wk; it runs at ${((result.realizedPerWeek / c.maxRate) * 100).toFixed(0)}%. Extra capacity here is waste until the bottleneck moves.`,
    inputs: ['built colony capacities', `chain ratios for ${result.product}`],
  }));
}

// ---------------------------------------------------------------------------
// Runway (QOL, principle #7's buffer half)
// ---------------------------------------------------------------------------

export function runwayInsight(result: SolveResult): Insight {
  let minRunway = Infinity;
  let where = '';
  for (const c of result.plan.colonies) {
    const capacity =
      c.layout.launchpads * (FACILITY.launchpad.capacityM3 ?? 0) +
      c.layout.storage * (FACILITY.storage.capacityM3 ?? 0) +
      (FACILITY.commandCenter.capacityM3 ?? 0);
    const r = runwayHours(steadyState(c.plan), capacity);
    if (r < minRunway) { minRunway = r; where = `${c.planetName} (${c.characterName})`; }
  }
  return {
    id: 'runway',
    title: 'Unattended runway',
    value: Number.isFinite(minRunway) ? minRunway : null,
    unit: 'hours',
    detail: Number.isFinite(minRunway)
      ? `First storage overflow after ~${minRunway.toFixed(1)}h at ${where}. Buffers set visit cadence, never throughput — visit before this or lose output.`
      : 'Nothing accumulates: no storage pressure at steady state.',
    inputs: ['per-colony steady-state surplus', 'launchpad/storage capacities'],
  };
}

// ---------------------------------------------------------------------------
// Realized-price analytics (principle #4)
// ---------------------------------------------------------------------------

export function patiencePremium(result: SolveResult, market: MarketContext, programHours = 6): Insight {
  const imm = economics(result, { ...market, sellBasis: 'immediate' }, programHours).netPerWeek;
  const pat = economics(result, { ...market, sellBasis: 'patient' }, programHours).netPerWeek;
  return {
    id: 'patience-premium',
    title: 'Patience premium (list vs instant-sell)',
    value: pat - imm,
    unit: 'ISK/week',
    detail: pat > imm
      ? `Listing sell orders instead of hitting buy orders is worth ${fmt(pat - imm)} ISK/wk after broker fees — if your orders fill.`
      : `At current spreads, instant-selling nets ${fmt(imm - pat)} ISK/wk MORE than listing — the spread does not cover the broker fee.`,
    inputs: ['bid/ask quotes for every sold commodity', 'broker + sales tax rates'],
  };
}

export function saturationInsights(result: SolveResult, market: MarketContext, programHours = 6): Insight[] {
  const eco = economics(result, market, programHours);
  return eco.sold.map(({ commodity, qtyPerWeek }) => {
    const vol = market.prices[commodity]?.dailyVolume;
    if (vol === undefined || vol <= 0) {
      return {
        id: `saturation:${commodity}`,
        title: `Market saturation: ${commodity}`,
        value: null,
        unit: 'share of daily volume',
        detail: `unavailable: no dailyVolume in the ${commodity} quote — supply market history to compute this.`,
        inputs: [`${commodity} quote (no volume field)`],
      };
    }
    const share = qtyPerWeek / 7 / vol;
    return {
      id: `saturation:${commodity}`,
      title: `Market saturation: ${commodity}`,
      value: share,
      unit: 'share of daily volume',
      // Threshold per docs/library/13-market-mechanics.md: price impact starts
      // at 2-5% of daily volume, not 10% (truth audit 2026-09-03).
      // T-18: the volume figure is venue-corrected at fetch time (regional
      // history scaled by the trade hub's share of the standing book), so
      // the share compares like with like — say "your trade hub", not
      // "regional".
      detail: share > 0.03
        ? `You would supply ${(share * 100).toFixed(1)}% of your trade hub's estimated daily volume (${fmt(qtyPerWeek / 7)}/day vs ~${fmt(vol)}/day traded). Expect to move the price — diversify or sell patiently.`
        : `${(share * 100).toFixed(1)}% of your trade hub's estimated daily volume — the market absorbs you without noticing.`,
      inputs: [`${commodity} hub daily volume ~${fmt(vol)}`, 'planned weekly sales'],
    };
  });
}

// ---------------------------------------------------------------------------
// Make-or-buy per input (principle #8) — re-solved, never estimated
// ---------------------------------------------------------------------------

export interface SourcingComparison {
  readonly p1: string;
  readonly options: Array<{ mode: Sourcing; netPerWeek: number | null; reason?: string }>;
  readonly best: Sourcing;
  readonly insight: Insight;
}

export function buyVsMake(
  world: SolveWorld,
  result: SolveResult,
  market: MarketContext,
): SourcingComparison[] {
  const out: SourcingComparison[] = [];
  for (const p1 of Object.keys(result.sourcing)) {
    const options: SourcingComparison['options'] = [];
    for (const mode of ['extract', 'refine', 'buy'] as const) {
      if (p1 === result.product && mode === 'buy') continue; // buying the product is not production
      const sourcing = { ...result.sourcing, [p1]: mode };
      try {
        const r = solveMax(world, result.product, sourcing);
        if ('error' in r) { options.push({ mode, netPerWeek: null, reason: r.error }); continue; }
        options.push({ mode, netPerWeek: economics(r, market, world.programHours).netPerWeek });
      } catch (e) {
        options.push({ mode, netPerWeek: null, reason: (e as Error).message });
      }
    }
    const viable = options.filter((o) => o.netPerWeek !== null) as Array<{ mode: Sourcing; netPerWeek: number }>;
    if (viable.length === 0) continue;
    const best = viable.reduce((a, b) => (b.netPerWeek > a.netPerWeek ? b : a));
    const current = options.find((o) => o.mode === result.sourcing[p1]);
    const delta = current?.netPerWeek != null ? best.netPerWeek - current.netPerWeek : null;
    out.push({
      p1,
      options,
      best: best.mode,
      insight: {
        id: `buy-vs-make:${p1}`,
        title: `Sourcing ${p1}: ${best.mode} wins`,
        value: delta,
        unit: 'ISK/week left on the table',
        detail: options.map((o) => o.netPerWeek !== null
          ? `${o.mode}: ${fmt(o.netPerWeek)} ISK/wk`
          : `${o.mode}: not viable (${o.reason})`).join(' · ') +
          (delta !== null && delta > 0 ? ` — switching from ${result.sourcing[p1]} to ${best.mode} is worth ${fmt(delta)} ISK/wk.` : ' — current choice is already best.'),
        inputs: ['full re-solve per sourcing mode', 'realized prices incl. customs (150:1 ore premium) and freight'],
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Marginal analytics (principle #2) — re-solved with one more unit
// ---------------------------------------------------------------------------

export function marginalCharacter(world: SolveWorld, result: SolveResult, market: MarketContext): Insight {
  const base = economics(result, market, world.programHours).netPerWeek;
  if (world.operation.characters.length >= 50) {
    return {
      id: 'marginal-character', title: 'Value of the next character', value: null, unit: 'ISK/week',
      detail: 'unavailable: already at the supported maximum of 50 characters.',
      inputs: ['operation size'],
    };
  }
  const template = world.operation.characters[0]!;
  const bigger: SolveWorld = {
    ...world,
    operation: { characters: [...world.operation.characters, character({ ...template, name: '__marginal__' })] },
  };
  const r = solveMax(bigger, result.product, result.sourcing);
  const value = 'error' in r ? null : economics(r, market, world.programHours).netPerWeek - base;
  return {
    id: 'marginal-character',
    title: 'Value of the next character',
    value,
    unit: 'ISK/week',
    detail: value === null
      ? `could not re-solve with an added character (${(r as { error: string }).error})`
      : `A new character with your first character's skills adds ${fmt(value)} ISK/wk (slots AND an extra colony allowance on every planet).`,
    inputs: ['full re-solve with one added character', `template: ${template.name}`],
  };
}

export function marginalTraining(world: SolveWorld, result: SolveResult, market: MarketContext): Insight {
  const base = economics(result, market, world.programHours).netPerWeek;
  const idx = world.operation.characters.findIndex((c) => c.icLevel < 5);
  if (idx === -1) {
    return {
      id: 'marginal-training', title: 'Value of training Interplanetary Consolidation', value: null, unit: 'ISK/week',
      detail: 'Every character already has Interplanetary Consolidation V — no planet slots left to train.',
      inputs: ['operation skills'],
    };
  }
  const chars = world.operation.characters.map((c, i) => (i === idx ? character({ ...c, icLevel: c.icLevel + 1 }) : c));
  const r = solveMax({ ...world, operation: { characters: chars } }, result.product, result.sourcing);
  const value = 'error' in r ? null : economics(r, market, world.programHours).netPerWeek - base;
  const who = world.operation.characters[idx]!;
  return {
    id: 'marginal-training',
    title: 'Value of training Interplanetary Consolidation',
    value,
    unit: 'ISK/week',
    detail: value === null
      ? `could not re-solve with the extra planet slot`
      : `Training ${who.name} from IC ${who.icLevel} to ${who.icLevel + 1} (one more planet) adds ${fmt(value)} ISK/wk.`,
    inputs: ['full re-solve with +1 IC level', `character: ${who.name}`],
  };
}

// ---------------------------------------------------------------------------
// Cadence curve in ISK (principle #6)
// ---------------------------------------------------------------------------

export function cadenceInsights(
  world: SolveWorld,
  product: string,
  sourcing: Readonly<Record<string, Sourcing>>,
  market: MarketContext,
  candidates: ReadonlyArray<number> = [6, 24, 48, 96, 168, 336],
): Array<{ programHours: number; netPerWeek: number | null; netPerSession: number | null; sessionsPerWeek: number }> {
  return candidates.map((programHours) => {
    const r = solveMax({ ...world, programHours }, product, sourcing);
    if ('error' in r) return { programHours, netPerWeek: null, netPerSession: null, sessionsPerWeek: HOURS_PER_WEEK / programHours };
    const eco = economics(r, market, programHours);
    return { programHours, netPerWeek: eco.netPerWeek, netPerSession: eco.netPerSession, sessionsPerWeek: eco.sessionsPerWeek };
  });
}

// ---------------------------------------------------------------------------
// The sell-raw baseline (principle #1)
// ---------------------------------------------------------------------------

export function rawP1Baseline(world: SolveWorld, result: SolveResult, market: MarketContext): Insight {
  const current = economics(result, market, world.programHours).netPerWeek;
  let best: { p1: string; net: number } | null = null;
  const available = new Set<string>();
  for (const p of world.planets) for (const p0 of Object.keys(p.resources)) available.add(P1_FROM_P0[p0]!);
  for (const p1 of available) {
    if (market.prices[p1] === undefined) continue; // unpriced P1s can't form the baseline
    const r = solveMax(world, p1, { [p1]: 'extract' });
    if ('error' in r) continue;
    try {
      const net = economics(r, market, world.programHours).netPerWeek;
      if (best === null || net > best.net) best = { p1, net };
    } catch { /* missing surplus price — skip */ }
  }
  if (best === null) {
    return {
      id: 'baseline-raw-p1', title: 'Baseline: just sell raw P1', value: null, unit: 'ISK/week',
      detail: 'unavailable: no priced P1 the world can extract — supply P1 quotes to compute the baseline.',
      inputs: ['world resources', 'price set'],
    };
  }
  const chosen: { p1: string; net: number } = best;
  const edge = current - chosen.net;
  return {
    id: 'baseline-raw-p1',
    title: 'Baseline: just sell raw P1',
    value: edge,
    unit: 'ISK/week vs baseline',
    detail: edge >= 0
      ? `Your ${result.product} plan beats the best dumb strategy (all slots on ${chosen.p1}, ${fmt(chosen.net)} ISK/wk) by ${fmt(edge)} ISK/wk. The extra tiers earn their taxes.`
      : `WARNING: all slots extracting ${chosen.p1} would net ${fmt(chosen.net)} ISK/wk — ${fmt(-edge)} MORE than this plan. The chain's transaction costs exceed its value-added at current prices.`,
    inputs: [`best single-P1 alternative: ${chosen.p1}`, 'same world, same cadence, same fees'],
  };
}

// ---------------------------------------------------------------------------
// The full report
// ---------------------------------------------------------------------------

export interface AnalyticsReport {
  readonly insights: ReadonlyArray<Insight>;
  readonly sourcing: ReadonlyArray<SourcingComparison>;
  readonly cadence: ReturnType<typeof cadenceInsights>;
}

export function analyze(world: SolveWorld, result: SolveResult, market: MarketContext): AnalyticsReport {
  const insights: Insight[] = [
    optimalityInsight(result),
    ...bottleneckReport(result),
    runwayInsight(result),
    patiencePremium(result, market, world.programHours),
    ...saturationInsights(result, market, world.programHours),
    marginalCharacter(world, result, market),
    marginalTraining(world, result, market),
    rawP1Baseline(world, result, market),
  ];
  const sourcing = buyVsMake(world, result, market);
  for (const s of sourcing) insights.push(s.insight);
  return { insights, sourcing, cadence: cadenceInsights(world, result.product, result.sourcing, market) };
}
