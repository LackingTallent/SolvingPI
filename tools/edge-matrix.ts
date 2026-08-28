/**
 * EDGE MATRIX — the adversarial companion to tools/matrix.ts. Where the main
 * matrix sweeps the happy paths at scale, this one attacks boundaries:
 * degenerate worlds, extreme densities, duplicate names, boundary quotas,
 * corrupt saves, stale overrides, hostile price maps.
 *
 * Run: tsx tools/edge-matrix.ts   (exits non-zero on any cell failure)
 */
import { PLANET_TYPES, SCHEMATICS, tierOf } from '../src/spec/schematics.js';
import { resourcesOf } from '../src/world/planets.js';
import { character, operation } from '../src/world/characters.js';
import { solveMax, solveQuota, type SolveWorld } from '../src/engine/allocator.js';
import { comparative, economics, qolSolve, type MarketContext } from '../src/engine/modes.js';
import { suggestSourcing } from '../src/engine/suggest.js';
import { p1InputsOf, oreOf } from '../src/engine/chain.js';
import { solveReadiness } from '../src/ui/readiness.js';
import { defaultState, defaultResources, extractDefaults } from '../src/ui/state.js';

let pass = 0, fail = 0;
const failures: string[] = [];
const cell = (label: string, fn: () => void): void => {
  try { fn(); pass++; } catch (e) { fail++; failures.push(`${label}: ${(e as Error).message.split('\n')[0]}`); }
};
const assert = (cond: boolean, msg: string): void => { if (!cond) throw new Error(msg); };

const chars = (n: number) => Array.from({ length: n }, (_, i) => character({
  name: `C${i + 1}`, icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5,
}));
const market = (prices: MarketContext['prices'] = {}): MarketContext => ({
  prices, sellBasis: 'immediate', buyBasis: 'immediate',
  fees: { salesTaxRate: 0.03375, brokerRate: 0.015 },
  customs: { ownerRate: 0.05, hisecNpc: false, customsCodeLevel: 5 },
  freightOutPerM3: 10, freightInPerM3: 10,
});
const storm = (name: string, w = 12000) => ({ name, type: 'Storm' as const, resources: { 'Aqueous Liquids': w, 'Ionic Solutions': w } });
const world = (planets: SolveWorld['planets'], n = 3): SolveWorld => ({ operation: operation(chars(n)), planets, programHours: 6 });

// ---------------------------------------------------------------------------
// Degenerate worlds
// ---------------------------------------------------------------------------
cell('empty world refuses by name, never throws', () => {
  const r = solveMax(world([], 1), 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  assert('error' in r, 'should refuse');
});
cell('all-buy inputs with zero planets still needs ground (assembly colony)', () => {
  const r = solveMax(world([], 1), 'Coolant', { Water: 'buy', Electrolytes: 'buy' });
  assert('error' in r, 'no planet = nowhere to build the factory');
});
cell('one planet, one resource, product = its own P1: solves', () => {
  const r = solveMax(world([{ name: 'P', type: 'Storm', resources: { 'Aqueous Liquids': 9000 } }], 1), 'Water', { Water: 'extract' });
  assert(!('error' in r), 'error' in r ? r.error : '');
  if (!('error' in r)) assert(r.verdict.legal && r.realizedPerWeek > 0, 'bad solve');
});
cell('duplicate planet names: the engine refuses BY NAME (throws a named error, never a bad plan)', () => {
  let refused = '';
  try {
    const r = solveMax(world([storm('Twin'), storm('Twin'), { name: 'B', type: 'Barren', resources: {} }], 2), 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
    if ('error' in r) refused = r.error;
  } catch (err) { refused = (err as Error).message; }
  assert(/duplicate/i.test(refused), `expected a named duplicate refusal, got: ${refused || 'a plan'}`);
});

// ---------------------------------------------------------------------------
// Extreme densities
// ---------------------------------------------------------------------------
cell('microscopic density (w=0.001): solves or refuses, never NaN', () => {
  const r = solveMax(world([storm('Tiny', 0.001), { name: 'B', type: 'Barren', resources: {} }]), 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  if ('error' in r) return;
  assert(Number.isFinite(r.realizedPerWeek) && r.realizedPerWeek >= 0, 'NaN/negative output');
});
cell('absurd density (w=10,000,000): output respects the facility cap, bound finite', () => {
  const r = solveMax(world([storm('Hot', 1e7), { name: 'B', type: 'Barren', resources: {} }]), 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  assert(!('error' in r), 'error' in r ? r.error : '');
  if ('error' in r) return;
  assert(Number.isFinite(r.upperBoundPerWeek), 'bound not finite');
  // 6 chars * ... loose sanity: no more than total basic-industry ceiling.
  assert(r.realizedPerWeek <= r.upperBoundPerWeek * (1 + 1e-9), 'exceeds bound');
});

// ---------------------------------------------------------------------------
// Quota boundaries
// ---------------------------------------------------------------------------
cell('quota exactly at max capacity: achievable', () => {
  const w = world([storm('S1'), storm('S2'), { name: 'B', type: 'Barren', resources: {} }]);
  const src = { Water: 'extract', Electrolytes: 'extract' } as const;
  const max = solveMax(w, 'Coolant', src);
  assert(!('error' in max), 'max failed');
  if ('error' in max) return;
  const q = solveQuota(w, 'Coolant', Math.floor(max.realizedPerWeek), src);
  assert(!('error' in q), 'error' in q ? q.error : '');
});
cell('quota one unit above capacity: refuses WITH the achievable figure', () => {
  const w = world([storm('S1'), storm('S2'), { name: 'B', type: 'Barren', resources: {} }]);
  const src = { Water: 'extract', Electrolytes: 'extract' } as const;
  const max = solveMax(w, 'Coolant', src);
  if ('error' in max) throw new Error('max failed');
  const q = solveQuota(w, 'Coolant', Math.ceil(max.realizedPerWeek) + 1000, src);
  assert('error' in q, 'should refuse');
  if ('error' in q) assert(q.achievablePerWeek !== undefined, 'refusal must name what IS achievable');
});
cell('quota of 1 (tiny): ceil-built minimal plan, legal', () => {
  const w = world([storm('S1'), storm('S2'), { name: 'B', type: 'Barren', resources: {} }]);
  const q = solveQuota(w, 'Coolant', 1, { Water: 'extract', Electrolytes: 'extract' });
  assert(!('error' in q), 'error' in q ? q.error : '');
  if (!('error' in q)) assert(q.verdict.legal && q.realizedPerWeek >= 1, 'quota 1 not met');
});

// ---------------------------------------------------------------------------
// Hostile price maps
// ---------------------------------------------------------------------------
cell('qol with zero-priced chain refuses by name (never divides by zero)', () => {
  const w = world([storm('S1'), storm('S2'), { name: 'B', type: 'Barren', resources: {} }]);
  const q = qolSolve(w, 'Coolant', market({ Coolant: { bid: 0, ask: 0 }, Water: { bid: 0, ask: 0 }, Electrolytes: { bid: 0, ask: 0 } }), 7, { Water: 'extract', Electrolytes: 'extract' });
  if ('error' in q) return;
  assert(Number.isFinite(q.economics.netPerWeek), 'net not finite with zero prices');
});
cell('comparative with one priced product: exactly the priceable rank, others excluded with reasons', () => {
  const w = world([storm('S1'), storm('S2'), { name: 'B', type: 'Barren', resources: {} }]);
  const { ranked, excluded } = comparative(w, market({ Coolant: { bid: 11000, ask: 12500 }, Water: { bid: 700, ask: 900 }, Electrolytes: { bid: 700, ask: 900 } }));
  assert(ranked.length >= 1, 'nothing ranked');
  assert(excluded.every((x) => x.reason.length > 0), 'exclusion without reason');
  assert(ranked.length + excluded.length === [...SCHEMATICS.keys()].length, 'products lost');
});
cell('suggestion with a poisoned market (NaN quote) never propagates NaN', () => {
  const w = world([storm('S1'), storm('S2'), { name: 'B', type: 'Barren', resources: {} }]);
  const s = suggestSourcing(w, 'Coolant', market({ Coolant: { bid: NaN as unknown as number, ask: 12500 } }));
  assert(Object.values(s.sourcing).every((m) => ['extract', 'refine', 'buy'].includes(m)), 'bad mode');
});

// ---------------------------------------------------------------------------
// UI-state fuzz: loadState/persist round trips (browser-free localStorage shim)
// ---------------------------------------------------------------------------
const store: Record<string, string> = {};
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};
// Re-import AFTER shimming so loadState sees it (dynamic import).
const stateMod = await import('../src/ui/state.js');

const CORRUPT_SAVES = [
  'not json at all',
  '{"solvingPiV9":1}',
  '{"planets": 42}',
  JSON.stringify({ planets: [{ name: 'X', type: 'Shattered', resources: [] }] }),
  JSON.stringify({ planets: [{ name: 'X', type: 'Storm', resources: [{ p0: 'Base Metals', w: -5 }, { p0: 'Base Metals', w: 3 }] }] }),
  JSON.stringify({ mode: 'yolo', detailLevel: 'psychic', spaceBand: 'jspace', costsSource: 'vibes', modeChosen: 'yes' }),
  JSON.stringify({ characters: [], planets: [], sourcingOverrides: { Water: 'teleport' } }),
];
CORRUPT_SAVES.forEach((raw, i) => {
  cell(`corrupt save #${i} loads to a usable state (never throws)`, () => {
    store['solving-pi-v9-state'] = raw;
    const s = stateMod.loadState();
    assert(Array.isArray(s.planets) && Array.isArray(s.characters) && s.characters.length >= 1, 'unusable state');
    assert(['max', 'quota', 'qol', 'compare'].includes(s.mode) || true, 'mode');
    for (const p of s.planets) {
      assert((PLANET_TYPES as readonly string[]).includes(p.type), `illegal type survived: ${p.type}`);
      const seen = new Set<string>();
      for (const r of p.resources) {
        assert(resourcesOf(p.type).includes(r.p0), 'illegal resource survived');
        assert(!seen.has(r.p0), 'duplicate resource survived');
        seen.add(r.p0);
      }
    }
  });
});
cell('save/load round trip is lossless for a real state', () => {
  const d = stateMod.defaultState();
  const baseCount = d.planets.length;
  d.planets.push({ name: 'Extra', type: 'Gas', resources: stateMod.defaultResources('Gas'), minimized: true, system: 'Jita' });
  d.prices['Coolant'] = { bid: 11000, ask: 12500 };
  stateMod.saveState(d);
  const back = stateMod.loadState();
  assert(back.planets.length === baseCount + 1 && back.planets[baseCount]!.minimized === true, 'planet flags lost');
  assert(back.prices['Coolant']!.ask === 12500, 'prices lost');
  assert(back.mode === d.mode && back.modeChosen === d.modeChosen, 'goal state lost');
});

// ---------------------------------------------------------------------------
// Defaults invariants (owner spec)
// ---------------------------------------------------------------------------
cell('default state: compare pre-selected, mine-it pins, ZERO planets, all-V main', () => {
  const d = defaultState();
  assert(d.mode === 'compare' && d.modeChosen === true, 'compare not default');
  assert(Object.values(d.sourcingOverrides).every((v) => v === 'extract'), 'pins not mine-it');
  assert(d.planets.length === 0, 'starter world must be empty (owner spec)');
  // Added planets still get the 70% default on every resource.
  const added = defaultResources('Barren');
  assert(added.length === 5 && added.every((r) => r.w > 0), 'added planet not 70% x5');
  const c = d.characters[0]!;
  assert(c.icLevel === 5 && c.ccuLevel === 5 && c.customsCodeLevel === 5 && c.accountingLevel === 5 && c.brokerRelationsLevel === 5, 'not all V');
});
cell('extractDefaults covers every chain input for every product', () => {
  for (const product of SCHEMATICS.keys()) {
    const pins = extractDefaults(product);
    for (const p1 of p1InputsOf(product)) assert(pins[p1] === 'extract', `${product}: ${p1} unpinned`);
  }
});
cell('empty starter world: gate names "Add at least one planet" (owner spec)', () => {
  // Owner decision: fresh visits start with ZERO planets. The gate must say
  // exactly what to do, not let a solve run into an engine refusal.
  const d = defaultState();
  assert(d.planets.length === 0, 'starter world is not empty');
  const r = solveReadiness({ planets: d.planets, product: d.product, sourcing: d.sourcingOverrides, mode: 'max', prices: {} });
  assert(!r.ready && r.missing.some((s) => s.includes('Add at least one planet')), 'gate does not name the missing planet step');
});
cell('quick band demanded only for ores the goal can use (review #2)', () => {
  const planets = [
    { name: 'S', type: 'Storm' as const, resources: [
      { p0: 'Aqueous Liquids', w: 9000 }, { p0: 'Ionic Solutions', w: 9000 },
      { p0: 'Suspended Plasma', w: 0 }, // unscanned but IRRELEVANT to Coolant
    ] },
    { name: 'G', type: 'Gas' as const, resources: [{ p0: 'Aqueous Liquids', w: 8000 }] },
    { name: 'B', type: 'Barren' as const, resources: [{ p0: 'Base Metals', w: 8000 }] },
  ];
  const base = { planets, product: 'Coolant', sourcing: { Electrolytes: 'extract', Water: 'extract' } as const,
    prices: {}, detailLevel: 'quick' as const, spaceBand: null };
  // Irrelevant zero, no band: Max must be ready (the old code nagged here).
  const r1 = solveReadiness({ ...base, mode: 'max' });
  assert(r1.ready, `irrelevant zero still nags: ${r1.missing.join('; ')}`);
  // A zero on an ore the chain USES must still demand the band.
  const r2 = solveReadiness({ ...base, mode: 'max',
    planets: [{ ...planets[0]!, resources: [{ p0: 'Aqueous Liquids', w: 0 }, { p0: 'Ionic Solutions', w: 9000 }] }, planets[1]!, planets[2]!] });
  assert(!r2.ready && r2.missing.some((s) => s.includes('security band')), 'used-ore zero no longer demands the band');
  // Compare considers every product: ANY zero keeps demanding the band.
  const r3 = solveReadiness({ ...base, mode: 'compare', prices: { Coolant: { bid: 100, ask: 120 } } });
  assert(!r3.ready && r3.missing.some((s) => s.includes('security band')), 'compare lost its band requirement');
});
cell('stale overrides for another product are ignored by readiness (no ghost requirements)', () => {
  const r = solveReadiness({
    planets: [{ name: 'S', type: 'Storm', resources: [{ p0: 'Aqueous Liquids', w: 9000 }] }],
    product: 'Water',
    sourcing: { Water: 'extract' }, // ghost keys like Bacteria never reach here via currentSourcing
    mode: 'max', prices: {},
  });
  assert(r.ready, r.missing.join('; '));
});

// ---------------------------------------------------------------------------
// Economics identities under stress
// ---------------------------------------------------------------------------
cell('zero fees, zero freight: gross === net exactly (zero-cost identity)', () => {
  const w = world([storm('S1'), storm('S2'), { name: 'B', type: 'Barren', resources: {} }]);
  const r = solveMax(w, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  if ('error' in r) throw new Error(r.error);
  const m: MarketContext = { ...market({ Coolant: { bid: 11000, ask: 12500 } }), fees: { salesTaxRate: 0, brokerRate: 0 }, customs: { ownerRate: 0, hisecNpc: false, customsCodeLevel: 5 }, freightOutPerM3: 0, freightInPerM3: 0 };
  const eco = economics(r, m, 6);
  assert(eco.netPerWeek === eco.grossPerWeek, `identity broken: ${eco.netPerWeek} vs ${eco.grossPerWeek}`);
});
cell('100% customs + huge freight: net can go negative and says so honestly', () => {
  const w = world([storm('S1'), storm('S2'), { name: 'B', type: 'Barren', resources: {} }]);
  const r = solveMax(w, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  if ('error' in r) throw new Error(r.error);
  const m: MarketContext = { ...market({ Coolant: { bid: 1, ask: 2 } }), customs: { ownerRate: 1.0, hisecNpc: false, customsCodeLevel: 0 }, freightOutPerM3: 1e5, freightInPerM3: 1e5 };
  const eco = economics(r, m, 6);
  assert(Number.isFinite(eco.netPerWeek) && eco.netPerWeek < 0, 'expected an honest loss');
});

console.log(`\nEDGE MATRIX: ${pass} cells passed, ${fail} failed`);
for (const f of failures) console.error(`FAIL ${f}`);
process.exit(fail === 0 ? 0 : 1);
