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
import { perHourRate, type ExtractionOptions } from '../world/extraction.js';
import { oreOf } from './chain.js';
import { CC_LEVELS } from '../spec/constants.js';
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
}

const WORLD_KEYS = ['operation', 'planets', 'programHours', 'extraction'] as const;

export const P0_PER_BASIC_PER_HOUR = 3000 * 2; // 30-min cycles
export const P1_PER_BASIC_PER_WEEK = 20 * 2 * HOURS_PER_WEEK; // 6,720
export const MAX_BASICS_PER_EXTRACTION_COLONY = 12; // CPU/PG-verified (Gate 1)
export const REFINERY_BASICS = 8;
export const ADV_PER_COLONY = 24;
export const HT_PER_COLONY = 16;

const links = (n: number) => Array.from({ length: n }, () => ({ lengthKm: 0, level: 0 }));

export function minCcLevel(l: Layout): number {
  for (let lvl = 0; lvl < CC_LEVELS.length; lvl++) {
    if (fitsCommandCenter(l, lvl).fits) return lvl;
  }
  throw new Error('layout fits no command center level');
}

function extractionLayout(basics: number): Layout {
  return layout({ ecus: 1, headsPerEcu: [10], basic: basics, advanced: 0, hightech: 0, storage: 0, launchpads: 1, links: links(basics + 2) });
}
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

export function extractionOption(planet: PlanetInfo, p0: string, world: SolveWorld): ExtractionOption {
  const w = planet.resources[p0];
  if (w === undefined) throw new Error(`${planet.name} does not carry ${p0}`);
  const supply = perHourRate(w, world.programHours, world.extraction ?? {});
  const basics = Math.min(MAX_BASICS_PER_EXTRACTION_COLONY, Math.max(1, Math.ceil(supply / P0_PER_BASIC_PER_HOUR)));
  const p1PerWeek = Math.min(basics * P1_PER_BASIC_PER_WEEK, (supply / P0_PER_P1) * HOURS_PER_WEEK);
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
  const scarcestFirst = Object.entries(counts.extract)
    .sort((a, b) => (options.get(a[0])!.length - options.get(b[0])!.length));
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

/** Role counts needed to hit rate X (all-ceil), using best-first extraction. */
function countsFor(world: SolveWorld, unit: ChainNeeds, x: number): RoleCounts | { error: string } {
  const extract: Record<string, number> = {};
  for (const [p1, perUnit] of Object.entries(unit.extractP1PerWeek)) {
    const needed = perUnit * x;
    const p0 = oreOf(p1);
    const opts = world.planets
      .filter((p) => p.resources[p0] !== undefined)
      .map((p) => extractionOption(p, p0, world))
      .sort((a, b) => b.p1PerWeek - a.p1PerWeek);
    if (opts.length === 0) return { error: `no-planet-for: ${p1} (${p0}) — no accessible planet carries it` };
    // Colonies best-first until cumulative capacity covers the need (planet
    // reuse up to #chars handled in place()).
    let cum = 0;
    let n = 0;
    const maxColonies = world.planets.length * world.operation.characters.length + 1;
    while (cum < needed && n < maxColonies) {
      const opt = opts[Math.min(Math.floor(n / world.operation.characters.length), opts.length - 1)]!;
      cum += opt.p1PerWeek;
      n++;
    }
    if (cum < needed) return { error: `no-capacity-for: ${p1}` };
    extract[p1] = n;
  }
  const refine: Record<string, number> = {};
  for (const [p1, perUnit] of Object.entries(unit.refineP1PerWeek)) {
    refine[p1] = Math.ceil((perUnit * x) / (REFINERY_BASICS * P1_PER_BASIC_PER_WEEK) - 1e-9);
  }
  return {
    extract,
    refine,
    advanced: Math.ceil((unit.advancedFacilities * x) / ADV_PER_COLONY - 1e-9),
    ht: Math.ceil((unit.htFacilities * x) / HT_PER_COLONY - 1e-9),
  };
}

function totalColonies(c: RoleCounts): number {
  return Object.values(c.extract).reduce((a, b) => a + b, 0)
    + Object.values(c.refine).reduce((a, b) => a + b, 0)
    + c.advanced + c.ht;
}

/** Fractional relaxation upper bound (integrality AND planet contention relaxed). */
export function upperBound(world: SolveWorld, product: string, sourcing: Readonly<Record<string, Sourcing>>): number {
  const unit = unitNeeds(product, sourcing);
  const slots = world.operation.characters.reduce((a, c) => a + 1 + c.icLevel, 0);
  const chars = world.operation.characters.length;
  const feasible = (x: number): boolean => {
    let used = 0;
    for (const [p1, perUnit] of Object.entries(unit.extractP1PerWeek)) {
      const p0 = oreOf(p1);
      const opts = world.planets
        .filter((p) => p.resources[p0] !== undefined)
        .map((p) => extractionOption(p, p0, world))
        .sort((a, b) => b.p1PerWeek - a.p1PerWeek);
      let needed = perUnit * x;
      for (const opt of opts) {
        if (needed <= 0) break;
        const take = Math.min(needed / opt.p1PerWeek, chars); // fractional colonies, per-planet cap relaxed per-pool
        used += take;
        needed -= take * opt.p1PerWeek;
      }
      if (needed > 1e-9) return false;
    }
    for (const [, perUnit] of Object.entries(unit.refineP1PerWeek)) {
      used += (perUnit * x) / (REFINERY_BASICS * P1_PER_BASIC_PER_WEEK);
    }
    used += (unit.advancedFacilities * x) / ADV_PER_COLONY;
    used += (unit.htFacilities * x) / HT_PER_COLONY;
    return used <= slots + 1e-9;
  };
  if (!feasible(1e-9)) return 0;
  let lo = 0, hi = 1;
  while (feasible(hi)) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (feasible(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** Build the concrete OperationPlan for placed roles at realized rate X'. */
function buildPlan(
  world: SolveWorld,
  unit: ChainNeeds,
  counts: RoleCounts,
  placed: { extractPicks: ExtractionOption[]; sites: Array<{ planet: PlanetInfo }> },
  realized: number,
): { plan: OperationPlan; slotsUsed: number } | { error: string } {
  // Facility distribution across advanced/HT colonies, per schematic.
  const facPerSchem: Array<{ schematic: string; facilities: number; kind: 'advanced' | 'hightech' }> = [];
  for (const [name, qtyPerUnit] of Object.entries(unit.outputsPerWeek)) {
    const s = SCHEMATICS.get(name)!;
    const perFac = s.outQty * ((168 * 3600) / s.cycleSeconds);
    const fac = Math.ceil((qtyPerUnit * realized) / perFac - 1e-9);
    if (fac > 0) facPerSchem.push({ schematic: name, facilities: fac, kind: s.facility === 'hightech' ? 'hightech' : 'advanced' });
  }

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
    const factories = [...d.factories.entries()].map(([schematic, count]) => ({ schematic, count }));
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
  return { plan, slotsUsed: colonies.length };
}

/**
 * Placement that is guaranteed DEALABLE: tries max-yield stacking first, then
 * the spread variant — a stacked pair on one planet needs two free characters
 * there, and only the dealer (exact matching) can certify that.
 */
function placeDealable(world: SolveWorld, counts: RoleCounts): Placed | { error: string } {
  let lastError = 'unplaceable';
  for (const spread of [false, true]) {
    const placed = place(world, counts, spread);
    if ('error' in placed) { lastError = placed.error; continue; }
    const dealt = deal(world.operation, assignablesFor(counts, placed));
    if ('error' in dealt) { lastError = dealt.error; continue; }
    return placed;
  }
  return { error: lastError };
}

/** Solve: max weekly rate of `product` from `world` under `sourcing`. */
export function solveMax(
  world: SolveWorld,
  product: string,
  sourcing: Readonly<Record<string, Sourcing>>,
): SolveResult | { error: string } {
  checkWorld(world);
  const unit = unitNeeds(product, sourcing);
  const slots = world.operation.characters.reduce((a, c) => a + 1 + c.icLevel, 0);
  const notes: string[] = [];

  const evalCounts = (counts: RoleCounts): number => {
    if (totalColonies(counts) > slots) return -1;
    const placed = placeDealable(world, counts);
    if ('error' in placed) return -1;
    const builtExtract: Record<string, number> = {};
    for (const pick of placed.extractPicks) builtExtract[pick.p1] = (builtExtract[pick.p1] ?? 0) + pick.p1PerWeek;
    return realizedRate(unit, builtExtract, counts.refine, counts.advanced, counts.ht);
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

  if (tupleEstimate <= EXHAUSTIVE_TUPLE_LIMIT && classKeys.length > 0) {
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
    notes.push('greedy: best planet first, scarcest extracted input first, ceil-built colonies');
  }

  if (best === null || best.rate <= 0) return { error: `infeasible: ${product} cannot be produced from this world` };
  const chosen: { counts: RoleCounts; rate: number } = best;

  const placed = placeDealable(world, chosen.counts);
  if ('error' in placed) return { error: placed.error };
  const builtExtract: Record<string, number> = {};
  for (const pick of placed.extractPicks) builtExtract[pick.p1] = (builtExtract[pick.p1] ?? 0) + pick.p1PerWeek;
  const built = buildPlan(world, unit, chosen.counts, placed, chosen.rate);
  if ('error' in built) return { error: built.error };
  const verdict = validatePlan(built.plan);
  if (!verdict.legal) {
    return { error: `judge-rejected: ${verdict.violations.map((v) => v.rule).join(', ')} — the allocator refuses to emit an illegal plan` };
  }
  return {
    product, sourcing, realizedPerWeek: chosen.rate,
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
  const counts = countsFor(world, unit, targetPerWeek);
  const max = solveMax(world, product, sourcing);
  if ('error' in counts) {
    return { error: `quota-unreachable: ${counts.error}`, ...('error' in max ? {} : { achievablePerWeek: max.realizedPerWeek }) };
  }
  const slots = world.operation.characters.reduce((a, c) => a + 1 + c.icLevel, 0);
  if (totalColonies(counts) > slots) {
    return {
      error: `quota-unreachable: needs ${totalColonies(counts)} colonies, operation has ${slots} slots`,
      ...('error' in max ? {} : { achievablePerWeek: max.realizedPerWeek }),
    };
  }
  const placed = placeDealable(world, counts);
  if ('error' in placed) return { error: `quota-unreachable: ${placed.error}` };
  const builtExtract: Record<string, number> = {};
  for (const pick of placed.extractPicks) builtExtract[pick.p1] = (builtExtract[pick.p1] ?? 0) + pick.p1PerWeek;
  const realized = realizedRate(unit, builtExtract, counts.refine, counts.advanced, counts.ht);
  const built = buildPlan(world, unit, counts, placed, Math.min(realized, targetPerWeek * (1 + 1e-9)));
  if ('error' in built) return { error: built.error };
  const verdict = validatePlan(built.plan);
  if (!verdict.legal) return { error: `judge-rejected: ${verdict.violations.map((v) => v.rule).join(', ')}` };
  return {
    product, sourcing, realizedPerWeek: Math.min(realized, targetPerWeek),
    upperBoundPerWeek: upperBound(world, product, sourcing),
    method: 'greedy', slotsUsed: built.slotsUsed, plan: built.plan, verdict,
    builtExtractP1: builtExtract,
    notes: ['quota: ceil-built to the target; surplus capacity reported via realized rate'],
  };
}
