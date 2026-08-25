/**
 * Exact chain requirements: what a target production rate demands, tier by
 * tier, with per-input sourcing. Pure math over the schematic data — facility
 * rates are DERIVED from SCHEMATICS (v8 hardcoded P3 throughput to the P2
 * constant and under-counted 1.67×; deriving makes that bug inexpressible).
 *
 * Sourcing per P1 input (Ryan's three-way model, verified in library 03):
 *   'extract' — mine the P0 locally (needs planets carrying it)
 *   'refine'  — buy the P0, refine in an extractor-less colony (150:1 ore)
 *   'buy'     — buy the finished P1 (no colony at all)
 */
import { P1_FROM_P0, SCHEMATICS, tierOf } from '../spec/schematics.js';

export type Sourcing = 'extract' | 'refine' | 'buy';

export const P0_PER_P1 = 150; // 3000 in / 20 out, derived-checked in tests

/** Weekly output of ONE facility running this schematic. Derived, never typed. */
export function weeklyPerFacility(schematic: string): number {
  const s = SCHEMATICS.get(schematic);
  if (s === undefined) throw new Error(`Unknown schematic: "${schematic}"`);
  return s.outQty * ((168 * 3600) / s.cycleSeconds);
}

/** The P0 that refines into this P1. */
export function oreOf(p1: string): string {
  for (const [p0, p1name] of Object.entries(P1_FROM_P0)) if (p1name === p1) return p0;
  throw new Error(`Not a P1 commodity: "${p1}"`);
}

/** All P1 commodities in the chain of `product` (the sourcing decision set). */
export function p1InputsOf(product: string): ReadonlyArray<string> {
  const tier = tierOf(product);
  if (tier === 0) throw new Error(`chain-target-invalid: "${product}" is a raw P0 — refine it or sell it raw, but it has no chain`);
  const out = new Set<string>();
  const walk = (name: string): void => {
    if (tierOf(name) === 1) { out.add(name); return; }
    for (const input of Object.keys(SCHEMATICS.get(name)!.inputs)) {
      if (tierOf(input) === 0) continue; // P1 schematic's own P0 input
      walk(input);
    }
  };
  walk(product);
  return [...out].sort();
}

export interface ChainNeeds {
  readonly product: string;
  readonly ratePerWeek: number;
  /** Total P1 of each type flowing through the chain per week. */
  readonly p1PerWeek: Readonly<Record<string, number>>;
  /** Fractional facility counts required (advanced hosts P2 AND P3 stages). */
  readonly advancedFacilities: number;
  readonly htFacilities: number;
  /** Market purchases per week implied by sourcing ('buy' P1s + ore for 'refine'). */
  readonly purchasesPerWeek: Readonly<Record<string, number>>;
  /** P1 to produce in refinery colonies (imported ore, no extractor). */
  readonly refineP1PerWeek: Readonly<Record<string, number>>;
  /** P1 to extract from the ground. */
  readonly extractP1PerWeek: Readonly<Record<string, number>>;
  /** Weekly output required from every tier>=2 schematic in the chain. */
  readonly outputsPerWeek: Readonly<Record<string, number>>;
}

/**
 * Requirements to produce `ratePerWeek` of `product`.
 * `sourcing` must cover EXACTLY the chain's P1 set — missing or extra keys
 * throw by name (v8's silently-defaulted options are inexpressible).
 */
export function chainNeeds(
  product: string,
  ratePerWeek: number,
  sourcing: Readonly<Record<string, Sourcing>>,
): ChainNeeds {
  if (!Number.isFinite(ratePerWeek) || ratePerWeek < 0)
    throw new Error(`ratePerWeek must be >= 0, got ${ratePerWeek}`);
  const tier = tierOf(product);
  if (tier === 0) throw new Error(`chain-target-invalid: "${product}" is a raw P0`);

  const p1Set = p1InputsOf(product);
  const missing = p1Set.filter((p) => !(p in sourcing));
  if (missing.length > 0) throw new Error(`sourcing-missing: no sourcing chosen for ${missing.join(', ')}`);
  const extra = Object.keys(sourcing).filter((p) => !p1Set.includes(p));
  if (extra.length > 0) throw new Error(`sourcing-extra: ${extra.join(', ')} are not P1 inputs of ${product}`);
  for (const [k, v] of Object.entries(sourcing)) {
    if (v !== 'extract' && v !== 'refine' && v !== 'buy')
      throw new Error(`sourcing-invalid: unknown mode "${String(v)}" for ${k}`);
  }
  if (tier === 1 && sourcing[product] === 'buy')
    throw new Error(`sourcing-invalid: buying the target product "${product}" is not production`);

  // Walk the chain top-down, accumulating weekly quantities per commodity.
  const need = new Map<string, number>([[product, ratePerWeek]]);
  let advancedFacilities = 0;
  let htFacilities = 0;
  for (let t = 4; t >= 2; t--) {
    for (const [name, qty] of [...need]) {
      if (tierOf(name) !== t || qty === 0) continue;
      const s = SCHEMATICS.get(name)!;
      const perFac = weeklyPerFacility(name);
      if (s.facility === 'hightech') htFacilities += qty / perFac;
      else advancedFacilities += qty / perFac;
      for (const [input, perCycle] of Object.entries(s.inputs)) {
        need.set(input, (need.get(input) ?? 0) + qty * (perCycle / s.outQty));
      }
    }
  }

  const outputsPerWeek: Record<string, number> = {};
  for (const [name, qty] of need) {
    if (tierOf(name) >= 2 && qty > 0) outputsPerWeek[name] = qty;
  }

  const p1PerWeek: Record<string, number> = {};
  const purchasesPerWeek: Record<string, number> = {};
  const refineP1PerWeek: Record<string, number> = {};
  const extractP1PerWeek: Record<string, number> = {};
  for (const [name, qty] of need) {
    if (tierOf(name) !== 1 || qty === 0) continue;
    p1PerWeek[name] = qty;
    const mode = sourcing[name]!;
    if (mode === 'buy') {
      purchasesPerWeek[name] = (purchasesPerWeek[name] ?? 0) + qty;
    } else if (mode === 'refine') {
      refineP1PerWeek[name] = qty;
      const ore = oreOf(name);
      purchasesPerWeek[ore] = (purchasesPerWeek[ore] ?? 0) + qty * P0_PER_P1;
    } else {
      extractP1PerWeek[name] = qty;
    }
  }

  return { product, ratePerWeek, p1PerWeek, advancedFacilities, htFacilities, purchasesPerWeek, refineP1PerWeek, extractP1PerWeek, outputsPerWeek };
}
