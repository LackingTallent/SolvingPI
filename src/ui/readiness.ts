/**
 * Solve gating: the button stays unavailable until every variable the chosen
 * goal actually needs is defined — and each missing item is NAMED, with the
 * section that fixes it. Pure function, no DOM, fully unit-tested.
 *
 * What each mode needs:
 *   all modes  — at least one planet (colonies need ground), and for every
 *                input sourced 'extract', a scanned value (w > 0) for its ore
 *                on at least one planet
 *   max/quota  — prices are OPTIONAL (the answer is output; net appears when
 *                prices exist)
 *   qol        — prices for the whole chain (it optimizes NET across cadences)
 *   compare    — at least one price (it ranks by net; unpriced products are
 *                excluded with reasons)
 */
import { oreOf, p1InputsOf, type Sourcing } from '../engine/chain.js';
import type { UiMode, UiPlanet, UiQuote } from './state.js';

export interface Readiness {
  readonly ready: boolean;
  readonly missing: ReadonlyArray<string>;
}

export interface ReadinessInput {
  readonly planets: ReadonlyArray<UiPlanet>;
  readonly product: string;
  readonly sourcing: Readonly<Record<string, Sourcing>>;
  readonly mode: UiMode;
  readonly prices: Readonly<Record<string, UiQuote>>;
}

const priced = (q: UiQuote | undefined): boolean => q !== undefined && q.bid > 0 && q.ask > 0;

export function solveReadiness(input: ReadinessInput): Readiness {
  const missing: string[] = [];

  if (input.planets.length === 0) {
    missing.push('Add at least one planet (section 3) — colonies need ground to stand on.');
  }

  for (const [p1, mode] of Object.entries(input.sourcing)) {
    if (mode !== 'extract') continue;
    let ore: string;
    try { ore = oreOf(p1); } catch { continue; }
    const scanned = input.planets.some((p) => p.resources.some((r) => r.p0 === ore && r.w > 0));
    if (!scanned) {
      missing.push(`Scan value needed for ${ore} (to extract ${p1}) — enter it in section 3, or switch ${p1} to refine/buy in section 1.`);
    }
  }

  if (input.mode === 'qol') {
    let chain: string[] = [];
    try {
      chain = [input.product, ...p1InputsOf(input.product)];
      for (const [p1, mode] of Object.entries(input.sourcing)) {
        if (mode === 'refine') { try { chain.push(oreOf(p1)); } catch { /* not a p1 */ } }
      }
    } catch { /* product mid-edit */ }
    const unpriced = [...new Set(chain)].filter((name) => !priced(input.prices[name]));
    if (unpriced.length > 0) {
      missing.push(`Login-budget mode optimizes NET, so it needs prices for: ${unpriced.join(', ')} (section 4).`);
    }
  }

  if (input.mode === 'compare') {
    const any = Object.values(input.prices).some((q) => priced(q));
    if (!any) {
      missing.push('Compare mode ranks by net — fetch or enter at least one price (section 4).');
    }
  }

  return { ready: missing.length === 0, missing };
}
