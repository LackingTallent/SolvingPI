/**
 * Compile-time unit-safety proofs. This file is type-checked by `npm run
 * typecheck` and never executed. Each @ts-expect-error line FAILS THE BUILD if
 * the type system ever stops rejecting that misuse.
 */
import { freightOf, isk, m3, priceOf, qty, type ISK, type M3 } from '../src/units.js';

// Passing ISK where m3 is expected is a compile error:
// @ts-expect-error — ISK is not M3
const badVolume: M3 = isk(100);

// Raw numbers cannot pose as branded units:
// @ts-expect-error — number is not ISK
const badIsk: ISK = 100;

// Swapped arguments are compile errors:
// @ts-expect-error — arguments reversed
freightOf(isk(10), m3(10));

// priceOf demands (Qty, IskPerQty), not two raw numbers:
// @ts-expect-error — raw numbers rejected
priceOf(100, 5);

export const _keep = { badVolume, badIsk, q: qty(1) };
