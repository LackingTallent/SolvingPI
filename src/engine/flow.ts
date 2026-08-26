/**
 * Colony steady-state flow model. A colony is a flow network:
 * extractors and imports supply commodities; factory stages transform them.
 *
 * THE RULE THE OLD ENGINE LACKED: every stage's throughput is
 *   min(facility capacity, available input ÷ ratio)
 * A colony can never claim output its buildings cannot physically make
 * (v8 scaled 53,760 × density linearly and overstated above 100%).
 *
 * Steady-state semantics: extraction supply is the program's AVERAGE per-hour
 * rate (exact CCP-formula total ÷ program hours). Within a program the real
 * rate is front-loaded by decay; averages are correct across restarts and are
 * the honest planning number. Buffers change unattended runway, not
 * throughput — runway is computed separately as a QOL metric.
 */
import { SCHEMATICS, tierOf } from '../spec/schematics.js';
import { TIER_VOLUME_M3 } from '../spec/constants.js';
import { perHourRate, type ExtractionOptions } from '../world/extraction.js';

export interface ExtractorSpec {
  readonly resource: string; // P0 name
  readonly w: number;        // raw qty_per_cycle (survey/ESI value)
  readonly programHours: number;
  readonly extraction?: ExtractionOptions;
}

export interface ImportSpec {
  readonly commodity: string;
  readonly qtyPerHour: number;
}

export interface FactoryGroup {
  readonly schematic: string; // output commodity name
  readonly count: number;     // number of facilities running it
  /** Routed utilization cap, 0..1 (default 1 = run at capacity). GAME TRUTH:
   * in-game routes send fixed quantities to specific facilities, so a group
   * only receives what the plan routes to it. Without this cap, a group that
   * shares an input pool with a later group would greedily overeat it in the
   * model (matrix finding: Polyaramids starved to 0.696 utilization while
   * Supertensile Plastics ran at 1.0 against a pool sized for 0.899 each). */
  readonly utilization?: number;
}

export interface ColonyPlan {
  readonly extractors: ReadonlyArray<ExtractorSpec>;
  readonly imports: ReadonlyArray<ImportSpec>;
  readonly factories: ReadonlyArray<FactoryGroup>;
}

const PLAN_KEYS = ['extractors', 'imports', 'factories'] as const;
const EXTRACTOR_KEYS = ['resource', 'w', 'programHours', 'extraction'] as const;
const IMPORT_KEYS = ['commodity', 'qtyPerHour'] as const;
const FACTORY_KEYS = ['schematic', 'count', 'utilization'] as const;

function rejectUnknown(what: string, obj: object, allowed: ReadonlyArray<string>): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) throw new Error(`${what}: unknown keys: ${unknown.join(', ')}`);
}

export function colonyPlan(spec: ColonyPlan): ColonyPlan {
  rejectUnknown('colonyPlan()', spec, PLAN_KEYS as ReadonlyArray<string>);
  for (const e of spec.extractors) {
    rejectUnknown('extractor', e, EXTRACTOR_KEYS as ReadonlyArray<string>);
    if (tierOf(e.resource) !== 0) throw new Error(`extractor resource must be a P0, got "${e.resource}"`);
  }
  for (const i of spec.imports) {
    rejectUnknown('import', i, IMPORT_KEYS as ReadonlyArray<string>);
    tierOf(i.commodity); // throws on unknown
    if (!Number.isFinite(i.qtyPerHour) || i.qtyPerHour < 0)
      throw new Error(`import ${i.commodity}: qtyPerHour must be >= 0, got ${i.qtyPerHour}`);
  }
  for (const f of spec.factories) {
    if (!SCHEMATICS.has(f.schematic)) throw new Error(`Unknown schematic: "${f.schematic}"`);
    rejectUnknown('factory group', f, FACTORY_KEYS as ReadonlyArray<string>);
    if (!Number.isInteger(f.count) || f.count < 1)
      throw new Error(`factory group ${f.schematic}: count must be a positive integer, got ${f.count}`);
    if (f.utilization !== undefined && (!Number.isFinite(f.utilization) || f.utilization < 0 || f.utilization > 1))
      throw new Error(`factory group ${f.schematic}: utilization must be in [0,1], got ${f.utilization}`);
  }
  return spec;
}

export interface StageReport {
  readonly schematic: string;
  readonly count: number;
  /** 0..1 — fraction of installed capacity actually running. */
  readonly utilization: number;
  readonly outputPerHour: number;
  /** 'capacity' = running full (facilities are the cap); otherwise the scarcest input. */
  readonly limitedBy: 'capacity' | { readonly input: string };
}

export interface CommodityFlow {
  readonly supplied: number; // extraction + imports, per hour
  readonly produced: number; // factory output, per hour
  readonly consumed: number; // factory intake, per hour
  readonly net: number;      // supplied + produced - consumed (exportable surplus)
}

export interface FlowResult {
  readonly perHour: ReadonlyMap<string, CommodityFlow>;
  readonly stages: ReadonlyArray<StageReport>;
  /** Disclosures — every modeling choice that affects numbers is named here. */
  readonly notes: ReadonlyArray<string>;
}

/**
 * Compute steady-state flows. Stages are fed in ascending output-tier order
 * (upstream before downstream); within a tier, declaration order — disclosed
 * in notes because allocation order matters when groups share an input.
 */
export function steadyState(planSpec: ColonyPlan): FlowResult {
  const plan = colonyPlan(planSpec);
  const notes: string[] = [
    'extraction supply = program average per hour (exact CCP-formula total / program hours)',
    'stages fed in ascending output-tier order, then declaration order',
  ];

  const supplied = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const e of plan.extractors) {
    bump(supplied, e.resource, perHourRate(e.w, e.programHours, e.extraction ?? {}));
  }
  for (const i of plan.imports) bump(supplied, i.commodity, i.qtyPerHour);

  const available = new Map(supplied);
  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();

  const ordered = plan.factories
    .map((f, idx) => ({ f, idx, tier: SCHEMATICS.get(f.schematic)!.tier }))
    .sort((a, b) => (a.tier - b.tier) || (a.idx - b.idx));

  const stages: StageReport[] = new Array(plan.factories.length);
  for (const { f, idx } of ordered) {
    const s = SCHEMATICS.get(f.schematic)!;
    const cyclesPerHour = 3600 / s.cycleSeconds;
    // Routed cap first (game truth: routes partition inputs between groups),
    // then availability may push it lower.
    const routedCap = f.utilization ?? 1;
    let utilization = routedCap;
    let limitedBy: StageReport['limitedBy'] = 'capacity';
    for (const [input, perCycle] of Object.entries(s.inputs)) {
      const reqPerHour = f.count * perCycle * cyclesPerHour;
      const availNow = available.get(input) ?? 0;
      const u = reqPerHour === 0 ? routedCap : availNow / reqPerHour;
      if (u < utilization) {
        utilization = u;
        limitedBy = { input };
      }
    }
    utilization = Math.min(1, Math.max(0, utilization));
    if (utilization >= routedCap - 1e-12) limitedBy = 'capacity';
    for (const [input, perCycle] of Object.entries(s.inputs)) {
      const used = utilization * f.count * perCycle * cyclesPerHour;
      bump(consumed, input, used);
      bump(available, input, -used);
    }
    const out = utilization * f.count * s.outQty * cyclesPerHour;
    bump(produced, f.schematic, out);
    bump(available, f.schematic, out);
    stages[idx] = { schematic: f.schematic, count: f.count, utilization, outputPerHour: out, limitedBy };
  }

  const names = new Set<string>([...supplied.keys(), ...produced.keys(), ...consumed.keys()]);
  const perHour = new Map<string, CommodityFlow>();
  for (const name of names) {
    const sup = supplied.get(name) ?? 0;
    const pro = produced.get(name) ?? 0;
    const con = consumed.get(name) ?? 0;
    perHour.set(name, { supplied: sup, produced: pro, consumed: con, net: sup + pro - con });
  }
  return { perHour, stages, notes };
}

/** Exportable surplus in m³ per hour (what accumulates between visits). */
export function surplusM3PerHour(flow: FlowResult): number {
  let m3 = 0;
  for (const [name, f] of flow.perHour) {
    if (f.net > 0) m3 += f.net * TIER_VOLUME_M3[tierOf(name)];
  }
  return m3;
}

/**
 * Unattended runway: hours until `storageM3` fills at the current surplus
 * rate. QOL metric only — buffers never change steady-state throughput.
 * Infinite when nothing accumulates.
 */
export function runwayHours(flow: FlowResult, storageM3: number): number {
  if (!Number.isFinite(storageM3) || storageM3 < 0)
    throw new Error(`storageM3 must be >= 0, got ${storageM3}`);
  const rate = surplusM3PerHour(flow);
  return rate === 0 ? Infinity : storageM3 / rate;
}

export const HOURS_PER_WEEK = 168;

/** Weekly view of a commodity's net surplus. */
export function weeklyNet(flow: FlowResult, commodity: string): number {
  return (flow.perHour.get(commodity)?.net ?? 0) * HOURS_PER_WEEK;
}
