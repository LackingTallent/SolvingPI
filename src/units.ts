/**
 * Branded unit types. A quantity's unit is part of its type, so passing ISK
 * where m³ is expected is a COMPILE error, not a 100× bug in production.
 * (Lesson: v7 shipped a 100× fuel-block freight error that types would have caught.)
 *
 * Runtime constructors validate finiteness (and sign where the unit demands it)
 * and THROW on bad input — no silent fallbacks, ever.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ISK = Brand<number, 'ISK'>;          // may be negative (losses are reported, not floored)
export type M3 = Brand<number, 'M3'>;            // cubic metres, >= 0
export type Qty = Brand<number, 'Qty'>;          // commodity units, >= 0 (fractional allowed mid-calc)
export type Hours = Brand<number, 'Hours'>;      // > 0 where used for durations
export type Seconds = Brand<number, 'Seconds'>;  // > 0
export type TF = Brand<number, 'TF'>;            // CPU teraflops, >= 0
export type MW = Brand<number, 'MW'>;            // powergrid megawatts, >= 0
export type M3PerQty = Brand<number, 'M3PerQty'>;
export type IskPerQty = Brand<number, 'IskPerQty'>;
export type IskPerM3 = Brand<number, 'IskPerM3'>;
export type QtyPerHour = Brand<number, 'QtyPerHour'>;
export type Fraction = Brand<number, 'Fraction'>; // dimensionless ratio, >= 0 (NOT capped at 1: densities >100% are real)

class UnitError extends Error {
  constructor(unit: string, value: number, rule: string) {
    super(`Invalid ${unit}: ${value} (${rule})`);
    this.name = 'UnitError';
  }
}

function finite(unit: string, v: number): number {
  if (!Number.isFinite(v)) throw new UnitError(unit, v, 'must be finite');
  return v;
}
function nonNegative(unit: string, v: number): number {
  finite(unit, v);
  if (v < 0) throw new UnitError(unit, v, 'must be >= 0');
  return v;
}
function positive(unit: string, v: number): number {
  finite(unit, v);
  if (v <= 0) throw new UnitError(unit, v, 'must be > 0');
  return v;
}

export const isk = (v: number): ISK => finite('ISK', v) as ISK;
export const m3 = (v: number): M3 => nonNegative('M3', v) as M3;
export const qty = (v: number): Qty => nonNegative('Qty', v) as Qty;
export const hours = (v: number): Hours => positive('Hours', v) as Hours;
export const seconds = (v: number): Seconds => positive('Seconds', v) as Seconds;
export const tf = (v: number): TF => nonNegative('TF', v) as TF;
export const mw = (v: number): MW => nonNegative('MW', v) as MW;
export const m3PerQty = (v: number): M3PerQty => nonNegative('M3PerQty', v) as M3PerQty;
export const iskPerQty = (v: number): IskPerQty => finite('IskPerQty', v) as IskPerQty;
export const iskPerM3 = (v: number): IskPerM3 => nonNegative('IskPerM3', v) as IskPerM3;
export const qtyPerHour = (v: number): QtyPerHour => nonNegative('QtyPerHour', v) as QtyPerHour;
export const fraction = (v: number): Fraction => nonNegative('Fraction', v) as Fraction;

/** Same-brand addition/subtraction/scaling keep the brand. */
export const add = <T extends number>(a: T, b: T): T => ((a as number) + (b as number)) as T;
export const sub = <T extends number>(a: T, b: T): T => ((a as number) - (b as number)) as T;
export const scale = <T extends number>(a: T, k: number): T => {
  finite('scale factor', k);
  return ((a as number) * k) as T;
};

/** The only legal cross-unit multiplications, named so intent is visible. */
export const volumeOf = (n: Qty, unitVol: M3PerQty): M3 => m3(n * unitVol);
export const priceOf = (n: Qty, unitPrice: IskPerQty): ISK => isk(n * unitPrice);
export const freightOf = (vol: M3, rate: IskPerM3): ISK => isk(vol * rate);
export const hoursToSeconds = (h: Hours): Seconds => seconds(h * 3600);
