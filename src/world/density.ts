/**
 * Density is a UI TRANSLATION LAYER (locked decision). The engine runs on raw
 * qty_per_cycle (w). The familiar percentage maps w to the v8.x reference so
 * existing users' mental model (and saved values) carry over.
 *
 * 100% ≡ w = 13277.2694 — the v8 calibration under which a 6-hour program on
 * one extractor totals 290,112 units (≈ feeds 8 basic industry facilities:
 * 48,000 P0/h demand vs 48,352/h supply, +0.7% headroom). This is a UI
 * convention, NOT game physics; the engine never consumes percentages.
 *
 * PROVENANCE: this constant is a product-continuity convention only — it is
 * NOT derived from any player's scan data, any specific system, or any
 * operation size. Its only meaning is "the w at which one extractor roughly
 * feeds the classic 8-basic archetype at 6h cadence." It could be redefined
 * (e.g. so 6h supply is exactly 48,000/h) at the cost of shifting every
 * legacy percentage by ~0.7%; kept as-is so v8 users' saved values translate.
 */

export const DENSITY_REFERENCE_W = 13277.2694;

export function wFromDensityPct(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0)
    throw new Error(`density % must be > 0, got ${pct} (uncapped above 100 — high densities are real)`);
  return (pct / 100) * DENSITY_REFERENCE_W;
}

export function densityPctFromW(w: number): number {
  if (!Number.isFinite(w) || w <= 0) throw new Error(`qty_per_cycle (w) must be > 0, got ${w}`);
  return (w / DENSITY_REFERENCE_W) * 100;
}
