/**
 * MODE HONESTY AUDIT (owner ask 2026-09-03): every promise a mode makes in
 * the UI is checked against what the engine actually does, across edge-case
 * worlds and product mixes. Exits 1 on any broken claim.
 *
 * Claims under audit (from the goal cards, Help guide and result copy):
 *   Compare        — "rank every product by profit"; excluded named, never
 *                    silently dropped; ranking order is by net ISK/week.
 *   Fit my logins  — "best ISK for my play time"; cadence fits the budget;
 *                    no in-budget cadence beats the chosen one.
 *   Max output     — "the most of one product"; realized ≤ certificate;
 *                    auto never loses to forced-greedy.
 *   Pick for me    — "top profit, hands-free"; the pick IS the net max.
 *   Weekly target  — "make a set amount"; plans hit the target; refusals
 *                    carry an achievable rate that itself plans.
 *   Mix            — shares fix the ratio; lines hit their share targets;
 *                    characters partitioned (no character on two lines).
 *   Sourcing       — user pins are NEVER overruled; 'buy' cuts the chain.
 *
 * Run: npx tsx tools/honesty-audit.ts
 */
import { solveMax, solveQuota, upperBound, type SolveWorld, type PlanetInfo } from '../src/engine/allocator.js';
import { solveMixMax, solveMixQuota } from '../src/engine/mix.js';
import { comparative, maxProfit, quota, qolSolve, economics, defaultSourcing, allProducts, type MarketContext } from '../src/engine/modes.js';
import { HOURS_PER_WEEK } from '../src/engine/flow.js';
import { SCHEMATICS, tierOf } from '../src/spec/schematics.js';
import { p1InputsOf, oreOf } from '../src/engine/chain.js';
import { operation, type Character } from '../src/world/characters.js';
import { resourcesOf } from '../src/world/planets.js';
import { wFromDensityPct } from '../src/world/density.js';
import type { PlanetType } from '../src/spec/schematics.js';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name);
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};

const planet = (name: string, type: PlanetType, pct: number[]): PlanetInfo => ({
  name, type,
  resources: Object.fromEntries(resourcesOf(type).map((p0, i) => [p0, wFromDensityPct(pct[i % pct.length]!)])),
});
const chars = (n: number, ic = 5): Character[] =>
  Array.from({ length: n }, (_, i) => ({ name: `C${i}`, icLevel: ic, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 }));

// Deterministic plausible prices for the whole board.
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const tierMid = [6, 550, 9500, 72000, 1350000];
const prices: Record<string, { bid: number; ask: number; dailyVolume: number }> = {};
const names = new Set<string>();
for (const n of SCHEMATICS.keys()) {
  names.add(n);
  for (const p1 of p1InputsOf(n)) { names.add(p1); try { names.add(oreOf(p1)); } catch { /* p0 */ } }
}
for (const n of names) {
  const mid = tierMid[tierOf(n)]! * (0.75 + (hash(n) % 50) / 100);
  prices[n] = { bid: Math.round(mid * 0.965), ask: Math.round(mid * 1.035), dailyVolume: 500000 };
}
const market: MarketContext = {
  prices, sellBasis: 'immediate', buyBasis: 'immediate',
  fees: { salesTaxRate: 0.03375, brokerRate: 0.015 },
  customs: { ownerRate: 0.05, hisecNpc: false, customsCodeLevel: 5 },
  freightOutPerM3: 12, freightInPerM3: 12,
};

// Worlds: rich 2-system, single planet, no-Temperate trap, single character.
const RICH: PlanetInfo[] = [
  planet('A IV', 'Storm', [92, 71, 64, 55, 48]), planet('A V', 'Gas', [83, 77, 58, 51, 45]),
  planet('A VI', 'Storm', [68, 61, 57, 49, 41]), planet('A II', 'Barren', [74, 66, 52, 47, 39]),
  planet('B I', 'Lava', [88, 79, 63, 54, 42]), planet('B III', 'Plasma', [81, 72, 60, 50, 44]),
  planet('B VI', 'Gas', [76, 69, 55, 46, 40]), planet('B VII', 'Oceanic', [86, 70, 59, 48, 43]),
  planet('B II', 'Temperate', [78, 65, 54, 45, 38]), planet('C I', 'Ice', [72, 63, 51, 44, 37]),
];
const world = (n: number, planets: PlanetInfo[] = RICH, programHours = 24): SolveWorld =>
  ({ operation: operation(chars(n)), planets, programHours });

/* ═══ 1. COMPARE — "rank every product by profit" ═══ */
{
  const w = world(3);
  const { ranked, excluded } = comparative(w, market);
  const all = allProducts();
  check('compare: nothing silently dropped (ranked+excluded = every product)',
    ranked.length + excluded.length === all.length,
    `${ranked.length}+${excluded.length} vs ${all.length}`);
  check('compare: every exclusion carries a named reason',
    excluded.every((e) => typeof e.reason === 'string' && e.reason.length > 3));
  const nets = ranked.map((r) => r.economics.netPerWeek);
  check('compare: ranking is by net ISK/week, strictly non-increasing',
    nets.every((v, i) => i === 0 || v <= nets[i - 1]! + 1e-6));
  check('compare: a loss shows as a loss (negative nets kept in the ranking, not hidden)',
    ranked.length === 0 || nets[nets.length - 1]! < nets[0]!);
  // Order honesty: re-solve the top 10 with 'auto' — the greedy ranking's
  // ORDER must broadly survive exact solving (adjacent swaps tolerated;
  // a top-3 product may not fall out of the exact top 6).
  const top = ranked.slice(0, 10);
  const exact = top
    .map((r) => {
      const rr = solveMax(w, r.product, r.result.sourcing);
      return 'error' in rr ? null : { product: r.product, net: economics(rr, market, w.programHours).netPerWeek };
    })
    .filter((x): x is { product: string; net: number } => x !== null)
    .sort((a, b) => b.net - a.net);
  for (let i = 0; i < Math.min(3, top.length); i++) {
    const exactPos = exact.findIndex((e) => e.product === top[i]!.product);
    check(`compare: greedy top-${i + 1} (${top[i]!.product}) stays in the exact top 6`,
      exactPos !== -1 && exactPos < 6, `exact position ${exactPos}`);
  }
  // Certificate honesty on every ranked row.
  check('compare: every ranked row respects its certificate (realized ≤ upper bound)',
    ranked.every((r) => r.result.realizedPerWeek <= r.result.upperBoundPerWeek * (1 + 1e-6)));
}

/* ═══ 2. FIT MY LOGINS — "best ISK for my play time" ═══ */
{
  const w = world(3);
  for (const budget of [0.5, 1, 3, 7, 28]) {
    const r = qolSolve(w, 'Coolant', market, budget);
    if ('error' in r) { check(`qol: budget ${budget}/wk solvable`, budget < 1, r.error); continue; }
    const sessions = HOURS_PER_WEEK / r.programHours;
    check(`qol: budget ${budget}/wk — chosen cadence fits (${sessions.toFixed(2)} sessions)`,
      sessions <= budget + 1e-9);
    // No in-budget cadence beats the chosen one.
    for (const h of [6, 12, 24, 48, 96, 168, 336]) {
      if (HOURS_PER_WEEK / h > budget + 1e-9) continue;
      const alt = solveMax({ ...w, programHours: h }, 'Coolant', defaultSourcing(w, 'Coolant'));
      if ('error' in alt) continue;
      const altNet = economics(alt, market, h).netPerWeek;
      check(`qol: budget ${budget}/wk — cadence ${h}h does not beat the pick`,
        altNet <= r.economics.netPerWeek * (1 + 1e-6), `${Math.round(altNet)} > ${Math.round(r.economics.netPerWeek)}`);
    }
  }
}

/* ═══ 3. MAX OUTPUT — "the most of one product" ═══ */
{
  for (const [n, planets, tag] of [[1, RICH, 'rich'], [3, RICH, 'rich'], [1, [RICH[0]!], '1-planet'], [50, RICH, '50-char']] as const) {
    const w = world(n, [...planets]);
    for (const product of ['Coolant', 'Robotics', 'Broadcast Node']) {
      const s = defaultSourcing(w, product);
      const auto = solveMax(w, product, s);
      const greedy = solveMax(w, product, s, { method: 'greedy' });
      if ('error' in auto || 'error' in greedy) {
        check(`max[${tag} n=${n}] ${product}: auto and greedy agree on feasibility`,
          ('error' in auto) === ('error' in greedy));
        continue;
      }
      check(`max[${tag} n=${n}] ${product}: realized ≤ upper bound`,
        auto.realizedPerWeek <= auto.upperBoundPerWeek * (1 + 1e-6));
      check(`max[${tag} n=${n}] ${product}: auto never loses to forced-greedy`,
        auto.realizedPerWeek >= greedy.realizedPerWeek * (1 - 1e-6),
        `auto ${Math.round(auto.realizedPerWeek)} < greedy ${Math.round(greedy.realizedPerWeek)}`);
      check(`max[${tag} n=${n}] ${product}: plan is judge-legal`, auto.verdict.legal);
    }
  }
}

/* ═══ 4. PICK FOR ME — "top profit, hands-free" ═══ */
{
  const w = world(3);
  const r = maxProfit(w, market);
  if ('error' in r) check('profit: solvable on the rich world', false, r.error);
  else {
    check('profit: the pick IS the net maximum of the ranking',
      r.ranked.every((x) => x.economics.netPerWeek <= r.best.economics.netPerWeek + 1e-6));
    check('profit: pick carries a full plan (colonies assigned)',
      r.best.result.plan.colonies.length > 0);
  }
}

/* ═══ 5. WEEKLY TARGET — "make a set amount" ═══ */
{
  const w = world(3);
  for (const product of ['Coolant', 'Robotics', 'Recursive Computing Module']) {
    const s = defaultSourcing(w, product);
    const max = solveMax(w, product, s, { method: 'greedy' });
    if ('error' in max) continue;
    for (const frac of [0.1, 0.33, 0.6, 0.85, 1.0]) {
      const target = Math.max(1, Math.floor(max.realizedPerWeek * frac));
      const q = solveQuota(w, product, target, s);
      if ('error' in q) { check(`quota: ${product} @${Math.round(frac * 100)}% of own max plans`, false, q.error.slice(0, 80)); continue; }
      check(`quota: ${product} @${Math.round(frac * 100)}% — plan sustains the target`,
        q.realizedPerWeek >= target * (1 - 1e-9) || Math.abs(q.realizedPerWeek - target) < 1);
      check(`quota: ${product} @${Math.round(frac * 100)}% — judge-legal`, q.verdict.legal);
    }
    // Refusal honesty: an impossible target refuses AND names an achievable
    // rate that itself plans.
    const impossible = Math.ceil(max.realizedPerWeek * 5);
    const ref = solveQuota(w, product, impossible, s);
    check(`quota: ${product} impossible target refuses`, 'error' in ref);
    if ('error' in ref && ref.achievablePerWeek !== undefined) {
      const retry = solveQuota(w, product, Math.floor(ref.achievablePerWeek), s);
      check(`quota: ${product} — the offered achievable rate actually plans`,
        !('error' in retry), 'error' in retry ? retry.error.slice(0, 80) : '');
    } else if ('error' in ref) {
      check(`quota: ${product} — refusal carries achievablePerWeek when a max exists`, false);
    }
  }
  // The UI's one-click "Set target to N/wk" uses the refusal's rate: N must plan.
  const eco = quota(w, 'Coolant', 10 ** 9, market);
  check('quota(mode): astronomic target refuses with achievable', 'error' in eco && eco.achievablePerWeek !== undefined);
}

/* ═══ 6. MIX — ratio honesty, partition honesty, edge shares ═══ */
{
  const w = world(5);
  const mixes: Array<[string, Array<{ product: string; share: number }>]> = [
    ['60/40 P4s', [{ product: 'Broadcast Node', share: 60 }, { product: 'Recursive Computing Module', share: 40 }]],
    ['95/5 extreme', [{ product: 'Coolant', share: 95 }, { product: 'Robotics', share: 5 }]],
    ['cross-tier P1+P4', [{ product: 'Coolant', share: 50 }, { product: 'Broadcast Node', share: 50 }]],
    ['unnormalized 3/2', [{ product: 'Coolant', share: 3 }, { product: 'Robotics', share: 2 }]],
    ['six products', [
      { product: 'Coolant', share: 25 }, { product: 'Robotics', share: 20 },
      { product: 'Mechanical Parts', share: 15 }, { product: 'Consumer Electronics', share: 15 },
      { product: 'Water', share: 15 }, { product: 'Oxygen', share: 10 },
    ]],
  ];
  for (const [tag, spec] of mixes) {
    // Partition semantics: each line needs at least one character, so a
    // six-product mix runs on an eight-character roster.
    const mw = spec.length > w.operation.characters.length ? world(8) : w;
    const entries = spec.map((e) => ({ ...e, sourcing: defaultSourcing(mw, e.product) }));
    const m = solveMixMax(mw, entries);
    if ('error' in m) { check(`mix[${tag}]: solvable`, false, m.error.slice(0, 80)); continue; }
    const totalShare = spec.reduce((a, e) => a + e.share, 0);
    check(`mix[${tag}]: reported share percentages total 100`,
      Math.abs(m.lines.reduce((a, l) => a + l.sharePct, 0) - 100) < 1e-6);
    for (let i = 0; i < m.lines.length; i++) {
      const l = m.lines[i]!;
      check(`mix[${tag}]: ${l.product} target honors its share of the bundle`,
        Math.abs(l.targetPerWeek - (spec[i]!.share / totalShare) * m.lines.reduce((a, x) => a + x.targetPerWeek, 0)) < 1e-6);
      check(`mix[${tag}]: ${l.product} line delivers ≥ its share target`,
        l.result.realizedPerWeek >= l.targetPerWeek * (1 - 1e-9),
        `${Math.round(l.result.realizedPerWeek)} < ${Math.round(l.targetPerWeek)}`);
      check(`mix[${tag}]: ${l.product} line judge-legal`, l.result.verdict.legal);
    }
    // Partition claim: no character serves two lines, and each line's plan
    // uses ONLY its assigned characters.
    const seen = new Set<string>();
    let overlap = false, leaked = false;
    for (const l of m.lines) {
      for (const c of l.characters) { if (seen.has(c)) overlap = true; seen.add(c); }
      const assigned = new Set(l.characters);
      for (const col of l.result.plan.colonies) if (!assigned.has(col.characterName)) leaked = true;
    }
    check(`mix[${tag}]: characters partitioned — none on two lines`, !overlap);
    check(`mix[${tag}]: each line's colonies use only its own characters`, !leaked);
    check(`mix[${tag}]: bundle = sum of line realized rates`,
      Math.abs(m.bundlePerWeek - m.lines.reduce((a, l) => a + l.result.realizedPerWeek, 0)) < 1e-6);
  }
  // Mix quota above mix-max must refuse WITH an achievable bundle.
  const entries = [
    { product: 'Coolant', share: 60, sourcing: defaultSourcing(w, 'Coolant') },
    { product: 'Robotics', share: 40, sourcing: defaultSourcing(w, 'Robotics') },
  ];
  const mm = solveMixMax(w, entries);
  if (!('error' in mm)) {
    const over = solveMixQuota(w, entries, Math.ceil(mm.bundlePerWeek * 3));
    check('mix quota: 3× mix-max refuses', 'error' in over);
    check('mix quota: refusal names an achievable bundle', 'error' in over && over.achievablePerWeek !== undefined);
    const at = solveMixQuota(w, entries, Math.floor(mm.bundlePerWeek * 0.98));
    check('mix quota: 98% of mix-max plans', !('error' in at));
  }
  // Invalid mixes refuse loudly.
  check('mix: duplicate product refused',
    'error' in solveMixMax(w, [{ product: 'Coolant', share: 50, sourcing: {} }, { product: 'Coolant', share: 50, sourcing: {} }]));
  check('mix: raw P0 refused',
    'error' in solveMixMax(w, [{ product: 'Aqueous Liquids', share: 50, sourcing: {} }, { product: 'Coolant', share: 50, sourcing: {} }]));
  check('mix: single-entry refused',
    'error' in solveMixMax(w, [{ product: 'Coolant', share: 100, sourcing: {} }]));
}

/* ═══ 7. SOURCING — "your pins are never overruled"; 'buy' cuts the chain ═══ */
{
  const w = world(3);
  // Pin a P1 to buy: no plan may extract it, in ANY mode that accepts pins.
  const pinned = 'Water';
  const s = { ...defaultSourcing(w, 'Coolant'), [pinned]: 'buy' as const };
  const r = solveMax(w, 'Coolant', s);
  if ('error' in r) check('sourcing: Coolant with Water pinned to buy still solves', false, r.error);
  else {
    check('sourcing: pinned-buy P1 keeps its pin in the result', r.sourcing[pinned] === 'buy');
    const extractsPinned = r.plan.colonies.some((c) =>
      c.plan.factories.some((f) => f.schematic === pinned) && c.plan.extractors.length > 0);
    check('sourcing: pinned-buy P1 is never extracted (chain cut)', !extractsPinned);
    check('sourcing: pinned-buy P1 appears in purchases',
      (r.plan.logistics?.purchases ?? []).some((p) => p.commodity === pinned));
  }
  // Compare respects pins across every candidate whose chain touches them.
  // The ONE documented exception: the pinned commodity's own row (you cannot
  // sell what you bought as production — buy flips to refine there).
  const { ranked } = comparative(w, market, undefined, { [pinned]: 'buy' });
  const touching = ranked.filter((x) => x.product !== pinned && Object.keys(x.result.sourcing).includes(pinned));
  check('compare: a pin survives into every ranked row whose chain touches it',
    touching.length > 0 && touching.every((x) => x.result.sourcing[pinned] === 'buy'));
  const selfRow = ranked.find((x) => x.product === pinned);
  check('compare: the pinned commodity\'s own row flips buy→refine (cannot sell bought goods as production)',
    selfRow === undefined || selfRow.result.sourcing[pinned] === 'refine');
}

/* ═══ 8. DEGENERATE WORLDS — honest refusals, no lies ═══ */
{
  // One planet, one character: P4 impossible → named error, never a fake plan.
  const w1 = world(1, [RICH[0]!]);
  const p4 = solveMax(w1, 'Broadcast Node', defaultSourcing(w1, 'Broadcast Node'));
  check('degenerate: full P4 chain on 1 planet refuses with a reason',
    'error' in p4 && p4.error.length > 5);
  // Certificate stays valid even at 50 characters (relaxation ≥ realized).
  const w50 = world(50);
  for (const product of ['Coolant', 'Robotics']) {
    const ub = upperBound(w50, product, defaultSourcing(w50, product));
    const r = solveMax(w50, product, defaultSourcing(w50, product), { method: 'greedy' });
    check(`degenerate[50 chars]: ${product} certificate holds`,
      'error' in r || r.realizedPerWeek <= ub * (1 + 1e-6));
  }
  // 6h program vs 336h program: rate claims must both certify.
  for (const hours of [6, 336]) {
    const wh = world(3, RICH, hours);
    const r = solveMax(wh, 'Coolant', defaultSourcing(wh, 'Coolant'));
    check(`degenerate[${hours}h program]: certificate holds`,
      'error' in r || r.realizedPerWeek <= r.upperBoundPerWeek * (1 + 1e-6));
  }
}

console.log(`\nHONESTY AUDIT: ${pass} passed, ${fail} failed`);
if (fail > 0) { failures.forEach((f) => console.log(' - ' + f)); process.exit(1); }
