/**
 * The feasibility judge. Solvers PROPOSE; this module DISPOSES.
 *
 * validatePlan() takes a complete operation plan and checks every hard
 * constraint of the game, returning pass/fail with NAMED violations. It never
 * optimizes, never prices, never mutates, and never approves its own caller's
 * work — proposer/judge separation is the concrete lesson v8 proved twice
 * (its dealer ignored per-character caps; only the judge caught it).
 *
 * Judged BEFORE any solver exists (Gate 3), so no proposer can ever ship a
 * plan the judge has not learned to reject.
 *
 * Known limitation, stated plainly (inherited honestly from v8's docs): the
 * judge reads the same physics spec the engine does. It proves a plan LEGAL,
 * not that the physics is right — the spec itself is verified separately
 * (docs/library/03, tests).
 */
import { PROGRAM_MAX_HOURS, PROGRAM_MIN_HOURS, CC_LEVELS } from '../spec/constants.js';
import { SCHEMATICS } from '../spec/schematics.js';
import { canBuildHighTech, isPlanetType, spawnsOn, type PlanetType } from '../world/planets.js';
import { fitsCommandCenter, layout, type Layout } from '../world/facilities.js';
import { maxPlanets, operation, type Operation } from '../world/characters.js';
import { colonyPlan, steadyState, type ColonyPlan } from './flow.js';

export interface PlannedColony {
  readonly id: string;
  readonly characterName: string;
  readonly planetName: string; // e.g. "1IX-C0 III" — identity for one-colony-per-char-per-planet
  readonly planetType: PlanetType;
  readonly ccLevel: number;
  readonly layout: Layout;
  readonly plan: ColonyPlan;
}

export interface OperationLogistics {
  /** Market purchases feeding imports, per commodity per hour. */
  readonly purchases: ReadonlyArray<{ readonly commodity: string; readonly qtyPerHour: number }>;
}

export interface OperationPlan {
  readonly operation: Operation;
  readonly colonies: ReadonlyArray<PlannedColony>;
  readonly logistics?: OperationLogistics;
}

export interface Violation {
  readonly rule: string;        // stable rule id, e.g. 'char-capacity'
  readonly colonyId: string | null;
  readonly message: string;
}

export interface Verdict {
  readonly legal: boolean;
  readonly violations: ReadonlyArray<Violation>;
  /** Modeling disclosures (e.g. aggregate material balance, not per-route). */
  readonly notes: ReadonlyArray<string>;
}

const COLONY_KEYS = ['id', 'characterName', 'planetName', 'planetType', 'ccLevel', 'layout', 'plan'] as const;
const PLAN_KEYS = ['operation', 'colonies', 'logistics'] as const;
const LOGISTICS_KEYS = ['purchases'] as const;

export function validatePlan(opPlan: OperationPlan): Verdict {
  const v: Violation[] = [];
  const notes: string[] = [
    'material-balance is checked as an operation-wide aggregate per commodity, not per haul route',
  ];
  const push = (rule: string, colonyId: string | null, message: string) => v.push({ rule, colonyId, message });

  { // plan envelope
    const unknown = Object.keys(opPlan).filter((k) => !(PLAN_KEYS as ReadonlyArray<string>).includes(k));
    if (unknown.length > 0) push('plan-shape', null, `unknown keys on operation plan: ${unknown.join(', ')}`);
  }
  if (opPlan.logistics !== undefined) {
    const unknown = Object.keys(opPlan.logistics).filter((k) => !(LOGISTICS_KEYS as ReadonlyArray<string>).includes(k));
    if (unknown.length > 0) push('plan-shape', null, `unknown keys on logistics: ${unknown.join(', ')}`);
  }

  // Operation validity (1..50 chars, unique names, skill bounds)
  let op: Operation | null = null;
  try {
    op = operation(opPlan.operation.characters);
  } catch (e) {
    push('operation-invalid', null, (e as Error).message);
  }

  const seenIds = new Set<string>();
  const perCharCount = new Map<string, number>();
  const perCharPlanets = new Map<string, Set<string>>();

  for (const c of opPlan.colonies) {
    const unknown = Object.keys(c).filter((k) => !(COLONY_KEYS as ReadonlyArray<string>).includes(k));
    if (unknown.length > 0) push('colony-shape', c.id ?? null, `unknown keys on colony: ${unknown.join(', ')}`);

    if (typeof c.id !== 'string' || c.id.length === 0) {
      push('colony-id-invalid', null, 'colony id must be a non-empty string');
      continue;
    }
    if (seenIds.has(c.id)) push('colony-id-duplicate', c.id, `duplicate colony id "${c.id}"`);
    seenIds.add(c.id);

    // Character rules
    const chr = op?.characters.find((x) => x.name === c.characterName);
    if (op !== null && chr === undefined) {
      push('char-unknown', c.id, `colony owner "${c.characterName}" is not in the operation`);
    }
    perCharCount.set(c.characterName, (perCharCount.get(c.characterName) ?? 0) + 1);
    const planets = perCharPlanets.get(c.characterName) ?? new Set<string>();
    if (planets.has(c.planetName)) {
      push('char-duplicate-planet', c.id,
        `"${c.characterName}" already has a colony on ${c.planetName} — one colony per character per planet`);
    }
    planets.add(c.planetName);
    perCharPlanets.set(c.characterName, planets);

    // CC rules
    if (!Number.isInteger(c.ccLevel) || c.ccLevel < 0 || c.ccLevel >= CC_LEVELS.length) {
      push('cc-level-invalid', c.id, `ccLevel must be 0..${CC_LEVELS.length - 1}, got ${c.ccLevel}`);
    } else if (chr !== undefined && c.ccLevel > chr.ccuLevel) {
      push('cc-skill', c.id,
        `ccLevel ${c.ccLevel} needs Command Center Upgrades ${c.ccLevel}; "${chr.name}" has ${chr.ccuLevel}`);
    }

    // Planet type
    if (!isPlanetType(c.planetType)) {
      push('planet-type-invalid', c.id, `unknown planet type "${String(c.planetType)}"`);
      continue; // dependent checks below need a real type
    }

    // Layout validity + CPU/PG fit
    let lay: Layout | null = null;
    try {
      lay = layout(c.layout);
    } catch (e) {
      push('layout-invalid', c.id, (e as Error).message);
    }
    if (lay !== null && Number.isInteger(c.ccLevel) && c.ccLevel >= 0 && c.ccLevel < CC_LEVELS.length) {
      const fit = fitsCommandCenter(lay, c.ccLevel);
      for (const why of fit.why) {
        push(why.startsWith('cpu') ? 'cpu-exceeded' : 'pg-exceeded', c.id, why);
      }
    }

    // Flow plan validity
    let plan: ColonyPlan | null = null;
    try {
      plan = colonyPlan(c.plan);
    } catch (e) {
      push('plan-invalid', c.id, (e as Error).message);
    }
    if (plan === null || lay === null) continue;

    // Extraction rules
    if (plan.extractors.length > lay.ecus) {
      push('ecu-capacity', c.id,
        `${plan.extractors.length} extraction program(s) need ${plan.extractors.length} ECU(s); layout has ${lay.ecus}`);
    }
    for (const e of plan.extractors) {
      if (!spawnsOn(e.resource, c.planetType)) {
        push('resource-not-on-planet', c.id, `${e.resource} does not spawn on ${c.planetType} planets`);
      }
      if (!Number.isFinite(e.w) || e.w <= 0) {
        push('w-invalid', c.id, `extractor ${e.resource}: qty_per_cycle must be > 0, got ${e.w}`);
      }
      if (!Number.isFinite(e.programHours) || e.programHours < PROGRAM_MIN_HOURS || e.programHours > PROGRAM_MAX_HOURS) {
        push('program-bounds', c.id,
          `extractor ${e.resource}: program must be ${PROGRAM_MIN_HOURS}..${PROGRAM_MAX_HOURS}h, got ${e.programHours}`);
      }
    }

    // Factory capacity by kind + planet legality
    const wanted = { basic: 0, advanced: 0, hightech: 0 };
    for (const f of plan.factories) {
      const s = SCHEMATICS.get(f.schematic)!;
      wanted[s.facility] += f.count;
    }
    if (wanted.basic > lay.basic)
      push('facility-capacity-basic', c.id, `plan runs ${wanted.basic} basic facilities; layout has ${lay.basic}`);
    if (wanted.advanced > lay.advanced)
      push('facility-capacity-advanced', c.id, `plan runs ${wanted.advanced} advanced facilities; layout has ${lay.advanced}`);
    if (wanted.hightech > lay.hightech)
      push('facility-capacity-hightech', c.id, `plan runs ${wanted.hightech} high-tech plants; layout has ${lay.hightech}`);
    if (wanted.hightech > 0 && !canBuildHighTech(c.planetType))
      push('hightech-planet-illegal', c.id, `high-tech plants are legal only on Barren/Temperate; this is ${c.planetType}`);

    // Imports require a customs interface on the ground
    if (plan.imports.length > 0 && lay.launchpads < 1)
      push('import-without-launchpad', c.id, 'imports require at least one launchpad (CC launch is export-only)');
  }

  // Per-character planet budget
  if (op !== null) {
    for (const [name, count] of perCharCount) {
      const chr = op.characters.find((x) => x.name === name);
      if (chr !== undefined && count > maxPlanets(chr)) {
        push('char-capacity', null,
          `"${name}" has ${count} colonies; Interplanetary Consolidation ${chr.icLevel} allows ${maxPlanets(chr)}`);
      }
    }
  }

  // Operation-wide material balance: imports must be backed by purchases or
  // other colonies' own production surplus (aggregate per commodity).
  {
    const purchased = new Map<string, number>();
    for (const p of opPlan.logistics?.purchases ?? []) {
      if (!Number.isFinite(p.qtyPerHour) || p.qtyPerHour < 0) {
        push('purchase-invalid', null, `purchase ${p.commodity}: qtyPerHour must be >= 0, got ${p.qtyPerHour}`);
        continue;
      }
      purchased.set(p.commodity, (purchased.get(p.commodity) ?? 0) + p.qtyPerHour);
    }
    const imported = new Map<string, number>();
    const ownSurplus = new Map<string, number>();
    for (const c of opPlan.colonies) {
      let flow;
      try {
        flow = steadyState(c.plan);
      } catch {
        continue; // already reported as plan-invalid
      }
      for (const i of c.plan.imports) imported.set(i.commodity, (imported.get(i.commodity) ?? 0) + i.qtyPerHour);
      for (const [name, f] of flow.perHour) {
        const importsOf = c.plan.imports.filter((x) => x.commodity === name).reduce((a, x) => a + x.qtyPerHour, 0);
        const own = f.net - importsOf; // production surplus excluding phantom imports
        if (own > 0) ownSurplus.set(name, (ownSurplus.get(name) ?? 0) + own);
      }
    }
    for (const [commodity, qty] of imported) {
      const backing = (purchased.get(commodity) ?? 0) + (ownSurplus.get(commodity) ?? 0);
      if (qty > backing + 1e-9) {
        push('material-balance', null,
          `${commodity}: ${qty}/h imported but only ${backing}/h backed by purchases + other colonies' surplus`);
      }
    }
  }

  return { legal: v.length === 0, violations: v, notes };
}

/** All rule ids the judge can emit — the adversarial suite covers every one. */
export const RULE_IDS = [
  'plan-shape', 'operation-invalid', 'colony-shape', 'colony-id-invalid', 'colony-id-duplicate',
  'char-unknown', 'char-duplicate-planet', 'char-capacity',
  'cc-level-invalid', 'cc-skill',
  'planet-type-invalid', 'resource-not-on-planet', 'hightech-planet-illegal',
  'layout-invalid', 'cpu-exceeded', 'pg-exceeded',
  'plan-invalid', 'ecu-capacity', 'w-invalid', 'program-bounds',
  'facility-capacity-basic', 'facility-capacity-advanced', 'facility-capacity-hightech',
  'import-without-launchpad', 'purchase-invalid', 'material-balance',
] as const;
