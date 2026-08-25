/**
 * THE constants & formulas spec — the only place game numbers live.
 * Every constant carries a SOURCE. Nothing elsewhere in the engine may
 * restate a game number; import it from here.
 *
 * Library references (docs/library/):
 *   10-extraction-mechanics.md, 11-facilities-and-chains.md,
 *   12-skills-and-limits.md, 13-market-mechanics.md, 16-equinox-skyhooks.md
 * Verification: 03-owner-formulas.md verdicts (2026-08-25).
 */

// ---------------------------------------------------------------------------
// Extraction (SOURCE: CCP developer docs, developers.eveonline.com/docs/guides/pi/)
// ---------------------------------------------------------------------------

/** Dogma attribute 1683. Hyperbolic decay of base yield over program time. */
export const DECAY_FACTOR = 0.012;
/** Dogma attribute 1687. Amplitude of the clamped-cosine "nugget" noise term. */
export const NOISE_FACTOR = 0.8;
/** All extraction time math is in units of 15 minutes (900 s). */
export const EXTRACTION_TIME_UNIT_S = 900;
/** Program duration bounds. SOURCE: UniWiki Planetary Industry. */
export const PROGRAM_MIN_HOURS = 1;
export const PROGRAM_MAX_HOURS = 336; // 14 days
/** Max extractor heads per ECU. SOURCE: UniWiki Planetary Buildings. */
export const MAX_HEADS_PER_ECU = 10;

/**
 * Cycle time as a step function of program length.
 * SOURCE: UniWiki ("doubles at 25 hours to 30 min, 50 hours to 1hr, 4d4h to 2hr, 8d8h to 4hr").
 * OPEN QUESTION (docs/OPEN-QUESTIONS.md #1): boundary inclusivity is unpublished.
 * Interpretation used: a program of exactly the boundary length keeps the shorter cycle.
 */
export const CYCLE_TIME_STEPS: ReadonlyArray<{ maxProgramHours: number; cycleSeconds: number }> = [
  { maxProgramHours: 25, cycleSeconds: 900 },
  { maxProgramHours: 50, cycleSeconds: 1800 },
  { maxProgramHours: 100, cycleSeconds: 3600 },
  { maxProgramHours: 200, cycleSeconds: 7200 },
  { maxProgramHours: 336, cycleSeconds: 14400 },
];

// ---------------------------------------------------------------------------
// Commodity tiers (SOURCE: SDE via EVE Ref, post-Viridian-2023 halved volumes;
// tax base values: CCP Rubicon dev blog + UniWiki Colony management)
// ---------------------------------------------------------------------------

export type Tier = 0 | 1 | 2 | 3 | 4;

/** m³ per unit. WARNING: many guides still carry the pre-2023 doubled values. */
export const TIER_VOLUME_M3: Readonly<Record<Tier, number>> = {
  0: 0.005,
  1: 0.19,
  2: 0.75,
  3: 3,
  4: 50,
};

/** Customs tax base cost in ISK per unit — tax basis is this, NEVER market price. */
export const TIER_TAX_BASE_ISK: Readonly<Record<Tier, number>> = {
  0: 5,
  1: 400,
  2: 7200,
  3: 60000,
  4: 1200000,
};

// ---------------------------------------------------------------------------
// Customs multipliers (SOURCE: UniWiki Colony management, verified by two
// independent player reports asserted in tests)
// ---------------------------------------------------------------------------

export const IMPORT_TAX_MULTIPLIER = 0.5;
export const CC_LAUNCH_TAX_MULTIPLIER = 1.5;
/** CC rocket launch: max volume and pickup window. SOURCE: UniWiki Colony management. */
export const CC_LAUNCH_MAX_M3 = 500;
export const CC_LAUNCH_PICKUP_DAYS = 5;
/** High-sec NPC ("Interbus"-era) base customs rate, reduced by Customs Code Expertise. */
export const NPC_HISEC_BASE_RATE = 0.10;
/** Customs Code Expertise: −10% of the NPC rate per level (V ⇒ 5%). SOURCE: CCP Rubicon blog. */
export const CUSTOMS_CODE_REDUCTION_PER_LEVEL = 0.10;

// ---------------------------------------------------------------------------
// Facilities (SOURCE: UniWiki Planetary Buildings)
// ---------------------------------------------------------------------------

export type FacilityKind =
  | 'commandCenter'
  | 'ecu'
  | 'extractorHead'
  | 'basic'
  | 'advanced'
  | 'hightech'
  | 'storage'
  | 'launchpad';

export interface FacilitySpec {
  readonly cpuTf: number;
  readonly pgMw: number;
  readonly priceIsk: number | null; // null = UNVERIFIED, do not price setup with it
  readonly capacityM3: number | null;
  readonly cycleSeconds: number | null;
}

export const FACILITY: Readonly<Record<FacilityKind, FacilitySpec>> = {
  // CC provides CPU/PG (see CC_LEVELS); its own consumption is 0. Purchase price
  // ~90k ISK is UNVERIFIED (library 11) — null until confirmed.
  commandCenter: { cpuTf: 0, pgMw: 0, priceIsk: null, capacityM3: 500, cycleSeconds: null },
  ecu: { cpuTf: 400, pgMw: 2600, priceIsk: 45000, capacityM3: null, cycleSeconds: null },
  extractorHead: { cpuTf: 110, pgMw: 550, priceIsk: 0, capacityM3: null, cycleSeconds: null },
  basic: { cpuTf: 200, pgMw: 800, priceIsk: 75000, capacityM3: null, cycleSeconds: 1800 },
  advanced: { cpuTf: 500, pgMw: 700, priceIsk: 250000, capacityM3: null, cycleSeconds: 3600 },
  hightech: { cpuTf: 1100, pgMw: 400, priceIsk: 525000, capacityM3: null, cycleSeconds: 3600 },
  storage: { cpuTf: 500, pgMw: 700, priceIsk: 250000, capacityM3: 12000, cycleSeconds: null },
  launchpad: { cpuTf: 3600, pgMw: 700, priceIsk: 900000, capacityM3: 10000, cycleSeconds: null },
};

/** Command Center provision by upgrade level. SOURCE: UniWiki Planetary Buildings. */
export const CC_LEVELS: ReadonlyArray<{ cpuTf: number; pgMw: number; upgradeCostIsk: number | null }> = [
  { cpuTf: 1675, pgMw: 6000, upgradeCostIsk: null },
  { cpuTf: 7057, pgMw: 9000, upgradeCostIsk: 580000 },
  { cpuTf: 12136, pgMw: 12000, upgradeCostIsk: 930000 },
  { cpuTf: 17215, pgMw: 15000, upgradeCostIsk: 1200000 },
  { cpuTf: 21315, pgMw: 17000, upgradeCostIsk: 1500000 },
  { cpuTf: 25415, pgMw: 19000, upgradeCostIsk: 2100000 },
];

/** Links. SOURCE: UniWiki Planetary Industry. cost(l km) = base + perKm × l. */
export const LINK_BASE_CPU_TF = 15;
export const LINK_CPU_TF_PER_KM = 0.2;
export const LINK_BASE_PG_MW = 10;
export const LINK_PG_MW_PER_KM = 0.15;
/** Link throughput doubles per upgrade level: 250 m³ (L0) … 256,000 m³ (L10). */
export const LINK_CAPACITY_M3 = (level: number): number => {
  if (!Number.isInteger(level) || level < 0 || level > 10)
    throw new Error(`Invalid link level: ${level} (0..10)`);
  return 250 * 2 ** level;
};
/**
 * OPEN QUESTION (docs/OPEN-QUESTIONS.md #3): CPU/PG cost scaling for UPGRADED
 * links is unverified. Engine uses base-level links until measured; the layout
 * validator refuses (by name) to price upgraded links rather than guessing.
 */
export const LINK_UPGRADE_COST_SCALING: null = null;

// ---------------------------------------------------------------------------
// Skills (SOURCE: UniWiki Skills / Planetary Industry; CCP Rubicon blog for CCE)
// ---------------------------------------------------------------------------

/** Interplanetary Consolidation: +1 planet per level; base 1, max 6 at V. PI is Omega-only. */
export const BASE_PLANETS_PER_CHARACTER = 1;
export const IC_PLANETS_PER_LEVEL = 1;
export const MAX_IC_LEVEL = 5;
/** Command Center Upgrades: CC upgrade level available = skill level (0..5). */
export const MAX_CCU_LEVEL = 5;
/** Remote Sensing: scan range in light-years by level (I..V). */
export const REMOTE_SENSING_RANGE_LY: ReadonlyArray<number> = [1, 3, 5, 7, 9];

// ---------------------------------------------------------------------------
// Market fees (SOURCE: library 13; patch 22.02 (2025-03-12) raised sales tax base)
// ---------------------------------------------------------------------------

/** Base sales tax before Accounting. */
export const SALES_TAX_BASE = 0.075;
/** Accounting: −11% of the base per level (V ⇒ 0.075 × 0.45 = 3.375%). */
export const ACCOUNTING_REDUCTION_PER_LEVEL = 0.11;
/** NPC-station broker fee: 3% − 0.3%/BrokerRelations − 0.03%/faction − 0.02%/corp standing; floor 1%. */
export const BROKER_BASE = 0.03;
export const BROKER_RELATIONS_REDUCTION_PER_LEVEL = 0.003;
export const BROKER_FACTION_STANDING_REDUCTION = 0.0003;
export const BROKER_CORP_STANDING_REDUCTION = 0.0002;
export const BROKER_FLOOR = 0.01;
/** Player-structure broker fee: fixed SCC part + owner-set part (skills do NOT apply). */
export const STRUCTURE_SCC_FEE = 0.005;

// ---------------------------------------------------------------------------
// Product scope (NOT game rules — engine limits chosen by the product)
// ---------------------------------------------------------------------------

/** Supported operation size. 1..50 characters, each modeled individually. */
export const MIN_CHARACTERS = 1;
export const MAX_CHARACTERS = 50;
