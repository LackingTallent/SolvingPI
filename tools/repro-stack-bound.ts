/** Round-2 verification: realized must never exceed upperBound at any stackingPenalty. */
import { solveMax, type SolveWorld, type PlanetInfo } from '../src/engine/allocator.js';
import { defaultSourcing } from '../src/engine/modes.js';
import { operation, type Character } from '../src/world/characters.js';
import { resourcesOf } from '../src/world/planets.js';
import { wFromDensityPct } from '../src/world/density.js';
import type { PlanetType } from '../src/spec/schematics.js';

const planet = (name: string, type: PlanetType, pct: number[]): PlanetInfo => ({
  name, type,
  resources: Object.fromEntries(resourcesOf(type).map((p0, i) => [p0, wFromDensityPct(pct[i % pct.length]!)])),
});
const chars = (n: number): Character[] =>
  Array.from({ length: n }, (_, i) => ({ name: `C${i}`, icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 }));

// The math agent's minimal case: two planets carrying the SAME resource pool,
// plus factory ground — spread placement interleaves fresh deposits.
const WORLDS: Array<[string, PlanetInfo[]]> = [
  ['two-same', [planet('X I', 'Storm', [80, 70, 60, 50, 45]), planet('X II', 'Storm', [78, 68, 58, 48, 43]), planet('X III', 'Barren', [70, 60, 50, 45, 40])]],
  ['diag-board', [
    planet('A IV', 'Storm', [92, 71, 64, 55, 48]), planet('A V', 'Gas', [83, 77, 58, 51, 45]),
    planet('A VI', 'Storm', [68, 61, 57, 49, 41]), planet('A II', 'Barren', [74, 66, 52, 47, 39]),
    planet('B I', 'Lava', [88, 79, 63, 54, 42]), planet('B III', 'Plasma', [81, 72, 60, 50, 44]),
    planet('B VI', 'Gas', [76, 69, 55, 46, 40]), planet('B VII', 'Oceanic', [86, 70, 59, 48, 43]),
    planet('B II', 'Temperate', [78, 65, 54, 45, 38]), planet('C I', 'Ice', [72, 63, 51, 44, 37]),
  ]],
];
const PRODUCTS = ['Coolant', 'Robotics', 'Broadcast Node', 'Synthetic Oil', 'Condensates'];
let worst = 0; let fails = 0;
for (const [wname, planets] of WORLDS) {
  for (const penalty of [0, 0.1, 0.3, 0.5, 0.8]) {
    for (const n of [1, 2, 3, 5, 10, 17, 50]) {
      const w: SolveWorld = { operation: operation(chars(n)), planets, programHours: n >= 17 ? 336 : 24, stackingPenalty: penalty };
      for (const product of PRODUCTS) {
        let r;
        try { r = solveMax(w, product, defaultSourcing(w, product), { method: 'greedy' }); } catch { continue; }
        if ('error' in r) continue;
        const ratio = r.realizedPerWeek / r.upperBoundPerWeek;
        if (ratio > worst) worst = ratio;
        if (ratio > 1 + 1e-6) {
          fails++;
          console.log(`VIOLATION ${wname} p=${penalty} n=${n} ${product}: realized ${r.realizedPerWeek.toFixed(1)} > UB ${r.upperBoundPerWeek.toFixed(1)} (${(ratio * 100).toFixed(1)}%)`);
        }
      }
    }
  }
}
console.log(`worst realized/UB ratio: ${(worst * 100).toFixed(2)}%  violations: ${fails}`);
process.exit(fails > 0 ? 1 : 0);
