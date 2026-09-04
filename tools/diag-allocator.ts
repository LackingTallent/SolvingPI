/**
 * ALLOCATOR QUALITY GATE — guards the 2026-09-03 fixes for the user-reported
 * greedy/quota defects (Reddit: quotas at half a real setup's output refused;
 * greedy realizing ~36% of the fractional bound on multi-input chains):
 *  1. greedy realized vs fractional upper bound must stay above hard floors
 *  2. quota may NEVER refuse a target at ≤100% of the solver's own max
 *  3. 60/40 P4 mix quota at half the mix-max bundle must plan
 * Run: npx tsx tools/diag-allocator.ts   (exits 1 on any regression)
 */
import { solveMax, solveQuota, type SolveWorld, type PlanetInfo } from '../src/engine/allocator.js';
import { solveMixMax, solveMixQuota } from '../src/engine/mix.js';
import { defaultSourcing } from '../src/engine/modes.js';
import { operation, type Character } from '../src/world/characters.js';
import { resourcesOf } from '../src/world/planets.js';
import { wFromDensityPct } from '../src/world/density.js';
import type { PlanetType } from '../src/spec/schematics.js';

const planet = (name: string, type: PlanetType, pct: number[]): PlanetInfo => ({
  name, type,
  resources: Object.fromEntries(resourcesOf(type).map((p0, i) => [p0, wFromDensityPct(pct[i % pct.length]!)])),
});

const PLANETS: PlanetInfo[] = [
  planet('A IV', 'Storm', [92, 71, 64, 55, 48]),
  planet('A V', 'Gas', [83, 77, 58, 51, 45]),
  planet('A VI', 'Storm', [68, 61, 57, 49, 41]),
  planet('A II', 'Barren', [74, 66, 52, 47, 39]),
  planet('B I', 'Lava', [88, 79, 63, 54, 42]),
  planet('B III', 'Plasma', [81, 72, 60, 50, 44]),
  planet('B VI', 'Gas', [76, 69, 55, 46, 40]),
  planet('B VII', 'Oceanic', [86, 70, 59, 48, 43]),
  planet('B II', 'Temperate', [78, 65, 54, 45, 38]),
  planet('C I', 'Ice', [72, 63, 51, 44, 37]),
];

const chars = (n: number): Character[] =>
  Array.from({ length: n }, (_, i) => ({ name: `C${i}`, icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 }));

const world = (n: number): SolveWorld => ({ operation: operation(chars(n)), planets: PLANETS, programHours: 24 });

const PRODUCTS = ['Broadcast Node', 'Recursive Computing Module', 'Organic Mortar Applicators', 'Coolant', 'Robotics'];
let failures = 0;
const gate = (name: string, cond: boolean): void => {
  if (!cond) { failures++; console.log(`  GATE FAIL: ${name}`); }
};
// Floors sit safely under the measured post-fix ratios but far above the
// pre-fix collapse (36–65%) — regressions trip, noise does not. RAISED
// 2026-09-03 after the T-13 joint (Lagrangian) bound landed: measured n≥5
// ratios rose to BN 84–96 / RCM 81–94 / OMA 81–95 / Coolant 97–99 /
// Robotics 85 flat. Raise floors only with new measured headroom — never
// lower them to pass.
const FLOOR: Record<string, number> = {
  'Broadcast Node': 0.80, 'Recursive Computing Module': 0.78,
  'Organic Mortar Applicators': 0.78, 'Coolant': 0.90, 'Robotics': 0.80,
};

console.log('== 1. greedy realized vs upper bound (and exhaustive where it runs) ==');
for (const n of [1, 2, 3, 5, 10, 17]) {
  const w = world(n);
  for (const product of PRODUCTS) {
    const s = defaultSourcing(w, product);
    const g = solveMax(w, product, s, { method: 'greedy' });
    const a = n <= 3 ? solveMax(w, product, s) : null; // auto → exhaustive on tiny worlds
    const gs = 'error' in g ? `ERR(${g.error.slice(0, 40)})` : `${Math.round(g.realizedPerWeek)} (${(100 * g.realizedPerWeek / g.upperBoundPerWeek).toFixed(0)}% of UB)`;
    if (!('error' in g) && n >= 5) gate(`${product} n=${n} ≥ ${FLOOR[product]! * 100}% of UB`, g.realizedPerWeek / g.upperBoundPerWeek >= FLOOR[product]!);
    const as = a === null ? '' : ('error' in a ? ` | auto ERR` : ` | ${a.method} ${Math.round(a.realizedPerWeek)} (${(100 * a.realizedPerWeek / a.upperBoundPerWeek).toFixed(0)}%)`);
    console.log(`  n=${String(n).padStart(2)} ${product.padEnd(28)} greedy ${gs}${as}`);
  }
}

console.log('\n== 2. quota refusals at fractions of the solver\'s OWN greedy max ==');
let refusals = 0, checks = 0;
for (const n of [2, 3, 5, 10, 17]) {
  const w = world(n);
  for (const product of PRODUCTS) {
    const s = defaultSourcing(w, product);
    const g = solveMax(w, product, s, { method: 'greedy' });
    if ('error' in g) continue;
    for (const frac of [0.25, 0.5, 0.75, 0.9, 1.0]) {
      const target = Math.floor(g.realizedPerWeek * frac);
      if (target < 1) continue;
      checks++;
      const q = solveQuota(w, product, target, s);
      if ('error' in q) {
        refusals++;
        console.log(`  REFUSED n=${n} ${product} target=${target} (${frac * 100}% of its own max ${Math.round(g.realizedPerWeek)}): ${q.error.slice(0, 90)}`);
      }
    }
  }
}
console.log(`  quota refusal rate: ${refusals}/${checks}`);
gate('quota never refuses a target the solver itself can reach', refusals === 0);

console.log('\n== 3. 60/40 P4 mix quota at half the mix-max bundle ==');
for (const n of [5, 10, 17]) {
  const w = world(n);
  const entries = [
    { product: 'Broadcast Node', share: 60, sourcing: defaultSourcing(w, 'Broadcast Node') },
    { product: 'Recursive Computing Module', share: 40, sourcing: defaultSourcing(w, 'Recursive Computing Module') },
  ];
  const mm = solveMixMax(w, entries);
  if ('error' in mm) { console.log(`  n=${n} mix-max ERR: ${mm.error.slice(0, 80)}`); continue; }
  const half = Math.floor(mm.bundlePerWeek * 0.5);
  const q = solveMixQuota(w, entries, half);
  console.log(`  n=${n} mix-max bundle=${Math.round(mm.bundlePerWeek)}/wk → quota at ${half}: ${'error' in q ? 'REFUSED: ' + q.error.slice(0, 70) : 'ok, bundle ' + Math.round(q.bundlePerWeek)}`);
  const q9 = solveMixQuota(w, entries, Math.floor(mm.bundlePerWeek * 0.9));
  console.log(`      quota at 90% (${Math.floor(mm.bundlePerWeek * 0.9)}): ${'error' in q9 ? 'REFUSED: ' + q9.error.slice(0, 70) : 'ok, bundle ' + Math.round(q9.bundlePerWeek)}`);
  gate(`mix quota n=${n} plans at 50% of mix-max`, !('error' in q));
  gate(`mix quota n=${n} plans at 90% of mix-max`, !('error' in q9));
}

console.log('\n== 4. upper bound stays a BOUND under stackingPenalty (Round-2 fix) ==');
// Two planets on the same resource pool is the minimal violating shape for the
// old drain-a-planet-first bound walk; the UI default penalty is 0.10.
const stackWorld = (n: number, penalty: number): SolveWorld => ({
  operation: operation(chars(n)),
  planets: [planet('X I', 'Storm', [80, 70, 60, 50, 45]), planet('X II', 'Storm', [78, 68, 58, 48, 43]), planet('X III', 'Barren', [70, 60, 50, 45, 40])],
  programHours: 24, stackingPenalty: penalty,
});
let stackWorst = 0;
for (const penalty of [0.1, 0.5, 0.8]) {
  for (const n of [2, 5, 17]) {
    for (const product of ['Coolant', 'Synthetic Oil', 'Condensates']) {
      const w = stackWorld(n, penalty);
      const r = solveMax(w, product, defaultSourcing(w, product), { method: 'greedy' });
      if ('error' in r) continue;
      const ratio = r.realizedPerWeek / r.upperBoundPerWeek;
      if (ratio > stackWorst) stackWorst = ratio;
      gate(`stacking p=${penalty} n=${n} ${product}: realized ≤ UB`, ratio <= 1 + 1e-6);
    }
  }
}
console.log(`  worst realized/UB under stacking: ${(stackWorst * 100).toFixed(1)}% (must be ≤ 100%)`);

console.log('\n== 5. JOINT bound honesty on planet-contention worlds (T-13 fix) ==');
// Two planets, many characters: extraction for two inputs + factory sites
// all fight for the same per-planet command-center capacity. The old
// per-input-independent bound ignored that and made good plans look bad;
// the Lagrangian joint bound must certify them at their true quality.
const contentionWorld = (n: number): SolveWorld => ({
  operation: operation(chars(n)),
  planets: [
    { name: 'X I', type: 'Storm', resources: { 'Aqueous Liquids': 12000, 'Ionic Solutions': 11000 } },
    { name: 'X II', type: 'Barren', resources: { 'Aqueous Liquids': 11000, 'Base Metals': 10000 } },
  ],
  programHours: 24, stackingPenalty: 0.1,
});
// Floors from measured post-T-13 ratios (85/94/98/99% at n=5/10/17/30).
for (const [n, floor] of [[5, 0.80], [10, 0.88], [17, 0.92], [30, 0.95]] as const) {
  const w = contentionWorld(n);
  const r = solveMax(w, 'Coolant', defaultSourcing(w, 'Coolant'), { method: 'greedy' });
  if ('error' in r) { gate(`contention n=${n} solves`, false); continue; }
  const ratio = r.realizedPerWeek / r.upperBoundPerWeek;
  console.log(`  n=${String(n).padStart(2)} Coolant on 2 contended planets: ${(ratio * 100).toFixed(1)}% of UB (floor ${floor * 100}%)`);
  gate(`contention n=${n}: realized ≤ UB`, ratio <= 1 + 1e-6);
  gate(`contention n=${n}: joint bound certifies ≥ ${floor * 100}%`, ratio >= floor);
}

if (failures > 0) { console.log(`\nALLOCATOR GATE: ${failures} regression(s)`); process.exit(1); }
console.log('\nALLOCATOR GATE: green.');
