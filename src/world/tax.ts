/**
 * Customs and market-fee rules. Customs taxes the CCP-set BASE COST per tier —
 * never market value. SOURCE: UniWiki Colony management; CCP Rubicon blog;
 * skyhooks charge like POCOs with an owner-set rate and no NPC component
 * (library 16 — POCO tax settings were copied onto replacing skyhooks in 2024).
 */
import {
  ACCOUNTING_REDUCTION_PER_LEVEL, BROKER_BASE, BROKER_CORP_STANDING_REDUCTION,
  BROKER_FACTION_STANDING_REDUCTION, BROKER_FLOOR, BROKER_RELATIONS_REDUCTION_PER_LEVEL,
  CC_LAUNCH_TAX_MULTIPLIER, CUSTOMS_CODE_REDUCTION_PER_LEVEL, IMPORT_TAX_MULTIPLIER,
  NPC_HISEC_BASE_RATE, SALES_TAX_BASE, STRUCTURE_SCC_FEE, TIER_TAX_BASE_ISK, type Tier,
} from '../spec/constants.js';
import { isk, type ISK, type Qty } from '../units.js';

export type CustomsDirection = 'export' | 'import';
export type ExportRoute = 'customsOffice' | 'commandCenterLaunch';

export interface CustomsContext {
  /** Owner-set rate at the POCO/skyhook, as a fraction (0.10 = 10%). */
  readonly ownerRate: number;
  /** True only for high-sec NPC-influenced offices; adds the NPC component. */
  readonly hisecNpc: boolean;
  /** Customs Code Expertise level of the paying character (0..5). */
  readonly customsCodeLevel: number;
}

function checkRate(rate: number, what: string): number {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1)
    throw new Error(`${what} must be a fraction 0..1, got ${rate}`);
  return rate;
}

/** NPC hisec component: 10% reduced by 10% of itself per CCE level (V → 5%). */
export function npcHisecRate(customsCodeLevel: number): number {
  if (!Number.isInteger(customsCodeLevel) || customsCodeLevel < 0 || customsCodeLevel > 5)
    throw new Error(`customsCodeLevel must be 0..5, got ${customsCodeLevel}`);
  return NPC_HISEC_BASE_RATE * (1 - CUSTOMS_CODE_REDUCTION_PER_LEVEL * customsCodeLevel);
}

/** Effective customs rate: owner rate plus (hisec only) the NPC component. */
export function effectiveCustomsRate(ctx: CustomsContext): number {
  checkRate(ctx.ownerRate, 'ownerRate');
  return ctx.ownerRate + (ctx.hisecNpc ? npcHisecRate(ctx.customsCodeLevel) : 0);
}

/**
 * Customs fee for moving `units` of a tier through customs.
 * export: base × rate (× 1.5 when launched from the Command Center)
 * import: base × rate × 0.5
 */
export function customsFee(
  tier: Tier,
  units: Qty,
  direction: CustomsDirection,
  ctx: CustomsContext,
  route: ExportRoute = 'customsOffice',
): ISK {
  const rate = effectiveCustomsRate(ctx);
  const base = TIER_TAX_BASE_ISK[tier];
  if (direction === 'import') {
    if (route === 'commandCenterLaunch') throw new Error('CC launch is export-only');
    return isk(base * rate * IMPORT_TAX_MULTIPLIER * units);
  }
  const mult = route === 'commandCenterLaunch' ? CC_LAUNCH_TAX_MULTIPLIER : 1;
  return isk(base * rate * mult * units);
}

/** Sales tax rate after Accounting: 7.5% × (1 − 0.11 × level). Patch 22.02 (2025-03-12). */
export function salesTaxRate(accountingLevel: number): number {
  if (!Number.isInteger(accountingLevel) || accountingLevel < 0 || accountingLevel > 5)
    throw new Error(`accountingLevel must be 0..5, got ${accountingLevel}`);
  return SALES_TAX_BASE * (1 - ACCOUNTING_REDUCTION_PER_LEVEL * accountingLevel);
}

export interface NpcBrokerContext {
  readonly brokerRelationsLevel: number;
  readonly factionStanding: number; // -10..10
  readonly corpStanding: number;    // -10..10
}

/** NPC-station broker fee: 3% − 0.3%/level − 0.03%/faction − 0.02%/corp, floored at 1%. */
export function npcBrokerRate(ctx: NpcBrokerContext): number {
  if (!Number.isInteger(ctx.brokerRelationsLevel) || ctx.brokerRelationsLevel < 0 || ctx.brokerRelationsLevel > 5)
    throw new Error(`brokerRelationsLevel must be 0..5, got ${ctx.brokerRelationsLevel}`);
  for (const [k, v] of [['factionStanding', ctx.factionStanding], ['corpStanding', ctx.corpStanding]] as const) {
    if (!Number.isFinite(v) || v < -10 || v > 10) throw new Error(`${k} must be -10..10, got ${v}`);
  }
  const rate =
    BROKER_BASE -
    BROKER_RELATIONS_REDUCTION_PER_LEVEL * ctx.brokerRelationsLevel -
    BROKER_FACTION_STANDING_REDUCTION * ctx.factionStanding -
    BROKER_CORP_STANDING_REDUCTION * ctx.corpStanding;
  return Math.max(rate, BROKER_FLOOR);
}

/** Player-structure broker fee: fixed SCC part + owner-set part; skills do not apply. */
export function structureBrokerRate(ownerRate: number): number {
  checkRate(ownerRate, 'structure ownerRate');
  return STRUCTURE_SCC_FEE + ownerRate;
}
