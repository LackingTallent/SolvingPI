/**
 * THE ledger. Every ISK figure anywhere in the product reconciles to this one
 * function. Two numbers claiming to be "profit" in different tabs MUST come
 * from here — duplicate ledgers are how v8 shipped tooltips contradicting
 * their own totals.
 *
 *   net = gross sales
 *       − sales tax − broker fees (sales + resting buys)
 *       − customs − freight − purchase cost
 *
 * Price basis is EXPLICIT on every line (v8 priced purchases off the wrong
 * side of the book because the side was implicit):
 *   'immediate' — hit existing orders: sells at best bid / buys at best ask;
 *                 pays NO broker fee.
 *   'patient'   — rest an order:      sells at ask / buys at bid;
 *                 pays the broker fee.
 * The caller supplies the unit price for the basis it declares; the data layer
 * is responsible for handing over the correct side's price for that basis.
 *
 * Invariant (asserted in tests, forever): with every cost zero,
 * net === gross EXACTLY. Losses are negative numbers, never floored.
 */
import { isk, type ISK, type IskPerM3, type IskPerQty, type M3, type Qty } from '../units.js';
import { customsFee, type CustomsContext, type CustomsDirection, type ExportRoute } from '../world/tax.js';
import type { Tier } from '../spec/constants.js';

export type PriceBasis = 'immediate' | 'patient';

export interface SaleLine {
  readonly commodity: string;
  readonly qty: Qty;
  readonly unitPrice: IskPerQty;
  readonly basis: PriceBasis;
}

export interface PurchaseLine {
  readonly commodity: string;
  readonly qty: Qty;
  readonly unitPrice: IskPerQty;
  readonly basis: PriceBasis;
}

export interface CustomsEvent {
  readonly label: string;
  readonly tier: Tier;
  readonly qty: Qty;
  readonly direction: CustomsDirection;
  readonly ctx: CustomsContext;
  readonly route?: ExportRoute;
}

export interface FreightLeg {
  readonly label: string;
  readonly volumeM3: M3;
  readonly ratePerM3: IskPerM3;
}

export interface FeeRates {
  /** Fraction, e.g. 0.03375 for Accounting V. Applied to every sale. */
  readonly salesTaxRate: number;
  /** Fraction. Applied only to 'patient' lines (resting orders). */
  readonly brokerRate: number;
}

export interface LedgerInput {
  readonly sales: ReadonlyArray<SaleLine>;
  readonly purchases: ReadonlyArray<PurchaseLine>;
  readonly customs: ReadonlyArray<CustomsEvent>;
  readonly freight: ReadonlyArray<FreightLeg>;
  readonly fees: FeeRates;
}

export interface LedgerLine {
  readonly label: string;
  readonly isk: ISK; // negative = cost
}

export interface LedgerResult {
  readonly gross: ISK;
  readonly salesTax: ISK;
  readonly broker: ISK;
  readonly customs: ISK;
  readonly freight: ISK;
  readonly purchases: ISK;
  readonly net: ISK;
  /** Full labeled breakdown; sums exactly to net. */
  readonly lines: ReadonlyArray<LedgerLine>;
}

const INPUT_KEYS = ['sales', 'purchases', 'customs', 'freight', 'fees'] as const;
const TRADE_KEYS = ['commodity', 'qty', 'unitPrice', 'basis'] as const;
const CUSTOMS_KEYS = ['label', 'tier', 'qty', 'direction', 'ctx', 'route'] as const;
const FREIGHT_KEYS = ['label', 'volumeM3', 'ratePerM3'] as const;
const FEE_KEYS = ['salesTaxRate', 'brokerRate'] as const;

function rejectUnknown(what: string, obj: object, allowed: ReadonlyArray<string>): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) throw new Error(`${what}: unknown keys: ${unknown.join(', ')}`);
}

function checkFraction(name: string, v: number): number {
  if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`${name} must be a fraction 0..1, got ${v}`);
  return v;
}

function checkBasis(b: PriceBasis): PriceBasis {
  if (b !== 'immediate' && b !== 'patient') throw new Error(`Unknown price basis: "${String(b)}"`);
  return b;
}

export function settle(input: LedgerInput): LedgerResult {
  rejectUnknown('settle()', input, INPUT_KEYS as ReadonlyArray<string>);
  rejectUnknown('fees', input.fees, FEE_KEYS as ReadonlyArray<string>);
  checkFraction('salesTaxRate', input.fees.salesTaxRate);
  checkFraction('brokerRate', input.fees.brokerRate);

  const lines: LedgerLine[] = [];
  let gross = 0, salesTax = 0, broker = 0, customsTotal = 0, freightTotal = 0, purchasesTotal = 0;

  for (const s of input.sales) {
    rejectUnknown('sale line', s, TRADE_KEYS as ReadonlyArray<string>);
    checkBasis(s.basis);
    const g = s.qty * s.unitPrice;
    gross += g;
    lines.push({ label: `sell ${s.qty} ${s.commodity} @ ${s.unitPrice} (${s.basis})`, isk: isk(g) });
    const tax = g * input.fees.salesTaxRate;
    salesTax += tax;
    if (tax !== 0) lines.push({ label: `sales tax on ${s.commodity}`, isk: isk(-tax) });
    if (s.basis === 'patient') {
      const b = g * input.fees.brokerRate;
      broker += b;
      if (b !== 0) lines.push({ label: `broker fee (listing ${s.commodity})`, isk: isk(-b) });
    }
  }

  for (const p of input.purchases) {
    rejectUnknown('purchase line', p, TRADE_KEYS as ReadonlyArray<string>);
    checkBasis(p.basis);
    const c = p.qty * p.unitPrice;
    purchasesTotal += c;
    lines.push({ label: `buy ${p.qty} ${p.commodity} @ ${p.unitPrice} (${p.basis})`, isk: isk(-c) });
    if (p.basis === 'patient') {
      const b = c * input.fees.brokerRate;
      broker += b;
      if (b !== 0) lines.push({ label: `broker fee (buy order ${p.commodity})`, isk: isk(-b) });
    }
  }

  for (const c of input.customs) {
    rejectUnknown('customs event', c, CUSTOMS_KEYS as ReadonlyArray<string>);
    const fee = customsFee(c.tier, c.qty, c.direction, c.ctx, c.route ?? 'customsOffice');
    customsTotal += fee;
    if (fee !== 0) lines.push({ label: `customs: ${c.label}`, isk: isk(-fee) });
  }

  for (const f of input.freight) {
    rejectUnknown('freight leg', f, FREIGHT_KEYS as ReadonlyArray<string>);
    const cost = f.volumeM3 * f.ratePerM3;
    freightTotal += cost;
    if (cost !== 0) lines.push({ label: `freight: ${f.label} (${f.volumeM3} m³)`, isk: isk(-cost) });
  }

  const net = gross - salesTax - broker - customsTotal - freightTotal - purchasesTotal;
  return {
    gross: isk(gross),
    salesTax: isk(salesTax),
    broker: isk(broker),
    customs: isk(customsTotal),
    freight: isk(freightTotal),
    purchases: isk(purchasesTotal),
    net: isk(net),
    lines,
  };
}
