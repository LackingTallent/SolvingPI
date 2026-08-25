/**
 * Colony layout CPU/PG accounting. Layout is a VARIABLE (locked decision:
 * archetypes are presets, not physics) — this module answers "does it fit?"
 * for any layout, and refuses by name what it cannot price.
 */
import {
  CC_LEVELS, FACILITY, LINK_BASE_CPU_TF, LINK_BASE_PG_MW,
  LINK_CPU_TF_PER_KM, LINK_PG_MW_PER_KM, MAX_HEADS_PER_ECU,
} from '../spec/constants.js';

export interface LinkSpec {
  readonly lengthKm: number;
  /** Upgrade level 0..10. Levels > 0 cannot be CPU/PG-priced yet (OPEN-QUESTIONS #3). */
  readonly level: number;
}

export interface Layout {
  readonly ecus: number;
  readonly headsPerEcu: ReadonlyArray<number>; // one entry per ECU
  readonly basic: number;
  readonly advanced: number;
  readonly hightech: number;
  readonly storage: number;
  readonly launchpads: number;
  readonly links: ReadonlyArray<LinkSpec>;
}

const LAYOUT_KEYS = ['ecus', 'headsPerEcu', 'basic', 'advanced', 'hightech', 'storage', 'launchpads', 'links'] as const;

/**
 * Strict constructor: rejects unknown keys (the v8 pattern that silently lost
 * five settings is structurally impossible here) and validates counts.
 */
export function layout(spec: Layout): Layout {
  const unknown = Object.keys(spec).filter((k) => !(LAYOUT_KEYS as ReadonlyArray<string>).includes(k));
  if (unknown.length > 0) throw new Error(`layout(): unknown keys: ${unknown.join(', ')}`);
  for (const k of ['ecus', 'basic', 'advanced', 'hightech', 'storage', 'launchpads'] as const) {
    const v = spec[k];
    if (!Number.isInteger(v) || v < 0) throw new Error(`layout(): ${k} must be a non-negative integer, got ${v}`);
  }
  if (spec.headsPerEcu.length !== spec.ecus)
    throw new Error(`layout(): headsPerEcu has ${spec.headsPerEcu.length} entries for ${spec.ecus} ECU(s)`);
  for (const h of spec.headsPerEcu) {
    if (!Number.isInteger(h) || h < 1 || h > MAX_HEADS_PER_ECU)
      throw new Error(`layout(): heads per ECU must be 1..${MAX_HEADS_PER_ECU}, got ${h}`);
  }
  for (const l of spec.links) {
    if (!(l.lengthKm >= 0) || !Number.isFinite(l.lengthKm))
      throw new Error(`layout(): link length must be >= 0 km, got ${l.lengthKm}`);
    if (!Number.isInteger(l.level) || l.level < 0 || l.level > 10)
      throw new Error(`layout(): link level must be 0..10, got ${l.level}`);
  }
  return spec;
}

export function linkCpuTf(l: LinkSpec): number {
  if (l.level !== 0)
    throw new Error(`Cannot price CPU for link level ${l.level}: upgrade scaling unverified (OPEN-QUESTIONS #3)`);
  return LINK_BASE_CPU_TF + LINK_CPU_TF_PER_KM * l.lengthKm;
}

export function linkPgMw(l: LinkSpec): number {
  if (l.level !== 0)
    throw new Error(`Cannot price PG for link level ${l.level}: upgrade scaling unverified (OPEN-QUESTIONS #3)`);
  return LINK_BASE_PG_MW + LINK_PG_MW_PER_KM * l.lengthKm;
}

export interface CpuPg {
  readonly cpuTf: number;
  readonly pgMw: number;
}

export function layoutDemand(l: Layout): CpuPg {
  const heads = l.headsPerEcu.reduce((a, b) => a + b, 0);
  const cpuTf =
    l.ecus * FACILITY.ecu.cpuTf +
    heads * FACILITY.extractorHead.cpuTf +
    l.basic * FACILITY.basic.cpuTf +
    l.advanced * FACILITY.advanced.cpuTf +
    l.hightech * FACILITY.hightech.cpuTf +
    l.storage * FACILITY.storage.cpuTf +
    l.launchpads * FACILITY.launchpad.cpuTf +
    l.links.reduce((a, x) => a + linkCpuTf(x), 0);
  const pgMw =
    l.ecus * FACILITY.ecu.pgMw +
    heads * FACILITY.extractorHead.pgMw +
    l.basic * FACILITY.basic.pgMw +
    l.advanced * FACILITY.advanced.pgMw +
    l.hightech * FACILITY.hightech.pgMw +
    l.storage * FACILITY.storage.pgMw +
    l.launchpads * FACILITY.launchpad.pgMw +
    l.links.reduce((a, x) => a + linkPgMw(x), 0);
  return { cpuTf, pgMw };
}

export interface FitResult {
  readonly fits: boolean;
  readonly demand: CpuPg;
  readonly supply: CpuPg;
  /** Named reasons; empty iff fits. No silent failures. */
  readonly why: ReadonlyArray<string>;
}

export function fitsCommandCenter(l: Layout, ccLevel: number): FitResult {
  const cc = CC_LEVELS[ccLevel];
  if (cc === undefined) throw new Error(`Invalid CC level: ${ccLevel} (0..${CC_LEVELS.length - 1})`);
  const demand = layoutDemand(l);
  const why: string[] = [];
  if (demand.cpuTf > cc.cpuTf) why.push(`cpu-exceeded: needs ${demand.cpuTf} tf, CC L${ccLevel} provides ${cc.cpuTf} tf`);
  if (demand.pgMw > cc.pgMw) why.push(`pg-exceeded: needs ${demand.pgMw} MW, CC L${ccLevel} provides ${cc.pgMw} MW`);
  return { fits: why.length === 0, demand, supply: { cpuTf: cc.cpuTf, pgMw: cc.pgMw }, why };
}

/** Classic archetype presets (locked decision: presets, not physics). */
export const ARCHETYPES = {
  extraction: layout({
    ecus: 1, headsPerEcu: [10], basic: 8, advanced: 0, hightech: 0, storage: 0, launchpads: 1,
    links: Array.from({ length: 10 }, () => ({ lengthKm: 0, level: 0 })),
  }),
  factory: layout({
    ecus: 0, headsPerEcu: [], basic: 0, advanced: 24, hightech: 0, storage: 1, launchpads: 1,
    links: Array.from({ length: 26 }, () => ({ lengthKm: 0, level: 0 })),
  }),
  hightech: layout({
    ecus: 0, headsPerEcu: [], basic: 0, advanced: 0, hightech: 16, storage: 1, launchpads: 1,
    links: Array.from({ length: 18 }, () => ({ lengthKm: 0, level: 0 })),
  }),
} as const;
