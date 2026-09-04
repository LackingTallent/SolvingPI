/**
 * Solve gating: the button stays unavailable until every variable the chosen
 * goal actually needs is defined — and each missing item is NAMED, with the
 * section that fixes it. Pure function, no DOM, fully unit-tested.
 *
 * The gate now bends to the ACCURACY LADDER (detail level):
 *   quick    — typical-value stand-ins fill anything not provided: unscanned
 *              densities come from the chosen security band, sourcing is
 *              suggested. Needs only a goal, a product, at least one planet —
 *              and the band itself once something would be assumed.
 *   refined  — real scans required for every extract-sourced input; preset
 *              costs are allowed (results stay labeled).
 *   exact    — refined, plus the fee/freight numbers must be the user's own
 *              (entered or explicitly confirmed), so nothing is assumed.
 *
 * Mode needs, unchanged:
 *   max/quota — prices OPTIONAL (the answer is output; net appears when priced)
 *   qol       — prices for the whole chain (it optimizes NET across cadences)
 *   compare   — at least one usable price (it ranks by net)
 *
 * And before any of that: a goal must actually have been chosen — everything
 * else can be suggested, the goal cannot.
 */
import { effectiveP1Inputs, oreOf, p1InputsOf, type Sourcing } from '../engine/chain.js';
import type { CostsSource, DetailLevel, UiMode, UiPlanet, UiQuote } from './state.js';
import type { SpaceBand } from './presets.js';

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
  /** Defaults preserve the pre-ladder behavior: goal chosen, refined level. */
  readonly modeChosen?: boolean;
  /** Section-2 gate (owner spec 2026-09-01). Omit both to skip the check. */
  readonly charactersCount?: number;
  readonly charactersDone?: boolean;
  readonly detailLevel?: DetailLevel;
  readonly spaceBand?: SpaceBand | null;
  readonly costsSource?: CostsSource;
}

const priced = (q: UiQuote | undefined): boolean => q !== undefined && q.bid > 0 && q.ask > 0;

export function solveReadiness(input: ReadinessInput): Readiness {
  const missing: string[] = [];
  const modeChosen = input.modeChosen ?? true;
  const level: DetailLevel = input.detailLevel ?? 'refined';

  if (!modeChosen) {
    missing.push('Pick your goal (section 1) — everything else can be suggested; the goal cannot.');
    return { ready: false, missing };
  }

  if (input.charactersCount !== undefined) {
    if (input.charactersCount === 0) {
      missing.push('Add at least one character (section 2) — someone has to run the colonies.');
    } else if (input.charactersDone !== true) {
      missing.push('Press “Done adding characters” (section 2) when your roster is set.');
    }
  }

  if (input.planets.length === 0) {
    missing.push('Add at least one planet (section 2) — colonies need ground to stand on.');
  }

  if (level === 'quick') {
    // Anything unscanned will be assumed at the band's typical density — so
    // the band itself becomes the one requirement scans normally cover.
    // Review #2: only demand the band for unscanned resources the chosen goal
    // can actually USE. Compare considers every product, so any zero matters;
    // a specific product only cares about the ores of inputs it might extract
    // (pinned extract, or unpinned — Suggested may choose extract).
    let relevant: ReadonlySet<string> | null = null; // null = every resource matters
    if (input.mode !== 'compare' && input.mode !== 'profit') {
      try {
        const ores = p1InputsOf(input.product)
          .filter((p1) => { const m = input.sourcing[p1]; return m === undefined || m === 'extract'; })
          .flatMap((p1) => { try { return [oreOf(p1)]; } catch { return []; } });
        relevant = new Set(ores);
      } catch { relevant = null; /* product mid-edit — stay conservative */ }
    }
    const anyUnscanned = input.planets.some((p) => p.resources.some(
      (r) => (!(r.w > 0) || r.assumed === true) && (relevant === null || relevant.has(r.p0))));
    if (anyUnscanned && (input.spaceBand === null || input.spaceBand === undefined)) {
      missing.push('Estimates need your space type — tap a preset in section 2 so assumed densities can take typical values (or enter scans).');
    }
  } else {
    // Cut-aware: a P1 whose whole subtree was bought away (an intermediate
    // pinned 'buy') needs no scan — only P1s the chain still walks count.
    let effective: ReadonlySet<string> | null = null;
    try { effective = new Set(effectiveP1Inputs(input.product, input.sourcing)); } catch { effective = null; }
    for (const [p1, mode] of Object.entries(input.sourcing)) {
      if (mode !== 'extract') continue;
      if (effective !== null && !effective.has(p1)) continue;
      let ore: string;
      try { ore = oreOf(p1); } catch { continue; }
      const scanned = input.planets.some((p) => p.resources.some((r) => r.p0 === ore && r.w > 0 && r.assumed !== true));
      if (!scanned) {
        missing.push(`Scan value needed for ${ore} (to extract ${p1}) — enter it in section 2, or switch ${p1} to refine/buy in section 1.`);
      }
    }
  }

  if (level === 'exact' && input.costsSource !== undefined && input.costsSource !== 'user') {
    missing.push('Exact numbers need your real costs — edit the rates under “Edit prices & costs by hand” in section 3 to make them yours.');
  }

  if (input.mode === 'qol') {
    let chain: string[] = [];
    try {
      const eff = effectiveP1Inputs(input.product, input.sourcing);
      chain = [input.product, ...eff];
      for (const [k, mode] of Object.entries(input.sourcing)) {
        if (mode === 'refine' && eff.includes(k)) { try { chain.push(oreOf(k)); } catch { /* not a p1 */ } }
        if (mode === 'buy' && !(p1InputsOf(input.product) as readonly string[]).includes(k)) chain.push(k); // bought intermediate
      }
    } catch { /* product mid-edit */ }
    const unpriced = [...new Set(chain)].filter((name) => !priced(input.prices[name]));
    if (unpriced.length > 0) {
      missing.push(`Fit my logins optimizes NET, so it needs prices for: ${unpriced.join(', ')} (section 3).`);
    }
  }

  if (input.mode === 'compare' || input.mode === 'profit') {
    const any = Object.values(input.prices).some((q) => priced(q));
    if (!any) {
      missing.push(input.mode === 'profit'
        ? 'Pick for me ranks everything by net — fetch or enter at least one price (section 3).'
        : 'Compare ranks by net — fetch or enter at least one price (section 3).');
    }
  }

  return { ready: missing.length === 0, missing };
}
