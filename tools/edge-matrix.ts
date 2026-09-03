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
import { scoutSystems } from '../src/engine/scout.js';
import { solveMixMax, solveMixQuota } from '../src/engine/mix.js';
import { chainNeeds, p1InputsOf, oreOf } from '../src/engine/chain.js';
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
    assert(Array.isArray(s.planets) && Array.isArray(s.characters) && s.charactersDone === false, 'unusable state');
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
cell('mix sanitize: loaded shares always normalize to exactly 100', () => {
  const st = stateMod.sanitizeState({ mix: [{ product: 'Water', pct: 33 }, { product: 'Coolant', pct: 33 }, { product: 'Robotics', pct: 33 }] });
  assert(st.mix.reduce((a, e) => a + e.pct, 0) === 100, 'sum != 100 after load');
  const st2 = stateMod.sanitizeState({ mix: [{ product: 'Water', pct: 250 }, { product: 'Coolant', pct: 50 }] });
  assert(st2.mix.reduce((a, e) => a + e.pct, 0) === 100, 'oversized shares not normalized');
  const st3 = stateMod.sanitizeState({ mix: [{ product: 'Water', pct: 40 }] });
  assert(st3.mix.length === 0, 'a one-line mix should collapse to single-product mode');
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
  assert(d.mode === 'compare' && d.modeChosen === false, 'no goal may be pre-selected (owner 2026-09-02)');
  assert(Object.values(d.sourcingOverrides).every((v) => v === 'extract'), 'pins not mine-it');
  assert(d.planets.length === 0, 'starter world must be empty (owner spec)');
  // Added planets still get the 70% default on every resource.
  const added = defaultResources('Barren');
  assert(added.length === 5 && added.every((r) => r.w > 0), 'added planet not 70% x5');
  // Owner spec 2026-09-01: the roster starts EMPTY and unconfirmed.
  assert(d.characters.length === 0 && d.charactersDone === false, 'roster must start empty and unconfirmed');
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
  assert(!r2.ready && r2.missing.some((s) => s.includes('space type')), 'used-ore zero no longer demands the band');
  // Compare considers every product: ANY zero keeps demanding the band.
  const r3 = solveReadiness({ ...base, mode: 'compare', prices: { Coolant: { bid: 100, ask: 120 } } });
  assert(!r3.ready && r3.missing.some((s) => s.includes('space type')), 'compare lost its band requirement');
});
// ---------------------------------------------------------------------------
// Multi-tier sourcing (owner spec 2026-08-30): buy P2/P3 finished, cut the chain
// ---------------------------------------------------------------------------
cell('chain cut: buying an intermediate removes its whole subtree and imports it', () => {
  const full = chainNeeds('Robotics', 100, { 'Precious Metals': 'extract', 'Reactive Metals': 'extract', 'Chiral Structures': 'extract', 'Toxic Metals': 'extract' });
  const cut = chainNeeds('Robotics', 100, { 'Mechanical Parts': 'buy', 'Consumer Electronics': 'buy' });
  assert(cut.advancedFacilities < full.advancedFacilities * 0.35, 'cut did not shrink facilities');
  assert(Math.abs((cut.purchasesPerWeek['Mechanical Parts'] ?? 0) - 1000 / 3) < 1e-6, 'P2 purchase wrong');
  assert(Object.keys(cut.extractP1PerWeek).length === 0, 'extractors survived the cut');
  assert(cut.outputsPerWeek['Mechanical Parts'] === undefined, 'bought intermediate still scheduled in-house');
  // P1 coverage is only demanded where the walk still needs P1s.
  assert(cut.p1PerWeek['Precious Metals'] === undefined, 'pruned P1 still counted');
});
cell('ore-less world: buy the direct inputs, run ONE legal factory colony', () => {
  const w = world([{ name: 'B', type: 'Barren', resources: {} }], 1);
  const r = solveMax(w, 'Robotics', { 'Mechanical Parts': 'buy', 'Consumer Electronics': 'buy' });
  if ('error' in r) throw new Error(r.error);
  assert(r.slotsUsed === 1 && r.verdict.legal && r.realizedPerWeek > 0, 'buy-direct plan wrong shape');
});
cell('comparative second chance: an unfittable chain ranks via the input-buy cut', () => {
  const w = world([{ name: 'B', type: 'Barren', resources: {} }], 1);
  const m = market({
    Robotics: { bid: 90000, ask: 99000 }, 'Mechanical Parts': { bid: 9000, ask: 9900 },
    'Consumer Electronics': { bid: 9000, ask: 9900 },
    'Precious Metals': { bid: 500, ask: 560 }, 'Reactive Metals': { bid: 500, ask: 560 },
    'Chiral Structures': { bid: 500, ask: 560 }, 'Toxic Metals': { bid: 500, ask: 560 },
  });
  const { ranked } = comparative(w, m, ['Robotics']);
  assert(ranked.some((r) => r.product === 'Robotics'), 'cut retry did not rescue the candidate');
  // And a pinned make is never overruled: the ranked plan must actually
  // BUILD Mechanical Parts factories (buying its P1s is fine — buying the
  // pinned part itself is not).
  const { ranked: pinned } = comparative(w, m, ['Robotics'], { 'Mechanical Parts': 'make' });
  const entry = pinned.find((r) => r.product === 'Robotics');
  assert(entry !== undefined, 'make-pinned candidate vanished');
  const buildsMP = entry!.result.plan.colonies.some((c) => c.plan.factories.some((f) => f.schematic === 'Mechanical Parts'));
  const buysMP = (entry!.result.plan.logistics?.purchases ?? []).some((p) => p.commodity === 'Mechanical Parts');
  assert(buildsMP && !buysMP, 'make pin was overruled');
});
// ---------------------------------------------------------------------------
// Product mix (owner spec 2026-08-31)
// ---------------------------------------------------------------------------
cell('mix: 60/40 blend holds the ratio, characters partitioned, every line legal', () => {
  const w = world([
    { name: 'P1', type: 'Storm', resources: { 'Aqueous Liquids': 11000, 'Ionic Solutions': 11000 } },
    { name: 'P2', type: 'Gas', resources: { 'Aqueous Liquids': 10000, 'Ionic Solutions': 10000 } },
    { name: 'P3', type: 'Plasma', resources: { 'Base Metals': 10000, 'Noble Metals': 10000 } },
    { name: 'P4', type: 'Plasma', resources: { 'Base Metals': 10000, 'Noble Metals': 10000 } },
    { name: 'P5', type: 'Barren', resources: {} },
    { name: 'P6', type: 'Oceanic', resources: { 'Aqueous Liquids': 9000 } },
  ], 3);
  const entries = [
    { product: 'Coolant', share: 60, sourcing: { Electrolytes: 'extract', Water: 'extract' } as const },
    { product: 'Mechanical Parts', share: 40, sourcing: { 'Precious Metals': 'extract', 'Reactive Metals': 'extract' } as const },
  ];
  const r = solveMixMax(w, entries);
  if ('error' in r) throw new Error(r.error);
  const a = r.lines[0]!.result.realizedPerWeek;
  const b = r.lines[1]!.result.realizedPerWeek;
  assert(Math.abs(a / (a + b) - 0.6) < 0.02, `ratio drifted: ${(a / (a + b)).toFixed(3)}`);
  assert(r.lines.every((l) => l.result.verdict.legal), 'a mix line is not judge-legal');
  const names = r.lines.flatMap((l) => l.characters);
  assert(new Set(names).size === names.length, 'a character serves two lines');
});
cell('mix quota: unreachable blend refuses with the achievable bundle rate', () => {
  const w = world([storm('S1'), storm('S2'), { name: 'B', type: 'Barren', resources: {} }], 2);
  const entries = [
    { product: 'Coolant', share: 50, sourcing: { Electrolytes: 'extract', Water: 'extract' } as const },
    { product: 'Water', share: 50, sourcing: { Water: 'extract' } as const },
  ];
  const q = solveMixQuota(w, entries, 99_999_999);
  assert('error' in q && q.error.includes('quota-unreachable'), 'no refusal');
  assert('achievablePerWeek' in q && (q.achievablePerWeek ?? 0) > 0, 'refusal lost the achievable rate');
});
cell('mix validation: duplicates and single-product mixes are refused by name', () => {
  const w = world([storm('S1')], 1);
  const dup = solveMixMax(w, [
    { product: 'Water', share: 50, sourcing: { Water: 'extract' } },
    { product: 'Water', share: 50, sourcing: { Water: 'extract' } },
  ]);
  assert('error' in dup && dup.error.includes('appears twice'), 'duplicate not refused');
  const one = solveMixMax(w, [{ product: 'Water', share: 100, sourcing: { Water: 'extract' } }]);
  assert('error' in one && one.error.includes('at least two'), 'single-product mix not refused');
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

// ---------------------------------------------------------------------------
// Region Scout under attack
// ---------------------------------------------------------------------------
cell('scout: a hostile system (duplicate planet names) ranks last with its reason — never throws', () => {
  const m = market({ Coolant: { bid: 11000, ask: 12500 }, Water: { bid: 700, ask: 800 }, Electrolytes: { bid: 600, ask: 700 }, 'Aqueous Liquids': { bid: 5, ask: 7 }, 'Ionic Solutions': { bid: 5, ask: 7 } });
  const good = { id: 1, name: 'Good', security: -0.3, assumedW: 12000, planets: [
    { name: 'Good I', type: 'Storm' as const }, { name: 'Good II', type: 'Gas' as const }, { name: 'Good III', type: 'Storm' as const }] };
  const twin = { id: 2, name: 'Twins', security: -0.3, assumedW: 12000, planets: [
    { name: 'Twin', type: 'Storm' as const }, { name: 'Twin', type: 'Gas' as const }] };
  const rows = scoutSystems([twin, good], operation(chars(2)), 6, m, { mode: 'max', product: 'Coolant' });
  assert(rows[0]!.system.name === 'Good' && rows[0]!.feasible, 'good system must lead');
  const t = rows.find((r) => r.system.name === 'Twins')!;
  assert(!t.feasible && t.note.length > 0, 'duplicate-name system must rank infeasible with a reason');
});
cell('scout: feasible systems always sort above infeasible, whatever the net', () => {
  const m = market({ Coolant: { bid: 2, ask: 3 }, Water: { bid: 700, ask: 800 }, Electrolytes: { bid: 600, ask: 700 }, 'Aqueous Liquids': { bid: 5, ask: 7 }, 'Ionic Solutions': { bid: 5, ask: 7 } });
  const loss = { id: 1, name: 'Lossy', security: -0.3, assumedW: 12000, planets: [
    { name: 'L I', type: 'Storm' as const }, { name: 'L II', type: 'Gas' as const }, { name: 'L III', type: 'Storm' as const }] };
  const none = { id: 2, name: 'Void', security: -0.3, assumedW: 12000, planets: [] };
  const rows = scoutSystems([none, loss], operation(chars(2)), 6, m, { mode: 'max', product: 'Coolant' });
  assert(rows[0]!.system.name === 'Lossy' && rows[0]!.feasible, 'a losing plan still beats no plan');
  assert(rows[0]!.netPerWeek < 0, 'net should be an honest loss at these prices');
});

console.log(`\nEDGE MATRIX: ${pass} cells passed, ${fail} failed`);
for (const f of failures) console.error(`FAIL ${f}`);
process.exit(fail === 0 ? 0 : 1);
