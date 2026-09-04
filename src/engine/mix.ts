/**
 * PRODUCT MIX (owner spec 2026-08-31): the user names several products with
 * percentage shares and the solver optimizes the BLEND.
 *
 * Semantics: shares fix the RATIO of weekly unit rates — a 60/40 mix means
 * 60 units of A leave the line for every 40 of B. 'max' maximizes the bundle
 * scale under that ratio; 'quota' hits a total blended units/week.
 *
 * Method — honest and judge-legal: characters are PARTITIONED between the
 * products (each character's colonies all serve one product line, exactly
 * how players dedicate alts; planets may serve several lines through
 * different characters). Every sub-plan runs through the normal allocator
 * and judge; the bundle is the union of sub-plans. A binary search on the
 * bundle scale finds the largest blend the partition can carry. The answer
 * is a certified-feasible LOWER bound on the theoretical joint optimum —
 * the result says so rather than claiming exactness it doesn't have.
 */
import { tierOf } from '../spec/schematics.js';
import { operation, type Character } from '../world/characters.js';
import { solveMax, solveQuota, type SolveResult, type SolveWorld } from './allocator.js';
import type { Sourcing } from './chain.js';

export interface MixEntry {
  readonly product: string;
  /** Relative share of the blend (any positive scale; normalized internally). */
  readonly share: number;
  readonly sourcing: Readonly<Record<string, Sourcing>>;
}

export interface MixLine {
  readonly product: string;
  readonly sharePct: number;
  readonly targetPerWeek: number;
  readonly result: SolveResult;
  readonly characters: ReadonlyArray<string>;
}

export interface MixResult {
  readonly lines: ReadonlyArray<MixLine>;
  /** Total blended units/week actually planned (sum of line realized rates). */
  readonly bundlePerWeek: number;
  readonly slotsUsed: number;
  readonly note: string;
}

function checkEntries(entries: ReadonlyArray<MixEntry>): { shares: number[]; total: number } | { error: string } {
  if (entries.length < 2) return { error: 'mix-invalid: a mix needs at least two products' };
  if (entries.length > 6) return { error: 'mix-invalid: at most six products in a mix' };
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.product)) return { error: `mix-invalid: ${e.product} appears twice in the mix` };
    seen.add(e.product);
    if (!Number.isFinite(e.share) || e.share <= 0) return { error: `mix-invalid: share for ${e.product} must be > 0` };
    if (tierOf(e.product) === 0) return { error: `mix-invalid: ${e.product} is a raw P0 — it has no chain` };
  }
  const total = entries.reduce((a, e) => a + e.share, 0);
  return { shares: entries.map((e) => e.share / total), total };
}

function subWorld(world: SolveWorld, chars: ReadonlyArray<Character>): SolveWorld {
  // Round-4 audit fix: EVERY world field except the character subset must
  // carry over — dropping stackingPenalty/extraction here silently solved
  // mix lines in a rosier world than the caller's (a line "meeting" its
  // target at penalty 0 could be provably unreachable at the user's real
  // setting). Spread + override, so a future SolveWorld field can never be
  // silently dropped again.
  return { ...world, operation: operation(chars) };
}

/** Can this character subset carry `target`/wk of `product`? (fast solver). */
function subsetCarries(world: SolveWorld, chars: ReadonlyArray<Character>, e: MixEntry, target: number): boolean {
  if (chars.length === 0) return false;
  const r = solveMax(subWorld(world, chars), e.product, e.sourcing, { method: 'greedy' });
  return !('error' in r) && r.realizedPerWeek >= target * (1 - 1e-9);
}

/** Greedy character partition for fixed per-product targets. Products are
 * placed hardest-first (higher tier, then bigger target); each takes the
 * smallest prefix of the remaining characters that carries its target.
 *
 * T-16 fix (owner 2026-09-03): the old single ordering sorted characters by
 * icLevel ALONE — characters tied on slots but differing in CCU were
 * interchangeable to the partitioner, so a feasible blend could be refused
 * when the low-CCU alt was dealt to the line that needed the high-CCU
 * colonies. The partition now tries several deterministic orderings —
 * slots-then-CCU, CCU-then-slots, and each with the line order reversed —
 * and returns the first that carries every line. Every candidate grouping
 * is still verified by subsetCarries (and later judge-checked), so extra
 * attempts can only rescue feasible blends, never fake one. */
function partitionAttempt(
  world: SolveWorld,
  entries: ReadonlyArray<MixEntry>,
  targets: ReadonlyArray<number>,
  order: ReadonlyArray<number>,
  charSort: (a: Character, b: Character) => number,
): Array<Character[]> | null {
  let remaining = [...world.operation.characters].sort(charSort);
  const groups: Array<Character[]> = entries.map(() => []);
  for (const i of order) {
    let chosen: Character[] | null = null;
    for (let n = 1; n <= remaining.length; n++) {
      const cand = remaining.slice(0, n);
      if (subsetCarries(world, cand, entries[i]!, targets[i]!)) { chosen = cand; break; }
    }
    if (chosen === null) return null;
    groups[i] = chosen;
    remaining = remaining.slice(chosen.length);
  }
  return groups;
}

function partition(
  world: SolveWorld,
  entries: ReadonlyArray<MixEntry>,
  targets: ReadonlyArray<number>,
): Array<Character[]> | null {
  const hardestFirst = entries.map((_, i) => i)
    .sort((a, b) => tierOf(entries[b]!.product) - tierOf(entries[a]!.product) || targets[b]! - targets[a]!);
  const reversed = [...hardestFirst].reverse();
  const charSorts: ReadonlyArray<(a: Character, b: Character) => number> = [
    (a, b) => b.icLevel - a.icLevel || b.ccuLevel - a.ccuLevel,
    (a, b) => b.ccuLevel - a.ccuLevel || b.icLevel - a.icLevel,
  ];
  for (const order of [hardestFirst, reversed]) {
    for (const charSort of charSorts) {
      const g = partitionAttempt(world, entries, targets, order, charSort);
      if (g !== null) return g;
    }
  }
  return null;
}

/** Solve each line exactly on its assigned characters (minimal colonies for
 * its target; greedy fallback keeps the certified-feasible plan). */
function finalize(
  world: SolveWorld,
  entries: ReadonlyArray<MixEntry>,
  targets: ReadonlyArray<number>,
  sharesPct: ReadonlyArray<number>,
  groups: ReadonlyArray<ReadonlyArray<Character>>,
  note: string,
): MixResult | { error: string } {
  const lines: MixLine[] = [];
  const drifted: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const w = subWorld(world, [...groups[i]!]);
    let r: SolveResult | { error: string } = solveQuota(w, e.product, targets[i]!, e.sourcing);
    if ('error' in r) r = solveMax(w, e.product, e.sourcing); // integrality edge: keep the feasible plan
    if ('error' in r) return { error: `mix-line-failed: ${e.product}: ${r.error}` };
    // Truth audit 2026-09-03: the solveMax fallback keeps a feasible plan but
    // is NOT capped to the line's share target, so the delivered ratio can
    // drift from the requested one. That was silent — now it is named.
    if (Math.abs(r.realizedPerWeek - targets[i]!) > targets[i]! * 0.01 + 1) drifted.push(e.product);
    lines.push({
      product: e.product, sharePct: sharesPct[i]!, targetPerWeek: targets[i]!,
      result: r, characters: groups[i]!.map((c) => c.name),
    });
  }
  const driftNote = drifted.length > 0
    ? ` NOTE: ${drifted.join(', ')} deliver${drifted.length === 1 ? 's' : ''} off the requested share (integer colonies) — the realized blend ratio differs from the requested one; see each line's realized rate.`
    : '';
  return {
    lines,
    bundlePerWeek: lines.reduce((a, l) => a + l.result.realizedPerWeek, 0),
    slotsUsed: lines.reduce((a, l) => a + l.result.slotsUsed, 0),
    note: note + driftNote,
  };
}

const MIX_NOTE = 'Mix plans partition your characters between product lines (each sub-plan judge-checked); the blend is a certified-feasible answer, stated as a lower bound on the theoretical joint optimum.';

/** Maximize the bundle scale at the given share ratio. */
export function solveMixMax(world: SolveWorld, entries: ReadonlyArray<MixEntry>): MixResult | { error: string } {
  const chk = checkEntries(entries);
  if ('error' in chk) return chk;
  const shares = chk.shares;
  // Upper bound: each product alone, full operation.
  let tHi = Number.POSITIVE_INFINITY;
  for (let i = 0; i < entries.length; i++) {
    const solo = solveMax(world, entries[i]!.product, entries[i]!.sourcing, { method: 'greedy' });
    if ('error' in solo) return { error: `mix-line-failed: ${entries[i]!.product}: ${solo.error}` };
    tHi = Math.min(tHi, solo.realizedPerWeek / shares[i]!);
  }
  if (!Number.isFinite(tHi) || tHi <= 0) return { error: 'mix-infeasible: no positive blend rate fits this operation' };
  // Binary search the largest feasible bundle scale (upper bound tried first —
  // when one product is the sole binding constraint it is often exact).
  let lo = 0;
  let loGroups: Array<Character[]> | null = null;
  const gHi = partition(world, entries, shares.map((s) => s * tHi));
  if (gHi !== null) { lo = tHi; loGroups = gHi; }
  else {
    let hi = tHi;
    for (let iter = 0; iter < 14; iter++) {
      const mid = (lo + hi) / 2;
      const g = partition(world, entries, shares.map((s) => s * mid));
      if (g !== null) { lo = mid; loGroups = g; } else { hi = mid; }
    }
  }
  if (loGroups === null) return { error: 'mix-infeasible: the operation cannot carry every product in the mix at once — fewer products, more characters, or buy more of the chain in' };
  return finalize(world, entries, shares.map((s) => s * lo), shares.map((s) => s * 100), loGroups, MIX_NOTE);
}

/** Hit a total blended units/week at the share ratio. */
export function solveMixQuota(
  world: SolveWorld,
  entries: ReadonlyArray<MixEntry>,
  totalPerWeek: number,
): MixResult | { error: string; achievablePerWeek?: number } {
  const chk = checkEntries(entries);
  if ('error' in chk) return chk;
  if (!Number.isFinite(totalPerWeek) || totalPerWeek <= 0) return { error: `quota-invalid: targetPerWeek must be > 0, got ${totalPerWeek}` };
  const shares = chk.shares;
  const targets = shares.map((s) => s * totalPerWeek);
  const g = partition(world, entries, targets);
  if (g === null) {
    const max = solveMixMax(world, entries);
    return {
      error: 'quota-unreachable: the operation cannot carry this blend at that rate',
      ...('error' in max ? {} : { achievablePerWeek: max.bundlePerWeek }),
    };
  }
  return finalize(world, entries, targets, shares.map((s) => s * 100), g, MIX_NOTE);
}
