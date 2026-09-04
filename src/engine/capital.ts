/**
 * CAPITAL COST (T-14 fix, owner 2026-09-03 "fix it so it does what it is
 * supposed to"): the one-time ISK to STAND UP a plan's colonies, which the
 * weekly ledger deliberately excludes (steady-state net is a rate; setup is
 * a stock). Computed from the ACTUAL built plan — each colony's command
 * center purchase, its cumulative CC upgrades to the level the plan runs at,
 * and every facility at its game price. Sources: FACILITY/CC_LEVELS in
 * src/spec/constants.ts (UniWiki Planetary Buildings; CC purchase 81,000 ISK
 * NPC-seeded, verified vs EVE University 2026-09-03). Links and extractor
 * heads cost no ISK in game. Payback = capital / weekly net.
 */
import { CC_LEVELS, FACILITY } from '../spec/constants.js';
import type { PlanetType } from '../spec/schematics.js';
import type { OperationPlan } from './judge.js';

export interface CapitalLine {
  readonly label: string;
  readonly count: number;
  readonly isk: number;
}

export interface CapitalBreakdown {
  readonly totalIsk: number;
  readonly colonies: number;
  readonly lines: ReadonlyArray<CapitalLine>;
  /** How many colonies' command centers were priced from a LIVE market quote
   * (vs the NPC-seed fallback) — so the UI can say which it showed. */
  readonly ccLivePriced: number;
}

const CC_PURCHASE_ISK = FACILITY.commandCenter.priceIsk ?? 0;

/** Cumulative CC upgrade cost from level 0 to `level`. */
export function ccUpgradeIskTo(level: number): number {
  let sum = 0;
  for (let l = 1; l <= level && l < CC_LEVELS.length; l++) sum += CC_LEVELS[l]!.upgradeCostIsk ?? 0;
  return sum;
}

/**
 * @param ccAskOf live Jita ask for a planet type's Command Center (owner
 * 2026-09-03: CC prices pulled from ESI). null/undefined per type — or no
 * function at all — falls back to the 81,000 ISK NPC seed. Facility and
 * upgrade charges are fixed game costs, not market items — never "live".
 */
export function capitalCost(plan: OperationPlan, ccAskOf?: (type: PlanetType) => number | null): CapitalBreakdown {
  let cc = 0, upgrades = 0, ecus = 0, basics = 0, advanced = 0, hightech = 0, storage = 0, launchpads = 0;
  let ccLivePriced = 0;
  for (const c of plan.colonies) {
    const live = ccAskOf?.(c.planetType) ?? null;
    if (live !== null && Number.isFinite(live) && live > 0) { cc += live; ccLivePriced++; }
    else cc += CC_PURCHASE_ISK;
    upgrades += ccUpgradeIskTo(c.ccLevel);
    ecus += c.layout.ecus;
    basics += c.layout.basic;
    advanced += c.layout.advanced;
    hightech += c.layout.hightech;
    storage += c.layout.storage;
    launchpads += c.layout.launchpads;
  }
  const lines: CapitalLine[] = [
    {
      label: ccLivePriced === plan.colonies.length && plan.colonies.length > 0
        ? 'Command centers (live Jita sell prices)'
        : ccLivePriced > 0
          ? `Command centers (${ccLivePriced} at live Jita prices, ${plan.colonies.length - ccLivePriced} at the 81,000 ISK NPC seed)`
          : 'Command centers (81,000 ISK each, NPC seed — fetch prices for live quotes)',
      count: plan.colonies.length, isk: cc,
    },
    { label: 'CC upgrades (cumulative to each colony’s level)', count: plan.colonies.length, isk: upgrades },
    { label: 'Extractor control units', count: ecus, isk: ecus * (FACILITY.ecu.priceIsk ?? 0) },
    { label: 'Basic industry facilities', count: basics, isk: basics * (FACILITY.basic.priceIsk ?? 0) },
    { label: 'Advanced industry facilities', count: advanced, isk: advanced * (FACILITY.advanced.priceIsk ?? 0) },
    { label: 'High-tech production plants', count: hightech, isk: hightech * (FACILITY.hightech.priceIsk ?? 0) },
    { label: 'Storage facilities', count: storage, isk: storage * (FACILITY.storage.priceIsk ?? 0) },
    { label: 'Launchpads', count: launchpads, isk: launchpads * (FACILITY.launchpad.priceIsk ?? 0) },
  ].filter((l) => l.count > 0);
  return {
    totalIsk: lines.reduce((a, l) => a + l.isk, 0),
    colonies: plan.colonies.length,
    lines,
    ccLivePriced,
  };
}
