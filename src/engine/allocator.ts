/**
 * The allocator: turns "make product P from this world" into a judged,
 * buildable OperationPlan. HYBRID by design (locked decision):
 *
 *   - small worlds → EXHAUSTIVE search over colony-mix counts: the exact
 *     answer, where v8's greedy left up to 33% on the table
 *   - large worlds → greedy (best planet first, scarcest input first), with a
 *     MEASURED optimality bound from a fractional relaxation — a per-run
 *     certificate, not v8's extrapolated projection
 *
 * Every emitted plan passes through the judge; an illegal plan is returned as
 * an error, never as a result.
 */
import { chainNeeds, P0_PER_P1, type ChainNeeds, type Sourcing } from './chain.js';
import { deal } from './dealer.js';
import { validatePlan, type OperationPlan, type PlannedColony, type Verdict } from './judge.js';
import { P1_FROM_P0, SCHEMATICS, tierOf, type PlanetType } from '../spec/schematics.js';
import { canBuildHighTech, spawnsOn } from '../world/planets.js';
import { fitsCommandCenter, layout, type Layout } from '../world/facilities.js';
import { operation, type Operation } from '../world/characters.js';
import { cycleSecondsForProgram, programCycles, type ExtractionOptions } from '../world/extraction.js';
import { oreOf } from './chain.js';
import { CC_LEVELS, DEFAULT_LINK_KM, FACILITY, TIER_VOLUME_M3 } from '../spec/constants.js';
import { HOURS_PER_WEEK } from './flow.js';

export interface PlanetInfo {
  readonly name: string;
  readonly type: PlanetType;
  /** P0 name -> raw qty_per_cycle (w) at a standard head placement. */
  readonly resources: Readonly<Record<string, number>>;
}

export interface SolveWorld {
  readonly operation: Operation;
  readonly planets: ReadonlyArray<PlanetInfo>;
  readonly programHours: number;
  readonly extraction?: ExtractionOptions;
  /**
   * Contested-deposit haircut (truth audit T-08, owner approved 2026-09-03):
   * each ADDITIONAL colony extracting the same P0 on the same planet yields
   * (1 - penalty) of the previous one. The game has head-overlap and
   * depletion mechanics CCP never published; 0 (the engine default) is the
   * optimistic end. The UI passes its own configurable default.
   */
  readonly stackingPenalty?: number;
}

const WORLD_KEYS = ['operation', 'planets', 'programHours', 'extraction', 'stackingPenalty'] as const;

function stackPenaltyOf(world: SolveWorld): number {
  const v = world.stackingPenalty ?? 0;
  if (!Number.isFinite(v) || v < 0 || v > 0.9) throw new Error(`stackingPenalty must be 0..0.9, got ${v}`);
  return v;
}

export const P0_PER_BASIC_PER_HOUR = 3000 * 2; // 30-min cycles
export const P1_PER_BASIC_PER_WEEK = 20 * 2 * HOURS_PER_WEEK; // 6,720

const links = (n: number) => Array.from({ length: n }, () => ({ lengthKm: DEFAULT_LINK_KM, level: 0 }));

export function minCcLevel(l: Layout): number {
  for (let lvl = 0; lvl < CC_LEVELS.length; lvl++) {
    if (fitsCommandCenter(l, lvl).fits) return lvl;
  }
  throw new Error('layout fits no command center level');
}

function extractionLayout(basics: number): Layout {
  return layout({ ecus: 1, headsPerEcu: [10], basic: basics, advanced: 0, hightech: 0, storage: 0, launchpads: 1, links: links(basics + 2) });
}
/** Largest facility count whose layout fits a maxed CC with DEFAULT_LINK_KM
 * links (truth audit T-06): caps are DERIVED from the fit check, never
 * asserted. At 0-km links the old constants (12/24) sat at 97%+ of CC5's
 * power grid — unbuildable once real link distances are paid for. */
function maxThatFits(build: (n: number) => Layout, hardMax: number): number {
  for (let n = hardMax; n >= 1; n--) {
    if (fitsCommandCenter(build(n), CC_LEVELS.length - 1).fits) return n;
  }
  throw new Error('no facility count fits a maxed command center — link assumption broken');
}
export const MAX_BASICS_PER_EXTRACTION_COLONY = maxThatFits(extractionLayout, 12);
export const REFINERY_BASICS = maxThatFits((n) => layout({ ecus: 0, headsPerEcu: [], basic: n, advanced: 0, hightech: 0, storage: 1, launchpads: 1, links: links(n + 2) }), 8);
export const ADV_PER_COLONY = maxThatFits((n) => layout({ ecus: 0, headsPerEcu: [], basic: 0, advanced: n, hightech: 0, storage: 1, launchpads: 1, links: links(n + 2) }), 24);
export const HT_PER_COLONY = maxThatFits((n) => layout({ ecus: 0, headsPerEcu: [], basic: 0, advanced: 0, hightech: n, storage: 1, launchpads: 1, links: links(n + 2) }), 16);
const REFINERY_LAYOUT: Layout = layout({ ecus: 0, headsPerEcu: [], basic: REFINERY_BASICS, advanced: 0, hightech: 0, storage: 1, launchpads: 1, links: links(REFINERY_BASICS + 2) });
const ADV_LAYOUT: Layout = layout({ ecus: 0, headsPerEcu: [], basic: 0, advanced: ADV_PER_COLONY, hightech: 0, storage: 1, launchpads: 1, links: links(ADV_PER_COLONY + 2) });
const HT_LAYOUT: Layout = layout({ ecus: 0, headsPerEcu: [], basic: 0, advanced: 0, hightech: HT_PER_COLONY, storage: 1, launchpads: 1, links: links(HT_PER_COLONY + 2) });

/** Extraction colony option on one planet: derived basics, weekly P1, layout. */
export interface ExtractionOption {
  readonly planet: PlanetInfo;
  readonly p0: string;
  readonly p1: string;
  readonly w: number;
  readonly basics: number;
  readonly p1PerWeek: number;
}

/**
 * Buffer-aware extraction sizing (truth audit T-07, owner approved
 * 2026-09-03). Extraction is front-loaded — the first cycles of a 336h
 * program run ~6x the average rate — so sizing basics to the AVERAGE and
 * crediting the whole supply overstated long programs: the early burst
 * overflows what the basics + the launchpad buffer can absorb, and the
 * game loses that P0. This simulates the real cycle series (two programs
 * back-to-back, backlog carried, steady state read from the second)
 * against the launchpad's buffer, charges the overflow, and picks the
 * basics count that maximizes DELIVERED P1 — often MORE basics than the
 * old average-rate ceil, sometimes an honest haircut instead.
 */
const extractionCache = new Map<string, { basics: number; p1PerWeek: number }>();
function bufferAwareExtraction(w: number, programHours: number, opts: ExtractionOptions): { basics: number; p1PerWeek: number } {
  const key = `${w}|${programHours}|${opts.truncatePerCycle ?? false}|${opts.cycleSecondsOverride ?? 0}`;
  const hit = extractionCache.get(key);
  if (hit !== undefined) return hit;
  const cycles = programCycles(w, programHours, opts);
  const override = opts.cycleSecondsOverride ?? 0;
  const cycleSeconds = override !== 0 ? override : cycleSecondsForProgram(programHours);
  const cycleHours = cycleSeconds / 3600;
  // The extraction archetype buffers in its single launchpad (no storage).
  const bufferUnits = (FACILITY.launchpad.capacityM3 ?? 10000) / TIER_VOLUME_M3[0]!;
  let best = { basics: 1, p1PerWeek: 0 };
  for (let b = 1; b <= MAX_BASICS_PER_EXTRACTION_COLONY; b++) {
    const absorbPerCycle = b * P0_PER_BASIC_PER_HOUR * cycleHours;
    let backlog = 0;
    let processed = 0;
    for (let pass = 0; pass < 2; pass++) {
      processed = 0;
      for (const yld of cycles) {
        backlog += yld;
        const take = Math.min(backlog, absorbPerCycle);
        processed += take;
        backlog -= take;
        if (backlog > bufferUnits) backlog = bufferUnits; // overflow is LOST
      }
    }
    const effPerHour = processed / programHours;
    const p1 = Math.min(b * P1_PER_BASIC_PER_WEEK, (effPerHour / P0_PER_P1) * HOURS_PER_WEEK);
    if (p1 > best.p1PerWeek + 1e-9) best = { basics: b, p1PerWeek: p1 };
  }
  extractionCache.set(key, best);
  return best;
}

export function extractionOption(planet: PlanetInfo, p0: string, world: SolveWorld): ExtractionOption {
  const w = planet.resources[p0];
  if (w === undefined) throw new Error(`${planet.name} does not carry ${p0}`);
  const { basics, p1PerWeek } = bufferAwareExtraction(w, world.programHours, world.extraction ?? {});
  return { planet, p0, p1: P1_FROM_P0[p0]!, w, basics, p1PerWeek };
}

interface RoleCounts {
  /** extraction colonies per extracted P1 (values are colony counts). */
  readonly extract: Readonly<Record<string, number>>;
  readonly refine: Readonly<Record<string, number>>;
  readonly advanced: number;
  readonly ht: number;
}

/** Per-unit chain needs, computed once per (product, sourcing). */
function unitNeeds(product: string, sourcing: Readonly<Record<string, Sourcing>>): ChainNeeds {
  return chainNeeds(product, 1, sourcing);
}

/** Realized weekly rate a set of built capacities can sustain. */
function realizedRate(
  unit: ChainNeeds,
  builtExtract: Readonly<Record<string, number>>, // P1/week per extracted p1
  refineColonies: Readonly<Record<string, number>>,
  advColonies: number,
  htColonies: number,
): number {
  let x = Infinity;
  for (const [p1, perUnit] of Object.entries(unit.extractP1PerWeek)) {
    x = Math.min(x, (builtExtract[p1] ?? 0) / perUnit);
  }
  for (const [p1, perUnit] of Object.entries(unit.refineP1PerWeek)) {
    x = Math.min(x, ((refineColonies[p1] ?? 0) * REFINERY_BASICS * P1_PER_BASIC_PER_WEEK) / perUnit);
  }
  if (unit.advancedFacilities > 0) x = Math.min(x, (advColonies * ADV_PER_COLONY) / unit.advancedFacilities);
  if (unit.htFacilities > 0) x = Math.min(x, (htColonies * HT_PER_COLONY) / unit.htFacilities);
  return x === Infinity ? 0 : x;
}

export interface SolveResult {
  readonly product: string;
  readonly sourcing: Readonly<Record<string, Sourcing>>;
  readonly realizedPerWeek: number;
  /** Fractional-relaxation upper bound — realized/upperBound certifies quality. */
  readonly upperBoundPerWeek: number;
  readonly method: 'exhaustive' | 'greedy';
  readonly slotsUsed: number;
  readonly plan: OperationPlan;
  readonly verdict: Verdict;
  /** Built weekly P1 by extracted type (for surplus analytics). */
  readonly builtExtractP1: Readonly<Record<string, number>>;
  readonly notes: ReadonlyArray<string>;
}

/** Threshold: estimated exhaustive tuples above this fall back to greedy. */
export const EXHAUSTIVE_TUPLE_LIMIT = 250_000;
/**
 * Exhaustive search is for SMALL worlds (where v8's greedy gap was worst and
 * enumeration is cheap). Above this many slots, per-tuple placement+matching
 * cost makes enumeration wall-clock-hostile even when the tuple count fits —
 * a 25-character world once slipped under the tuple limit and hung CI.
 */
export const EXHAUSTIVE_SLOT_LIMIT = 24;

function checkWorld(world: SolveWorld): void {
  const unknown = Object.keys(world).filter((k) => !(WORLD_KEYS as ReadonlyArray<string>).includes(k));
  if (unknown.length > 0) throw new Error(`solve world: unknown keys: ${unknown.join(', ')}`);
  operation(world.operation.characters); // validates 1..50 etc.
  const names = new Set<string>();
  for (const p of world.planets) {
    if (names.has(p.name)) throw new Error(`duplicate planet name "${p.name}"`);
    names.add(p.name);
    for (const [p0, w] of Object.entries(p.resources)) {
      if (tierOf(p0) !== 0) throw new Error(`${p.name}: "${p0}" is not a P0 resource`);
      if (!Number.isFinite(w) || w <= 0) throw new Error(`${p.name}: w for ${p0} must be > 0, got ${w}`);
      if (!spawnsOn(p0, p.type))
        throw new Error(`${p.name}: ${p0} cannot spawn on a ${p.type} planet — check the scan entry`);
    }
  }
}

const minCcCache = new Map<string, number>();
function minCcOf(l: Layout): number {
  const key = JSON.stringify([l.ecus, l.headsPerEcu, l.basic, l.advanced, l.hightech, l.storage, l.launchpads, l.links.length]);
  let v = minCcCache.get(key);
  if (v === undefined) { v = minCcLevel(l); minCcCache.set(key, v); }
  return v;
}

export interface Placed {
  extractPicks: Array<ExtractionOption>;
  sites: Array<{ planet: PlanetInfo }>;
}

/** Assignables in EXACTLY the draft order buildPlan uses. */
function assignablesFor(counts: RoleCounts, placed: Placed): Array<{ planetName: string; minCcuLevel: number }> {
  const out: Array<{ planetName: string; minCcuLevel: number }> = [];
  for (const pick of placed.extractPicks) out.push({ planetName: pick.planet.name, minCcuLevel: minCcOf(extractionLayout(pick.basics)) });
  let siteIdx = 0;
  for (let i = 0; i < counts.ht; i++) out.push({ planetName: placed.sites[siteIdx++]!.planet.name, minCcuLevel: minCcOf(HT_LAYOUT) });
  for (let i = 0; i < counts.advanced; i++) out.push({ planetName: placed.sites[siteIdx++]!.planet.name, minCcuLevel: minCcOf(ADV_LAYOUT) });
  const refineTotal = Object.values(counts.refine).reduce((a, b) => a + b, 0);
  for (let i = 0; i < refineTotal; i++) out.push({ planetName: placed.sites[siteIdx++]!.planet.name, minCcuLevel: minCcOf(REFINERY_LAYOUT) });
  return out;
}

/**
 * Greedy placement for a role-count vector; returns built capacities and
 * planet usage, or an error string. Scarcest extracted input first (fewest
 * candidate options), best planet first within an input. `spread` mode
 * distributes across distinct planets before stacking — lower yield, but
 * sometimes the only DEALABLE shape (a stacked pair needs two characters
 * free on the same planet).
 */
function place(
  world: SolveWorld,
  counts: RoleCounts,
  spread: boolean,
  reverse = false,
): Placed & { error?: never } | { error: string } {
  const capacity = new Map<string, number>(); // planet -> remaining colonies
  for (const p of world.planets) capacity.set(p.name, world.operation.characters.length);

  const options = new Map<string, ExtractionOption[]>(); // p1 -> sorted options
  for (const [p1] of Object.entries(counts.extract)) {
    const p0 = oreOf(p1);
    const opts = world.planets
      .filter((p) => p.resources[p0] !== undefined)
      .map((p) => extractionOption(p, p0, world))
      .sort((a, b) => b.p1PerWeek - a.p1PerWeek);
    options.set(p1, opts);
  }

  const extractPicks: ExtractionOption[] = [];
  // Tiebreak matches countsFor so sizing and placement walk the same order.
  // The reverse variant flips input priority on contended planets — the
  // fixed order was a search blind spot (truth audit T-12): the same input
  // always claimed a shared best planet, whatever the counts tried.
  const scarcestFirst = Object.entries(counts.extract)
    .sort((a, b) => (options.get(a[0])!.length - options.get(b[0])!.length) || a[0].localeCompare(b[0]));
  if (reverse) scarcestFirst.reverse();
  for (const [p1, n] of scarcestFirst) {
    let placed = 0;
    const opts = options.get(p1)!;
    // Round-robin passes over yield-sorted planets: spread mode takes at most
    // one colony per planet per pass; stacked mode drains each planet fully.
    for (let pass = 0; pass < world.operation.characters.length && placed < n; pass++) {
      for (const opt of opts) {
        if (placed >= n) break;
        const cap = capacity.get(opt.planet.name) ?? 0;
        if (cap <= 0) continue;
        if (spread) {
          extractPicks.push(opt);
          capacity.set(opt.planet.name, cap - 1);
          placed++;
        } else {
          let c = cap;
          while (placed < n && c > 0) {
            extractPicks.push(opt);
            c--;
            placed++;
          }
          capacity.set(opt.planet.name, c);
        }
      }
      if (!spread) break;
    }
    if (placed < n) return { error: `place-extract: only ${placed}/${n} colonies placeable for ${p1}` };
  }

  // Non-extraction sites: HT needs Barren/Temperate; others take any capacity.
  // Spread mode picks the planet with the most remaining capacity.
  const sites: Array<{ planet: PlanetInfo }> = [];
  const takeSite = (pred: (p: PlanetInfo) => boolean): boolean => {
    let chosen: PlanetInfo | null = null;
    let chosenCap = 0;
    for (const p of world.planets) {
      if (!pred(p)) continue;
      const cap = capacity.get(p.name) ?? 0;
      if (cap <= 0) continue;
      if (!spread) { chosen = p; chosenCap = cap; break; }
      if (cap > chosenCap) { chosen = p; chosenCap = cap; }
    }
    if (chosen === null) return false;
    capacity.set(chosen.name, chosenCap - 1);
    sites.push({ planet: chosen });
    return true;
  };
  const refineTotal = Object.values(counts.refine).reduce((a, b) => a + b, 0);
  for (let i = 0; i < counts.ht; i++) {
    if (!takeSite((p) => canBuildHighTech(p.type)))
      return { error: 'place-ht: no Barren/Temperate planet capacity for a high-tech colony' };
  }
  for (let i = 0; i < counts.advanced + refineTotal; i++) {
    if (!takeSite(() => true)) return { error: 'place-factory: no planet capacity left' };
  }
  return { extractPicks, sites };
}

/** Integer facility needs at rate x, per schematic — the ONLY correct way to
 * size factory colonies. Aggregating fractional facility totals undercounts:
 * a P4 chain has ~10 advanced schematics, and the sum of per-schematic ceils
 * exceeds the ceil of the sum by up to (schematics − 1) facilities. Sizing
 * colonies from the aggregate made buildPlan's packing overflow (found by the
 * matrix test: "pack-overflow: 3 Transmitter facilities did not fit"). */
function facilityNeeds(unit: ChainNeeds, x: number): {
  adv: number; ht: number;
  perSchem: Array<{ schematic: string; facilities: number; kind: 'advanced' | 'hightech' }>;
} {
  let adv = 0, ht = 0;
  const perSchem: Array<{ schematic: string; facilities: number; kind: 'advanced' | 'hightech' }> = [];
  for (const [name, qtyPerUnit] of Object.entries(unit.outputsPerWeek)) {
    const s = SCHEMATICS.get(name)!;
    if (s.facility !== 'advanced' && s.facility !== 'hightech') continue;
    const perFac = s.outQty * ((168 * 3600) / s.cycleSeconds);
    const fac = Math.ceil((qtyPerUnit * x) / perFac - 1e-9);
    if (fac <= 0) continue;
    perSchem.push({ schematic: name, facilities: fac, kind: s.facility });
    if (s.facility === 'hightech') ht += fac; else adv += fac;
  }
  return { adv, ht, perSchem };
}

/**
 * Role counts needed to hit rate X (all-ceil), sized against a SHARED planet
 * capacity ledger in the same order place() allocates (scarcest extracted
 * input first, best planet first, per-planet cap = #characters).
 *
 * User-reported defect (2026-09-03): the old sizing priced every P1 against
 * the best planets INDEPENDENTLY, so when two inputs wanted the same planet,
 * placement starved the loser and the binary search declared rates
 * infeasible that a contention-aware sizing reaches — greedy answers
 * bottomed out at ~36% of the fractional bound on multi-input chains.
 * Sizing and placement now walk the same ledger, so what this function
 * says fits is what place() actually builds.
 */
function countsFor(world: SolveWorld, unit: ChainNeeds, x: number): RoleCounts | { error: string } {
  const chars = world.operation.characters.length;
  const capacity = new Map<string, number>();
  for (const p of world.planets) capacity.set(p.name, chars);

  const optionsByP1 = new Map<string, ExtractionOption[]>();
  for (const [p1] of Object.entries(unit.extractP1PerWeek)) {
    const p0 = oreOf(p1);
    const opts = world.planets
      .filter((p) => p.resources[p0] !== undefined)
      .map((p) => extractionOption(p, p0, world))
      .sort((a, b) => b.p1PerWeek - a.p1PerWeek);
    if (opts.length === 0) return { error: `no-planet-for: ${p1} (${p0}) — no accessible planet carries it` };
    optionsByP1.set(p1, opts);
  }
  const extract: Record<string, number> = {};
  const penalty = stackPenaltyOf(world);
  const scarcestFirst = Object.entries(unit.extractP1PerWeek)
    .sort((a, b) => (optionsByP1.get(a[0])!.length - optionsByP1.get(b[0])!.length) || a[0].localeCompare(b[0]));
  for (const [p1, perUnit] of scarcestFirst) {
    const needed = perUnit * x;
    let cum = 0;
    let n = 0;
    for (const opt of optionsByP1.get(p1)!) {
      let cap = capacity.get(opt.planet.name) ?? 0;
      let stackYield = opt.p1PerWeek; // T-08: each extra colony on the same deposit yields less
      while (cap > 0 && cum < needed) { cum += stackYield; stackYield *= 1 - penalty; cap--; n++; }
      capacity.set(opt.planet.name, cap);
      if (cum >= needed) break;
    }
    if (cum < needed) return { error: `no-capacity-for: ${p1}` };
    extract[p1] = n;
  }
  const refine: Record<string, number> = {};
  for (const [p1, perUnit] of Object.entries(unit.refineP1PerWeek)) {
    refine[p1] = Math.ceil((perUnit * x) / (REFINERY_BASICS * P1_PER_BASIC_PER_WEEK) - 1e-9);
  }
  // Size factory colonies from INTEGER per-schematic needs (see facilityNeeds).
  const needs = facilityNeeds(unit, x);
  const advanced = Math.ceil(needs.adv / ADV_PER_COLONY - 1e-9);
  const ht = Math.ceil(needs.ht / HT_PER_COLONY - 1e-9);
  // Factory sites draw from the SAME ledger — refuse rates whose sites
  // cannot fit the capacity extraction left over (mirrors place()).
  const refineTotal = Object.values(refine).reduce((a, b) => a + b, 0);
  let remaining = 0;
  let remainingHt = 0;
  for (const p of world.planets) {
    const c = capacity.get(p.name) ?? 0;
    remaining += c;
    if (canBuildHighTech(p.type)) remainingHt += c;
  }
  if (ht > remainingHt) return { error: 'place-ht: no Barren/Temperate planet capacity for a high-tech colony' };
  if (refineTotal + advanced + ht > remaining) return { error: 'no-capacity-for: factory sites (planet capacity exhausted by extraction)' };
  return { extract, refine, advanced, ht };
}

function totalColonies(c: RoleCounts): number {
  return Object.values(c.extract).reduce((a, b) => a + b, 0)
    + Object.values(c.refine).reduce((a, b) => a + b, 0)
    + c.advanced + c.ht;
}

/**
 * Fractional relaxation upper bound (integrality relaxed) with a JOINT
 * planet-contention tightening (T-13, owner 2026-09-03).
 *
 * Base relaxation (Round-2 fix, still the λ=0 backbone): per input, pool
 * every colony's penalized yield ACROSS planets and take them globally
 * best-first — per-planet series are decreasing, so the global top-n is
 * prefix-closed and dominates every integer placement. Never re-introduce a
 * per-planet drain walk here.
 *
 * T-13 tightening — LAGRANGIAN DUAL on the per-planet command-center caps
 * (capacity = chars per planet, mirroring place()'s ledger). For ANY
 * multipliers λ_p ≥ 0, price a colony on planet p at (1+λ_p) and let the
 * relaxed problem place freely; then
 *   L(λ, x) = minCost(λ, x) − Σ_p λ_p·chars
 * is a valid LOWER bound on the colonies any real plan at rate x must use:
 * a real plan has per-planet counts c_p ≤ chars, so its λ-priced cost is
 * N + Σ λ_p c_p ≤ N + Σ λ_p chars, and minCost is ≤ that. Hence
 * L(λ, x) > slots proves rate x infeasible — for EVERY λ ≥ 0, so any λ the
 * subgradient search visits yields a VALID (possibly loose, never wrong)
 * cut; λ = 0 recovers the Round-2 bound exactly. The dual is only searched
 * when the λ=0 optimum actually oversubscribes some planet (otherwise it
 * provably cannot improve), so uncontended worlds pay nothing.
 */
export function upperBound(world: SolveWorld, product: string, sourcing: Readonly<Record<string, Sourcing>>): number {
  const unit = unitNeeds(product, sourcing);
  const slots = world.operation.characters.reduce((a, c) => a + 1 + c.icLevel, 0);
  const chars = world.operation.characters.length;
  const penalty = stackPenaltyOf(world);
  const nP = world.planets.length;
  const capTotal = nP * chars;
  const btIdx: number[] = [];
  world.planets.forEach((p, i) => { if (canBuildHighTech(p.type)) btIdx.push(i); });
  const htCap = btIdx.length * chars;

  // Per input: per-planet decayed yield series, plus a λ=0 presorted flat
  // pool (the common fast path — identical to the Round-2 greedy).
  interface InputSrc { readonly perUnit: number; readonly entries: ReadonlyArray<{ y: number; p: number }>; readonly zeroOrder: ReadonlyArray<{ y: number; p: number }> }
  const inputs: InputSrc[] = [];
  for (const [p1, perUnit] of Object.entries(unit.extractP1PerWeek)) {
    const p0 = oreOf(p1);
    const entries: Array<{ y: number; p: number }> = [];
    world.planets.forEach((p, pi) => {
      if (p.resources[p0] === undefined) return;
      let y = extractionOption(p, p0, world).p1PerWeek;
      for (let k = 0; k < chars; k++) {
        if (y > 0) entries.push({ y, p: pi });
        y *= 1 - penalty; // (1-penalty)^k for the k-th colony on this deposit (T-08)
      }
    });
    inputs.push({ perUnit, entries, zeroOrder: [...entries].sort((a, b) => b.y - a.y) });
  }
  const refinePerX = Object.values(unit.refineP1PerWeek).reduce((a, b) => a + b, 0) / (REFINERY_BASICS * P1_PER_BASIC_PER_WEEK);
  const advPerX = unit.advancedFacilities / ADV_PER_COLONY;
  const htPerX = unit.htFacilities / HT_PER_COLONY;

  /** Exact min λ-cost of the relaxed problem at rate x (separable greedy:
   * per input, cheapest cost-per-unit first; factories at the cheapest
   * eligible planet). ok:false = demand unmeetable even fractionally. */
  const evalAlloc = (x: number, lam: Float64Array | null): { ok: boolean; cost: number; colonies: number; perPlanet: Float64Array; htColonies: number } => {
    const perPlanet = new Float64Array(nP);
    let cost = 0;
    let colonies = 0;
    for (const inp of inputs) {
      let needed = inp.perUnit * x;
      if (needed <= 1e-9) continue;
      const ordered = lam === null
        ? inp.zeroOrder
        : [...inp.entries].sort((a, b) => (1 + lam[a.p]!) / a.y - (1 + lam[b.p]!) / b.y);
      for (const e of ordered) {
        if (needed <= 1e-9) break;
        const take = Math.min(needed / e.y, 1);
        const cc = 1 + (lam === null ? 0 : lam[e.p]!);
        cost += take * cc;
        colonies += take;
        perPlanet[e.p]! += take;
        needed -= take * e.y;
      }
      if (needed > 1e-9) return { ok: false, cost: Infinity, colonies, perPlanet, htColonies: 0 };
    }
    const facColonies = (refinePerX + advPerX) * x;
    const htColonies = htPerX * x;
    if (facColonies > 1e-12) {
      let minL = Infinity, argmin = 0;
      for (let p = 0; p < nP; p++) { const l = lam === null ? 0 : lam[p]!; if (l < minL) { minL = l; argmin = p; } }
      if (nP === 0) return { ok: false, cost: Infinity, colonies, perPlanet, htColonies };
      cost += facColonies * (1 + minL);
      colonies += facColonies;
      perPlanet[argmin]! += facColonies;
    }
    if (htColonies > 1e-12) {
      if (btIdx.length === 0) return { ok: false, cost: Infinity, colonies, perPlanet, htColonies };
      let minL = Infinity, argmin = btIdx[0]!;
      for (const p of btIdx) { const l = lam === null ? 0 : lam[p]!; if (l < minL) { minL = l; argmin = p; } }
      cost += htColonies * (1 + minL);
      colonies += htColonies;
      perPlanet[argmin]! += htColonies;
    }
    return { ok: true, cost, colonies, perPlanet, htColonies };
  };

  const lambdas: Float64Array[] = [];
  const lamSums: number[] = [];
  const eps = 1e-9;
  const feasible = (x: number): boolean => {
    const base = evalAlloc(x, null); // λ=0: cost === colonies
    if (!base.ok) return false;
    if (base.colonies > slots + eps || base.colonies > capTotal + eps || base.htColonies > htCap + eps) return false;
    for (let i = 0; i < lambdas.length; i++) {
      const r = evalAlloc(x, lambdas[i]!);
      if (!r.ok) return false;
      if (r.cost - lamSums[i]! > slots + eps) return false;
    }
    return true;
  };

  if (!feasible(1e-9)) return 0;
  const bisect = (hiKnownInfeasible: number): number => {
    let lo = 0, hi = hiKnownInfeasible;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (feasible(mid)) lo = mid; else hi = mid;
    }
    return lo;
  };
  let hi = 1;
  while (feasible(hi)) hi *= 2;
  let x = bisect(hi);

  for (let round = 0; round < 2 && x > 0; round++) {
    // The dual can only cut when the λ=0 optimum oversubscribes a planet.
    const at = evalAlloc(x, null);
    if (!at.ok) break;
    let over = false;
    for (let p = 0; p < nP; p++) if (at.perPlanet[p]! > chars + 1e-6) { over = true; break; }
    if (!over) break;
    // Subgradient ascent on λ at fixed x; every iterate's L is a valid
    // bound, so only the BEST is kept and looseness is the worst case.
    const lam = new Float64Array(nP);
    let best: { L: number; lam: Float64Array } | null = null;
    for (let t = 0; t < 30; t++) {
      const r = evalAlloc(x, lam);
      if (!r.ok) break;
      let sub = 0;
      for (let p = 0; p < nP; p++) sub += lam[p]! * chars;
      const L = r.cost - sub;
      if (best === null || L > best.L) best = { L, lam: lam.slice() };
      let gnorm = 0;
      for (let p = 0; p < nP; p++) { const g = r.perPlanet[p]! - chars; gnorm += g * g; }
      if (gnorm < 1e-12) break;
      const step = (0.35 / Math.sqrt(t + 1)) * (Math.max(1, r.colonies) / gnorm) ** 0.5 / Math.max(1, chars) ** 0.5;
      for (let p = 0; p < nP; p++) lam[p] = Math.max(0, lam[p]! + step * (r.perPlanet[p]! - chars));
    }
    if (best === null || best.L <= slots + eps) break; // no provable cut at this x
    lambdas.push(best.lam);
    lamSums.push(best.lam.reduce((a, b) => a + b, 0) * chars);
    const x2 = bisect(x);
    if (x - x2 <= x * 1e-4) { x = x2; break; }
    x = x2;
  }
  return x;
}

/** Build the concrete OperationPlan for placed roles at realized rate X'. */
function buildPlan(
  world: SolveWorld,
  unit: ChainNeeds,
  counts: RoleCounts,
  placed: { extractPicks: ExtractionOption[]; sites: Array<{ planet: PlanetInfo }> },
  realized: number,
): { plan: OperationPlan; slotsUsed: number; realized: number } | { error: string } {
  // Facility distribution across advanced/HT colonies, per schematic — at a
  // rate the colonies can actually PACK. The aggregate rate the search used
  // is an upper bound; integer per-schematic ceils can exceed it (matrix
  // finding). Honesty over optimism: shrink the rate to the largest value
  // whose integer facility needs fit the built colonies, and report that.
  const advCap = counts.advanced * ADV_PER_COLONY;
  const htCap = counts.ht * HT_PER_COLONY;
  const packs = (x: number): boolean => {
    const n = facilityNeeds(unit, x);
    return n.adv <= advCap && n.ht <= htCap;
  };
  if (!packs(realized)) {
    let lo = 0, hi = realized;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (packs(mid)) lo = mid; else hi = mid;
    }
    realized = lo;
  }
  if (realized <= 0) return { error: 'pack-overflow: no positive rate fits the built colonies' };
  const facPerSchem = facilityNeeds(unit, realized).perSchem;

  interface Draft {
    role: string;
    planet: PlanetInfo;
    layout: Layout;
    extractors: Array<{ resource: string; w: number; programHours: number; extraction?: ExtractionOptions }>;
    factories: Map<string, number>;
  }
  const drafts: Draft[] = [];
  for (const pick of placed.extractPicks) {
    const e: Draft['extractors'][number] = { resource: pick.p0, w: pick.w, programHours: world.programHours };
    if (world.extraction !== undefined) e.extraction = world.extraction;
    drafts.push({
      role: 'extract', planet: pick.planet, layout: extractionLayout(pick.basics),
      extractors: [e], factories: new Map([[pick.p1, pick.basics]]),
    });
  }
  let siteIdx = 0;
  const nextSite = (): PlanetInfo => placed.sites[siteIdx++]!.planet;
  for (let i = 0; i < counts.ht; i++) drafts.push({ role: 'ht', planet: nextSite(), layout: HT_LAYOUT, extractors: [], factories: new Map() });
  for (let i = 0; i < counts.advanced; i++) drafts.push({ role: 'advanced', planet: nextSite(), layout: ADV_LAYOUT, extractors: [], factories: new Map() });
  for (const [p1, n] of Object.entries(counts.refine)) {
    for (let i = 0; i < n; i++) {
      drafts.push({ role: 'refine', planet: nextSite(), layout: REFINERY_LAYOUT, extractors: [], factories: new Map([[p1, REFINERY_BASICS]]) });
    }
  }

  // First-fit facility packing into matching colonies.
  for (const f of facPerSchem) {
    const cap = f.kind === 'hightech' ? HT_PER_COLONY : ADV_PER_COLONY;
    const role = f.kind === 'hightech' ? 'ht' : 'advanced';
    let left = f.facilities;
    for (const d of drafts) {
      if (d.role !== role || left === 0) continue;
      const used = [...d.factories.values()].reduce((a, b) => a + b, 0);
      const take = Math.min(cap - used, left);
      if (take > 0) {
        d.factories.set(f.schematic, (d.factories.get(f.schematic) ?? 0) + take);
        left -= take;
      }
    }
    if (left > 0) return { error: `pack-overflow: ${left} ${f.schematic} facilities did not fit` };
  }

  // Per-colony imports at realized utilization: required inputs − local production.
  const totalFacBuilt = new Map<string, number>();
  for (const f of facPerSchem) totalFacBuilt.set(f.schematic, f.facilities);
  const utilization = (schem: string): number => {
    const built = totalFacBuilt.get(schem) ?? 0;
    if (built === 0) return 0;
    const s = SCHEMATICS.get(schem)!;
    const perFac = s.outQty * ((168 * 3600) / s.cycleSeconds);
    return ((unit.outputsPerWeek[schem] ?? 0) * realized) / (built * perFac);
  };

  const colonies: PlannedColony[] = [];
  const assignables = drafts.map((d) => ({ planetName: d.planet.name, minCcuLevel: minCcLevel(d.layout) }));
  const dealt = deal(world.operation, assignables);
  if ('error' in dealt) return { error: dealt.error };

  drafts.forEach((d, i) => {
    const producedHere = new Map<string, number>(); // per hour
    const requiredHere = new Map<string, number>();
    const uPerSchem = new Map<string, number>();
    for (const [schem, fac] of d.factories) {
      const s = SCHEMATICS.get(schem)!;
      const cyclesPerHour = 3600 / s.cycleSeconds;
      // Refineries throttle to the realized chain need — importing ore at full
      // capacity beyond the purchases that back it is a material-balance
      // violation the judge rejects (proven in Gate 5 development).
      const refineCap = (counts.refine[schem] ?? 0) * REFINERY_BASICS * P1_PER_BASIC_PER_WEEK;
      const u = d.role === 'extract' ? 1
        : d.role === 'refine'
          ? Math.min(1, ((unit.refineP1PerWeek[schem] ?? 0) * realized) / (refineCap || 1))
          : utilization(schem);
      uPerSchem.set(schem, u);
      producedHere.set(schem, (producedHere.get(schem) ?? 0) + u * fac * s.outQty * cyclesPerHour);
      for (const [input, perCycle] of Object.entries(s.inputs)) {
        requiredHere.set(input, (requiredHere.get(input) ?? 0) + u * fac * perCycle * cyclesPerHour);
      }
    }
    // Refinery/extract run at their own pace: refinery imports full ore demand;
    // extraction feeds itself. Factory colonies import shortfalls.
    const imports: Array<{ commodity: string; qtyPerHour: number }> = [];
    for (const [input, req] of requiredHere) {
      if (d.role === 'extract' && tierOf(input) === 0) continue; // own extraction
      const local = producedHere.get(input) ?? 0;
      const short = req - local;
      if (short > 1e-9) imports.push({ commodity: input, qtyPerHour: short });
    }
    // Routed utilization travels WITH the plan (game truth: routes partition
    // inputs between facility groups) so the flow model runs each group at its
    // planned share instead of letting early groups overeat shared pools.
    const factories = [...d.factories.entries()].map(([schematic, count]) => {
      const u = uPerSchem.get(schematic) ?? 1;
      return u < 1 - 1e-12 ? { schematic, count, utilization: u } : { schematic, count };
    });
    const assign = dealt.assignments[i]!;
    colonies.push({
      id: `col-${i}`, characterName: assign.characterName, planetName: d.planet.name,
      planetType: d.planet.type,
      ccLevel: minCcLevel(d.layout), // dealer guarantees the character's CCU covers this
      layout: d.layout,
      plan: { extractors: d.extractors, imports, factories },
    });
  });

  // Operation-level purchases: bought P1s + ore, at realized rate (per hour).
  const purchases: Array<{ commodity: string; qtyPerHour: number }> = [];
  for (const [commodity, perUnit] of Object.entries(unit.purchasesPerWeek)) {
    purchases.push({ commodity, qtyPerHour: (perUnit * realized) / HOURS_PER_WEEK });
  }
  const plan: OperationPlan = { operation: world.operation, colonies, logistics: { purchases } };
  return { plan, slotsUsed: colonies.length, realized };
}

/** Penalized built P1/week from a pick list: the k-th colony on the same
 * (planet, P1) deposit yields (1-penalty)^k of the base (truth audit T-08). */
function builtExtractFrom(picks: ReadonlyArray<ExtractionOption>, penalty: number): Record<string, number> {
  const seen = new Map<string, number>();
  const out: Record<string, number> = {};
  for (const pick of picks) {
    const key = `${pick.planet.name}|${pick.p1}`;
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    out[pick.p1] = (out[pick.p1] ?? 0) + pick.p1PerWeek * Math.pow(1 - penalty, k);
  }
  return out;
}

interface PlacementPick { placed: Placed; builtExtract: Record<string, number>; realized: number }

/**
 * Best DEALABLE placement (truth audit T-12): tries stacked/spread AND, when
 * more than one input is extracted, both input-priority orders — the fixed
 * order let the same input always claim a contended planet. Candidates are
 * ranked by realized rate first; the dealer (exact matching) certifies the
 * best one that is actually assignable.
 */
function bestPlacement(world: SolveWorld, counts: RoleCounts, unit: ChainNeeds): PlacementPick | { error: string } {
  const penalty = stackPenaltyOf(world);
  const reverses = Object.keys(counts.extract).length > 1 ? [false, true] : [false];
  const cands: PlacementPick[] = [];
  let lastError = 'unplaceable';
  for (const reverse of reverses) {
    for (const spread of [false, true]) {
      const placed = place(world, counts, spread, reverse);
      if ('error' in placed) { lastError = placed.error; continue; }
      const builtExtract = builtExtractFrom(placed.extractPicks, penalty);
      cands.push({ placed, builtExtract, realized: realizedRate(unit, builtExtract, counts.refine, counts.advanced, counts.ht) });
    }
  }
  cands.sort((a, b) => b.realized - a.realized);
  for (const c of cands) {
    const dealt = deal(world.operation, assignablesFor(counts, c.placed));
    if (!('error' in dealt)) return c;
    lastError = dealt.error;
  }
  return { error: lastError };
}

/** Solve: max weekly rate of `product` from `world` under `sourcing`. */
export interface SolveOptions {
  /** 'auto' (default) picks exhaustive when the space is small; 'greedy'
   * forces the fast solver — used for RANKING passes (compare mode, sourcing
   * refinement) where ~100 solves must stay interactive. The picked/final
   * plan always runs 'auto'. Greedy answers still carry their upper-bound
   * certificate, so ranking honesty is preserved. */
  readonly method?: 'auto' | 'greedy';
}

export function solveMax(
  world: SolveWorld,
  product: string,
  sourcing: Readonly<Record<string, Sourcing>>,
  options: SolveOptions = {},
): SolveResult | { error: string } {
  checkWorld(world);
  const unit = unitNeeds(product, sourcing);
  const slots = world.operation.characters.reduce((a, c) => a + 1 + c.icLevel, 0);
  const notes: string[] = [];

  const evalCounts = (counts: RoleCounts): number => {
    if (totalColonies(counts) > slots) return -1;
    const bp = bestPlacement(world, counts, unit);
    return 'error' in bp ? -1 : bp.realized;
  };

  // Exhaustive over role-count tuples when the space is small.
  const classKeys = [
    ...Object.keys(unit.extractP1PerWeek).map((p1) => ({ kind: 'extract' as const, p1 })),
    ...Object.keys(unit.refineP1PerWeek).map((p1) => ({ kind: 'refine' as const, p1 })),
    ...(unit.advancedFacilities > 0 ? [{ kind: 'advanced' as const, p1: '' }] : []),
    ...(unit.htFacilities > 0 ? [{ kind: 'ht' as const, p1: '' }] : []),
  ];
  const comb = (n: number, k: number): number => {
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
  };
  const tupleEstimate = comb(slots + classKeys.length, classKeys.length);
  let best: { counts: RoleCounts; rate: number } | null = null;
  let method: 'exhaustive' | 'greedy';

  if (options.method !== 'greedy'
    && slots <= EXHAUSTIVE_SLOT_LIMIT && tupleEstimate <= EXHAUSTIVE_TUPLE_LIMIT && classKeys.length > 0) {
    method = 'exhaustive';
    const current: number[] = new Array(classKeys.length).fill(0);
    const rec = (idx: number, left: number): void => {
      if (idx === classKeys.length) {
        const extract: Record<string, number> = {};
        const refine: Record<string, number> = {};
        let advanced = 0, ht = 0;
        classKeys.forEach((c, i) => {
          const v = current[i]!;
          if (c.kind === 'extract') extract[c.p1] = v;
          else if (c.kind === 'refine') refine[c.p1] = v;
          else if (c.kind === 'advanced') advanced = v;
          else ht = v;
        });
        const counts: RoleCounts = { extract, refine, advanced, ht };
        const rate = evalCounts(counts);
        if (rate > (best?.rate ?? 0)) best = { counts, rate };
        return;
      }
      for (let v = 0; v <= left; v++) {
        current[idx] = v;
        rec(idx + 1, left - v);
      }
    };
    rec(0, slots);
    notes.push(`exhaustive search over ${classKeys.length}-class colony mixes (≈${Math.round(tupleEstimate).toLocaleString()} tuples)`);
  } else {
    method = 'greedy';
    // Binary search the target rate; counts are ceil-built per rate.
    const feasible = (x: number): boolean => {
      const counts = countsFor(world, unit, x);
      if ('error' in counts) return false;
      return evalCounts(counts) >= x - 1e-9;
    };
    if (!feasible(1e-9)) {
      const c0 = countsFor(world, unit, 1e-9);
      return { error: 'error' in c0 ? c0.error : 'infeasible: not even an epsilon rate fits this world' };
    }
    let lo = 1e-9, hi = 1;
    while (feasible(hi)) hi *= 2;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (feasible(mid)) lo = mid; else hi = mid;
    }
    const counts = countsFor(world, unit, lo);
    if ('error' in counts) return { error: counts.error };
    best = { counts, rate: evalCounts(counts) };
    // Local improvement (user-reported defect 2026-09-03): the binary search
    // sizes all roles to ONE rate, so integer rounding can leave slots idle
    // while a single +1 colony on the binding role lifts the whole chain.
    // Hill-climb +1 perturbations until no single addition helps.
    type RoleKey = { kind: 'extract' | 'refine'; p1: string } | { kind: 'advanced'; p1?: never } | { kind: 'ht'; p1?: never };
    const valueOf = (c: RoleCounts, k: RoleKey): number =>
      k.kind === 'extract' ? (c.extract[k.p1] ?? 0)
        : k.kind === 'refine' ? (c.refine[k.p1] ?? 0)
          : k.kind === 'advanced' ? c.advanced : c.ht;
    const withDelta = (c: RoleCounts, k: RoleKey, d: number): RoleCounts =>
      k.kind === 'extract' ? { ...c, extract: { ...c.extract, [k.p1]: (c.extract[k.p1] ?? 0) + d } }
        : k.kind === 'refine' ? { ...c, refine: { ...c.refine, [k.p1]: (c.refine[k.p1] ?? 0) + d } }
          : k.kind === 'advanced' ? { ...c, advanced: c.advanced + d } : { ...c, ht: c.ht + d };
    for (let round = 0; round < 25; round++) {
      let improved = false;
      const bc = best.counts;
      const roleKeys: RoleKey[] = [
        ...Object.keys(bc.extract).map((p1) => ({ kind: 'extract' as const, p1 })),
        ...Object.keys(bc.refine).map((p1) => ({ kind: 'refine' as const, p1 })),
        { kind: 'advanced' }, { kind: 'ht' },
      ];
      // +1 moves close integrality gaps; -1/+1 SWAPS (truth audit T-12) keep
      // improving when slots are already full — trading a colony from the
      // over-supplied role to the bottleneck, which +1 alone can never do.
      // Round-2 ordering fix: when every slot is taken, +1 moves are dead on
      // arrival (no character can host the colony) — skip them so the round
      // goes straight to the swaps that can still help.
      const variants: RoleCounts[] = totalColonies(bc) < slots
        ? roleKeys.map((k) => withDelta(bc, k, +1))
        : [];
      for (const minus of roleKeys) {
        if (valueOf(bc, minus) <= 0) continue;
        for (const plus of roleKeys) {
          if (plus === minus) continue;
          variants.push(withDelta(withDelta(bc, minus, -1), plus, +1));
        }
      }
      for (const v of variants) {
        const r = evalCounts(v);
        if (r > best.rate * (1 + 1e-9)) { best = { counts: v, rate: r }; improved = true; break; }
      }
      if (!improved) break;
    }
    notes.push('greedy: best planet first, scarcest extracted input first, ceil-built colonies, +1/swap hill-climb');
  }

  if (best === null || best.rate <= 0) return { error: `infeasible: ${product} cannot be produced from this world` };
  const chosen: { counts: RoleCounts; rate: number } = best;

  const bp = bestPlacement(world, chosen.counts, unit);
  if ('error' in bp) return { error: bp.error };
  const builtExtract = bp.builtExtract;
  const built = buildPlan(world, unit, chosen.counts, bp.placed, chosen.rate);
  if ('error' in built) return { error: built.error };
  const verdict = validatePlan(built.plan);
  if (!verdict.legal) {
    return { error: `judge-rejected: ${verdict.violations.map((v) => v.rule).join(', ')} — the allocator refuses to emit an illegal plan` };
  }
  if (built.realized < chosen.rate * (1 - 1e-9)) {
    notes.push(`rate adjusted ${Math.round(chosen.rate)} → ${Math.round(built.realized)}/wk so integer facility counts pack into the built colonies`);
  }
  return {
    product, sourcing, realizedPerWeek: built.realized,
    upperBoundPerWeek: upperBound(world, product, sourcing),
    method, slotsUsed: built.slotsUsed, plan: built.plan, verdict,
    builtExtractP1: builtExtract, notes,
  };
}

/** Solve for a fixed quota: minimal ceil-built plan hitting `targetPerWeek`. */
export function solveQuota(
  world: SolveWorld,
  product: string,
  targetPerWeek: number,
  sourcing: Readonly<Record<string, Sourcing>>,
): SolveResult | { error: string; achievablePerWeek?: number } {
  checkWorld(world);
  if (!Number.isFinite(targetPerWeek) || targetPerWeek <= 0)
    return { error: `quota-invalid: targetPerWeek must be > 0, got ${targetPerWeek}` };
  const unit = unitNeeds(product, sourcing);
  const max = solveMax(world, product, sourcing);
  const slots = world.operation.characters.reduce((a, c) => a + 1 + c.icLevel, 0);

  // One sizing attempt at rate y: counts → placement → realized rate.
  interface Attempt { counts: RoleCounts; placed: Placed; builtExtract: Record<string, number>; realized: number }
  const attempt = (y: number): Attempt | { error: string } => {
    const counts = countsFor(world, unit, y);
    if ('error' in counts) return counts;
    if (totalColonies(counts) > slots) return { error: `needs ${totalColonies(counts)} colonies, operation has ${slots} slots` };
    const bp = bestPlacement(world, counts, unit);
    if ('error' in bp) return { error: bp.error };
    return { counts, placed: bp.placed, builtExtract: bp.builtExtract, realized: bp.realized };
  };
  const ok = (a: Attempt | { error: string }): a is Attempt => !('error' in a);
  const hits = (a: Attempt | { error: string }): a is Attempt => ok(a) && a.realized >= targetPerWeek * (1 - 1e-9);

  // Size at the target first; when ceil-building exactly at the target lands
  // short (integer colonies, shared-planet contention), ESCALATE the sizing
  // rate and search the smallest one whose built plan actually reaches the
  // target — refusing outright here was a user-reported defect (2026-09-03):
  // quotas at 75–90% of the solver's own max were bounced as unreachable.
  let chosen = attempt(targetPerWeek);
  if (!hits(chosen)) {
    let hi = targetPerWeek;
    let found: Attempt | null = null;
    for (let i = 0; i < 12 && found === null; i++) {
      hi *= 1.5;
      const t = attempt(hi);
      if (hits(t)) found = t;
    }
    if (found !== null) {
      let lo = targetPerWeek;
      let hiY = hi;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hiY) / 2;
        const t = attempt(mid);
        if (hits(t)) { hiY = mid; found = t; } else { lo = mid; }
      }
      chosen = found;
    }
  }
  if (!ok(chosen) || chosen.realized < targetPerWeek * (1 - 1e-9)) {
    // Final fallback: the hill-climbed max solve can reach allocations the
    // rate-sizing path cannot express (swap moves). If ITS build covers the
    // target, hitting the quota with that plan beats refusing — the surplus
    // is disclosed, and "achievable" and "reachable" stay one truth.
    if (!('error' in max) && max.realizedPerWeek >= targetPerWeek * (1 - 1e-9)) {
      return {
        ...max,
        realizedPerWeek: Math.min(max.realizedPerWeek, targetPerWeek),
        notes: [...max.notes, `quota: met by the max-rate build (${Math.floor(max.realizedPerWeek)}/wk capacity; target-sized builds fell short) — surplus capacity is yours`],
      };
    }
    const why = !ok(chosen)
      ? chosen.error
      : `the buildable plan realizes ${Math.floor(chosen.realized)}/wk, short of ${targetPerWeek}/wk`;
    return { error: `quota-unreachable: ${why}`, ...('error' in max ? {} : { achievablePerWeek: max.realizedPerWeek }) };
  }
  const { counts, placed, builtExtract, realized } = chosen;
  const built = buildPlan(world, unit, counts, placed, Math.min(realized, targetPerWeek * (1 + 1e-9)));
  if ('error' in built) return { error: built.error, ...('error' in max ? {} : { achievablePerWeek: max.realizedPerWeek }) };
  const verdict = validatePlan(built.plan);
  if (!verdict.legal) return { error: `judge-rejected: ${verdict.violations.map((v) => v.rule).join(', ')}` };
  return {
    product, sourcing, realizedPerWeek: Math.min(built.realized, targetPerWeek),
    upperBoundPerWeek: upperBound(world, product, sourcing),
    method: 'greedy', slotsUsed: built.slotsUsed, plan: built.plan, verdict,
    builtExtractP1: builtExtract,
    notes: ['quota: ceil-built to the target; surplus capacity reported via realized rate'],
  };
}
