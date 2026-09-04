import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractionOption, solveMax, solveQuota, upperBound, type SolveWorld } from '../src/engine/allocator.js';
import { deal } from '../src/engine/dealer.js';
import { validatePlan } from '../src/engine/judge.js';
import { character, operation } from '../src/world/characters.js';
import { comparative, defaultSourcing, economics, maxProfit, qolSolve, quota, type MarketContext } from '../src/engine/modes.js';

const chr = (name: string, ic: number, ccu = 5) =>
  character({ name, icLevel: ic, ccuLevel: ccu, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 });

const legacy = { cycleSecondsOverride: 1800 } as const;

function smallWorld(chars = 1, ic = 5): SolveWorld {
  return {
    operation: operation(Array.from({ length: chars }, (_, i) => chr(`c${i}`, ic))),
    planets: [
      { name: 'P-A', type: 'Storm', resources: { 'Aqueous Liquids': 13277.2694, 'Ionic Solutions': 12000 } },
      { name: 'P-B', type: 'Gas', resources: { 'Aqueous Liquids': 9000, 'Ionic Solutions': 13277.2694 } },
      { name: 'P-C', type: 'Barren', resources: { 'Aqueous Liquids': 7000, 'Base Metals': 11000 } },
      { name: 'P-D', type: 'Temperate', resources: { 'Aqueous Liquids': 5000 } },
    ],
    programHours: 6,
    extraction: legacy,
  };
}

const market: MarketContext = {
  prices: {
    Water: { bid: 750, ask: 900 },
    Electrolytes: { bid: 700, ask: 850 },
    'Reactive Metals': { bid: 650, ask: 800 },
    Coolant: { bid: 11000, ask: 12500 },
    'Aqueous Liquids': { bid: 4, ask: 6 },
  },
  sellBasis: 'immediate',
  buyBasis: 'immediate',
  fees: { salesTaxRate: 0.03375, brokerRate: 0.015 },
  customs: { ownerRate: 0.1, hisecNpc: false, customsCodeLevel: 5 },
  freightOutPerM3: 400,
  freightInPerM3: 400,
};

test('single P1 target: solver picks best planets and matches direct computation', () => {
  const world = smallWorld(1, 3); // 4 slots
  const r = solveMax(world, 'Water', { Water: 'extract' });
  assert.ok(!('error' in r), JSON.stringify(r));
  if ('error' in r) return;
  // 4 slots, 1 char → each planet once, all four carry Aqueous → total = sum of all 4 options
  const expected = world.planets
    .map((p) => extractionOption(p, 'Aqueous Liquids', world).p1PerWeek)
    .reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(r.realizedPerWeek - expected) < 1e-6, `${r.realizedPerWeek} vs ${expected}`);
  assert.equal(r.method, 'exhaustive');
  assert.equal(r.slotsUsed, 4);
  assert.ok(r.verdict.legal);
  // Exact answer certified: realized meets the fractional upper bound
  assert.ok(r.realizedPerWeek >= r.upperBoundPerWeek - 1e-6);
});

test('every emitted plan is judge-legal — asserted across products and worlds', () => {
  for (const chars of [1, 3]) {
    const world = smallWorld(chars);
    for (const product of ['Water', 'Coolant']) {
      const r = solveMax(world, product, defaultSourcing(world, product));
      assert.ok(!('error' in r), `${product}: ${JSON.stringify(r)}`);
      if ('error' in r) continue;
      const verdict = validatePlan(r.plan);
      assert.deepEqual(verdict.violations, [], `${chars} chars, ${product}`);
    }
  }
});

test('P2 target in a small world: exhaustive beats-or-matches every greedy-style mix and respects the UB', () => {
  const world = smallWorld(2, 2); // 6 slots
  const r = solveMax(world, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  assert.equal(r.method, 'exhaustive');
  const ub = upperBound(world, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  assert.ok(r.realizedPerWeek <= ub + 1e-6, 'exact answer cannot exceed the relaxation bound');
  assert.ok(r.realizedPerWeek >= 0.5 * ub, `suspiciously large gap: ${r.realizedPerWeek} vs UB ${ub}`);
  assert.ok(r.verdict.legal);
});

test('sourcing INFLUENCES the answer: buy-inputs must change the plan (the v8 dead-checkbox class)', () => {
  const world = smallWorld(2, 2);
  const extract = solveMax(world, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  const buy = solveMax(world, 'Coolant', { Water: 'buy', Electrolytes: 'buy' });
  assert.ok(!('error' in extract) && !('error' in buy));
  if ('error' in extract || 'error' in buy) return;
  // Buying frees every slot for factories: more product, purchases appear.
  assert.ok(buy.realizedPerWeek > extract.realizedPerWeek);
  assert.ok((buy.plan.logistics?.purchases.length ?? 0) > 0);
  assert.equal(extract.plan.logistics?.purchases.length ?? 0, 0);
  assert.notEqual(JSON.stringify(buy.plan.colonies), JSON.stringify(extract.plan.colonies));
});

test('program length INFLUENCES the answer: weekly cadence yields less than 6h cadence', () => {
  const w6 = smallWorld(2, 2);
  const w168: SolveWorld = { ...w6, programHours: 168 };
  const a = solveMax(w6, 'Water', { Water: 'extract' });
  const b = solveMax(w168, 'Water', { Water: 'extract' });
  assert.ok(!('error' in a) && !('error' in b));
  if ('error' in a || 'error' in b) return;
  assert.ok(b.realizedPerWeek < a.realizedPerWeek * 0.5, `${b.realizedPerWeek} vs ${a.realizedPerWeek}`);
});

test('quota mode: ceil-built to target, uses fewer slots than max-solve, names unreachable targets', () => {
  const world = smallWorld(3, 5); // 18 slots
  const full = solveMax(world, 'Water', { Water: 'extract' });
  assert.ok(!('error' in full));
  if ('error' in full) return;
  const q = solveQuota(world, 'Water', 50000, { Water: 'extract' });
  assert.ok(!('error' in q), JSON.stringify(q));
  if ('error' in q) return;
  assert.ok(q.realizedPerWeek >= 50000 - 1e-6);
  assert.ok(q.slotsUsed < full.slotsUsed, `${q.slotsUsed} vs ${full.slotsUsed}`);
  assert.ok(q.verdict.legal);

  const impossible = solveQuota(world, 'Water', 10_000_000, { Water: 'extract' });
  assert.ok('error' in impossible);
  if ('error' in impossible) {
    assert.match(impossible.error, /quota-unreachable/);
    assert.ok((impossible.achievablePerWeek ?? 0) > 0, 'achievable rate reported alongside the refusal');
  }
});

test('the dealer handles the [6,1,1] world the v8 dealer broke', () => {
  const op = operation([chr('main', 5), chr('a1', 0), chr('a2', 0)]);
  // 2 on X-1 + 2 on X-2 + 4 singles = 8 colonies on 8 slots. The planet pairs
  // must split across characters; main absorbs the singles.
  const colonies = [
    ...Array.from({ length: 2 }, () => ({ planetName: 'X-1', minCcuLevel: 0 })),
    ...Array.from({ length: 2 }, () => ({ planetName: 'X-2', minCcuLevel: 0 })),
    { planetName: 'X-3', minCcuLevel: 0 }, { planetName: 'X-4', minCcuLevel: 0 },
    { planetName: 'X-5', minCcuLevel: 0 }, { planetName: 'X-6', minCcuLevel: 0 },
  ];
  const dealt = deal(op, colonies);
  assert.ok(!('error' in dealt), JSON.stringify(dealt));
  if ('error' in dealt) return;
  const perChar = new Map<string, number>();
  for (const a of dealt.assignments) perChar.set(a.characterName, (perChar.get(a.characterName) ?? 0) + 1);
  assert.ok((perChar.get('main') ?? 0) <= 6 && (perChar.get('a1') ?? 0) <= 1 && (perChar.get('a2') ?? 0) <= 1);
  // 9th colony on a 8-slot op refuses by name
  const over = deal(op, [...colonies, { planetName: 'X-7', minCcuLevel: 0 }]);
  assert.ok('error' in over && /dealer-slots/.test(over.error));
  // 4 colonies on one planet with 3 characters refuses by name
  const crowded = deal(op, Array.from({ length: 4 }, () => ({ planetName: 'X-1', minCcuLevel: 0 })));
  assert.ok('error' in crowded && /dealer-planet-capacity/.test(crowded.error));
});

test('economics: zero-cost identity flows end to end; missing price refuses by name', () => {
  const world = smallWorld(2, 2);
  const r = solveMax(world, 'Water', { Water: 'extract' });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  const zeroMarket: MarketContext = {
    ...market,
    fees: { salesTaxRate: 0, brokerRate: 0 },
    customs: { ownerRate: 0, hisecNpc: false, customsCodeLevel: 0 },
    freightOutPerM3: 0, freightInPerM3: 0,
  };
  const eco = economics(r, zeroMarket, world.programHours);
  assert.equal(eco.netPerWeek, eco.grossPerWeek); // exact
  assert.throws(
    () => economics(r, { ...market, prices: { Coolant: market.prices['Coolant']! } }, world.programHours),
    /missing-price: Water/,
  );
});

test('cross-mode consistency: the same solved plan prices identically wherever it appears', () => {
  const world = smallWorld(2, 2);
  const r = solveMax(world, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  const a = economics(r, market, world.programHours);
  const b = economics(r, market, world.programHours);
  assert.equal(a.netPerWeek, b.netPerWeek);
  assert.equal(JSON.stringify(a.ledger.lines), JSON.stringify(b.ledger.lines));
  // And the comparative mode's Coolant entry uses the SAME economics function.
  const comp = comparative(world, market, ['Coolant']);
  assert.equal(comp.ranked.length, 1);
  assert.equal(comp.ranked[0]!.economics.netPerWeek, a.netPerWeek);
});

test('sell basis influences net: patient (ask+broker) differs from immediate (bid)', () => {
  const world = smallWorld(2, 2);
  const r = solveMax(world, 'Water', { Water: 'extract' });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  const imm = economics(r, market, 6);
  const pat = economics(r, { ...market, sellBasis: 'patient' }, 6);
  assert.notEqual(imm.netPerWeek, pat.netPerWeek);
  assert.equal(imm.ledger.broker, 0);
  assert.ok(pat.ledger.broker > 0);
});

test('maxProfit and qol: ranked frontier with named exclusions; QOL respects the session budget', () => {
  const world = smallWorld(2, 2);
  const mp = maxProfit(world, market, ['Water', 'Coolant', 'Robotics']);
  assert.ok(!('error' in mp));
  if ('error' in mp) return;
  assert.ok(mp.ranked.length >= 1);
  const robotics = mp.excluded.find((e) => e.product === 'Robotics');
  assert.ok(robotics && /missing-price|no-planet-for/.test(robotics.reason), JSON.stringify(mp.excluded));

  const q = qolSolve(world, 'Water', market, 2, { Water: 'extract' }); // ≤2 sessions/week
  assert.ok(!('error' in q));
  if ('error' in q) return;
  assert.ok(q.economics.sessionsPerWeek <= 2 + 1e-9);
  assert.ok(q.programHours >= 96);

  const qq = quota(world, 'Water', 30000, market);
  assert.ok(!('error' in qq));
});

test('SCALE SWEEP: 1..50 characters, heterogeneous skills, all legal, all fast', () => {
  const start = Date.now();
  for (const n of [1, 2, 5, 10, 25, 50]) {
    // Heterogeneous: 3-6 planets each; CCU 5/4/3 cycling starting at 5 so every
    // world has at least one character able to host a full advanced colony.
    const chars = Array.from({ length: n }, (_, i) => chr(`c${i}`, 2 + (i % 4), 5 - (i % 3)));
    const world: SolveWorld = {
      operation: operation(chars),
      // Spawn-matrix-respecting: Storm/Gas carry Aqueous+Ionic; Barren/Temperate carry Aqueous.
      planets: Array.from({ length: Math.max(6, Math.min(40, n * 2)) }, (_, i) => ({
        name: `PL-${i}`,
        type: (['Storm', 'Barren', 'Gas', 'Temperate'] as const)[i % 4]!,
        resources: i % 2 === 0
          ? { 'Aqueous Liquids': 8000 + 500 * (i % 7), 'Ionic Solutions': 9000 + 300 * (i % 5) }
          : { 'Aqueous Liquids': 7000 + 400 * (i % 6) },
      })),
      programHours: 6,
      extraction: legacy,
    };
    const r = solveMax(world, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
    assert.ok(!('error' in r), `${n} chars: ${JSON.stringify(r)}`);
    if ('error' in r) continue;
    assert.deepEqual(validatePlan(r.plan).violations, [], `${n} chars`);
    assert.ok(r.realizedPerWeek > 0);
    assert.ok(r.realizedPerWeek <= r.upperBoundPerWeek + 1e-6, `${n} chars: realized above UB`);
  }
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 15000, `scale sweep took ${elapsed}ms`);
});

test('world validation: unknown keys, bad w, duplicate planets, non-P0 resources throw', () => {
  const world = smallWorld();
  assert.throws(() => solveMax({ ...world, sliders: 1 } as never, 'Water', { Water: 'extract' }), /unknown keys: sliders/);
  assert.throws(
    () => solveMax({ ...world, planets: [{ name: 'X', type: 'Gas', resources: { Water: 500 } }] }, 'Water', { Water: 'extract' }),
    /not a P0/,
  );
  assert.throws(
    () => solveMax({ ...world, planets: [world.planets[0]!, world.planets[0]!] }, 'Water', { Water: 'extract' }),
    /duplicate planet/,
  );
  // Spawn matrix enforced at the input boundary, not discovered at the judge
  assert.throws(
    () => solveMax({ ...world, planets: [{ name: 'X', type: 'Lava', resources: { 'Aqueous Liquids': 9000 } }] }, 'Water', { Water: 'extract' }),
    /cannot spawn on a Lava planet/,
  );
});

test('stackingPenalty: upperBound remains a valid bound (Round-2 fix)', () => {
  // Two planets sharing a resource pool — the shape where the old bound walk
  // (drain one planet's decayed stack before the next planet's fresh deposit)
  // fell BELOW what a spread placement realizes.
  for (const penalty of [0, 0.1, 0.5, 0.8]) {
    for (const chars of [2, 5, 10]) {
      const world: SolveWorld = {
        operation: operation(Array.from({ length: chars }, (_, i) => chr(`c${i}`, 5))),
        planets: [
          { name: 'S-A', type: 'Storm', resources: { 'Aqueous Liquids': 13000, 'Ionic Solutions': 12000 } },
          { name: 'S-B', type: 'Storm', resources: { 'Aqueous Liquids': 12500, 'Ionic Solutions': 11500 } },
        ],
        programHours: 24,
        stackingPenalty: penalty,
      };
      const s = defaultSourcing(world, 'Coolant');
      const r = solveMax(world, 'Coolant', s, { method: 'greedy' });
      assert.ok(!('error' in r), `solve failed at p=${penalty} n=${chars}`);
      if ('error' in r) return;
      assert.ok(
        r.realizedPerWeek <= r.upperBoundPerWeek * (1 + 1e-6),
        `p=${penalty} n=${chars}: realized ${r.realizedPerWeek} exceeds upper bound ${r.upperBoundPerWeek}`,
      );
    }
  }
});

test('stackingPenalty: raising the penalty never raises the bound or the plan', () => {
  const worldAt = (penalty: number): SolveWorld => ({
    operation: operation([chr('c0', 5), chr('c1', 5), chr('c2', 5)]),
    planets: [
      { name: 'S-A', type: 'Storm', resources: { 'Aqueous Liquids': 13000, 'Ionic Solutions': 12000 } },
      { name: 'S-B', type: 'Storm', resources: { 'Aqueous Liquids': 12500, 'Ionic Solutions': 11500 } },
    ],
    programHours: 24,
    stackingPenalty: penalty,
  });
  let prevUB = Infinity;
  let prevReal = Infinity;
  for (const penalty of [0, 0.2, 0.5, 0.8]) {
    const w = worldAt(penalty);
    const s = defaultSourcing(w, 'Coolant');
    const ub = upperBound(w, 'Coolant', s);
    const r = solveMax(w, 'Coolant', s, { method: 'greedy' });
    assert.ok(ub <= prevUB * (1 + 1e-9), `UB rose when penalty rose to ${penalty}`);
    prevUB = ub;
    if (!('error' in r)) {
      assert.ok(r.realizedPerWeek <= prevReal * (1 + 1e-9), `realized rose when penalty rose to ${penalty}`);
      prevReal = r.realizedPerWeek;
    }
  }
});

test('ranking truth (Round-4): comparative ranks at the best economic posture, not the availability heuristic', () => {
  // The measured failure shape: ores for Synthetic Oil exist on the ground,
  // so the heuristic said "extract" — while buying both P1s was worth ~12x
  // more. The ranking must report the better reachable net.
  const world: SolveWorld = {
    operation: operation([chr('c0', 5), chr('c1', 5), chr('c2', 5)]),
    planets: [
      { name: 'A', type: 'Barren', resources: { 'Aqueous Liquids': 6000, 'Base Metals': 6000, 'Carbon Compounds': 6000, 'Microorganisms': 6000, 'Noble Metals': 6000 } },
      { name: 'B', type: 'Oceanic', resources: { 'Aqueous Liquids': 6000, 'Carbon Compounds': 6000, 'Complex Organisms': 6000, 'Microorganisms': 6000, 'Planktic Colonies': 6000 } },
      { name: 'C', type: 'Storm', resources: { 'Aqueous Liquids': 6000, 'Ionic Solutions': 6000, 'Noble Gas': 6000, 'Suspended Plasma': 6000, 'Base Metals': 6000 } },
    ],
    programHours: 24,
  };
  const m: MarketContext = {
    prices: {
      'Synthetic Oil': { bid: 12000, ask: 13500 },
      Oxygen: { bid: 520, ask: 610 },
      Electrolytes: { bid: 540, ask: 630 },
      'Noble Gas': { bid: 5, ask: 7 },
      'Aqueous Liquids': { bid: 4, ask: 6 },
      'Ionic Solutions': { bid: 5, ask: 7 },
    },
    sellBasis: 'immediate', buyBasis: 'immediate',
    fees: { salesTaxRate: 0.03375, brokerRate: 0.015 },
    customs: { ownerRate: 0.05, hisecNpc: false, customsCodeLevel: 5 },
    freightOutPerM3: 12, freightInPerM3: 12,
  };
  const { ranked } = comparative(world, m, ['Synthetic Oil']);
  assert.equal(ranked.length, 1, 'Synthetic Oil must rank');
  const reported = ranked[0]!.economics.netPerWeek;
  // Independently compute the all-buy posture's net — the ranking may beat it
  // (sweep can find better) but must never fall below it.
  const allBuy = solveMax(world, 'Synthetic Oil', { Oxygen: 'buy', Electrolytes: 'buy' }, { method: 'greedy' });
  assert.ok(!('error' in allBuy));
  if ('error' in allBuy) return;
  const allBuyNet = economics(allBuy, m, 24).netPerWeek;
  assert.ok(reported >= allBuyNet - 1,
    `comparative reported ${Math.round(reported)} but the all-buy posture nets ${Math.round(allBuyNet)} — availability-blind ranking is back`);
});

test('mix lines honor the world stackingPenalty (Round-4: subWorld must not drop fields)', async () => {
  const { solveMixMax } = await import('../src/engine/mix.js');
  const planets = [
    { name: 'S-A', type: 'Storm' as const, resources: { 'Aqueous Liquids': 13000, 'Ionic Solutions': 12000 } },
    { name: 'S-B', type: 'Barren' as const, resources: { 'Aqueous Liquids': 12000, 'Base Metals': 12000, 'Noble Metals': 11000 } },
  ];
  const roster = Array.from({ length: 6 }, (_, i) => chr(`c${i}`, 5));
  const entries = [
    { product: 'Water', share: 50, sourcing: { Water: 'extract' as const } },
    { product: 'Reactive Metals', share: 50, sourcing: { 'Reactive Metals': 'extract' as const } },
  ];
  const at = (penalty: number) => {
    const w: SolveWorld = { operation: operation(roster), planets, programHours: 24, stackingPenalty: penalty };
    const r = solveMixMax(w, entries);
    assert.ok(!('error' in r), `mix failed at penalty ${penalty}`);
    return 'error' in r ? 0 : r.bundlePerWeek;
  };
  const clean = at(0);
  const punished = at(0.8);
  assert.ok(punished < clean * 0.999,
    `stackingPenalty ignored by mix: bundle ${punished} at penalty 0.8 vs ${clean} at 0 — subWorld dropped the field again`);
});

test('mix partition handles heterogeneous rosters (T-16: CCU/slot ties must not strand a line)', async () => {
  const { solveMixMax, solveMixQuota } = await import('../src/engine/mix.js');
  const planets = [
    { name: 'S-A', type: 'Storm' as const, resources: { 'Aqueous Liquids': 13000, 'Ionic Solutions': 12000 } },
    { name: 'S-B', type: 'Barren' as const, resources: { 'Aqueous Liquids': 12000, 'Base Metals': 12500, 'Noble Metals': 11000 } },
    { name: 'S-C', type: 'Gas' as const, resources: { 'Aqueous Liquids': 11000, 'Ionic Solutions': 11500 } },
  ];
  const entries = [
    { product: 'Coolant', share: 60, sourcing: { Water: 'extract' as const, Electrolytes: 'extract' as const } },
    { product: 'Reactive Metals', share: 40, sourcing: { 'Reactive Metals': 'extract' as const } },
  ];
  // Rosters that tie on slots but differ in capability order, in both input
  // orders — the partition must find a feasible dealing regardless of how
  // the characters happen to be listed.
  for (const names of [['big', 'mid', 'small'], ['small', 'mid', 'big']]) {
    const roster = [
      { name: names[0]!, icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 },
      { name: names[1]!, icLevel: 5, ccuLevel: 5, customsCodeLevel: 4, accountingLevel: 4, brokerRelationsLevel: 4 },
      { name: names[2]!, icLevel: 1, ccuLevel: 5, customsCodeLevel: 3, accountingLevel: 3, brokerRelationsLevel: 3 },
    ];
    const world: SolveWorld = { operation: operation(roster), planets, programHours: 24, stackingPenalty: 0.1 };
    const mm = solveMixMax(world, entries);
    assert.ok(!('error' in mm), `mix-max failed for roster order ${names.join(',')}`);
    if ('error' in mm) return;
    const q = solveMixQuota(world, entries, Math.floor(mm.bundlePerWeek * 0.9));
    assert.ok(!('error' in q), `mix quota at 90% refused for roster order ${names.join(',')}`);
    if ('error' in q) return;
    // No character may serve two lines; every character on a line must exist.
    const seen = new Set<string>();
    for (const line of q.lines) {
      for (const c of line.characters) {
        assert.ok(!seen.has(c), `character ${c} dealt to two lines`);
        seen.add(c);
        assert.ok(roster.some((r) => r.name === c), `unknown character ${c}`);
      }
    }
  }
});

test('scout density model is continuous and monotone in security (T-17)', async () => {
  const { densityPctOfSecurity, QUICK_DENSITY_PCT } = await import('../src/ui/presets.js');
  // Anchors hit the band typicals exactly.
  assert.equal(densityPctOfSecurity(0.7), QUICK_DENSITY_PCT.highsec);
  assert.equal(densityPctOfSecurity(0.25), QUICK_DENSITY_PCT.lowsec);
  assert.equal(densityPctOfSecurity(-0.5), QUICK_DENSITY_PCT.nullsec);
  assert.equal(densityPctOfSecurity(-0.99, true), QUICK_DENSITY_PCT.wormhole);
  // Strictly monotone across k-space — richness rises as security falls: a
  // 0.9 system is always assumed POORER than a 0.5 one, and never ties it
  // (the T-17 defect was four flat buckets tying whole bands exactly).
  let prev = 0;
  for (let i = 0; i <= 40; i++) {
    const s = 1.0 - i * 0.05;
    const d = densityPctOfSecurity(s);
    assert.ok(d > prev - 1e-12 && d !== prev, `density must strictly rise as sec falls: sec ${s.toFixed(2)} → ${d} (prev ${prev})`);
    prev = d;
  }
  // Clamped outside the real range.
  assert.equal(densityPctOfSecurity(1.4), densityPctOfSecurity(1.0));
  assert.equal(densityPctOfSecurity(-2), densityPctOfSecurity(-1));
});

test('capital cost reflects the actual built plan (T-14)', async () => {
  const { capitalCost, ccUpgradeIskTo } = await import('../src/engine/capital.js');
  // Cumulative CC upgrade table (UniWiki): L5 = 580k+930k+1.2M+1.5M+2.1M.
  assert.equal(ccUpgradeIskTo(0), 0);
  assert.equal(ccUpgradeIskTo(1), 580000);
  assert.equal(ccUpgradeIskTo(5), 6310000);
  const world = smallWorld(2, 2);
  const r = solveMax(world, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  const cap = capitalCost(r.plan);
  assert.equal(cap.colonies, r.plan.colonies.length);
  // Independent recompute from the plan itself.
  let expected = 0;
  for (const c of r.plan.colonies) {
    expected += 81000 + ccUpgradeIskTo(c.ccLevel)
      + c.layout.ecus * 45000 + c.layout.basic * 75000 + c.layout.advanced * 250000
      + c.layout.hightech * 525000 + c.layout.storage * 250000 + c.layout.launchpads * 900000;
  }
  assert.equal(cap.totalIsk, expected, 'capital must equal the per-colony recompute');
  assert.ok(cap.totalIsk > 0 && cap.lines.every((l) => l.isk >= 0 && l.count > 0));
});

test('joint upper bound stays valid AND tight on planet-contention worlds (T-13)', () => {
  // Two planets, many characters — two extraction inputs plus factory sites
  // all compete for per-planet command-center capacity. The bound must never
  // be exceeded (validity) and must certify good plans well (the old
  // per-input-independent bound left provably-good plans looking mediocre).
  const planets = [
    { name: 'X I', type: 'Storm' as const, resources: { 'Aqueous Liquids': 12000, 'Ionic Solutions': 11000 } },
    { name: 'X II', type: 'Barren' as const, resources: { 'Aqueous Liquids': 11000, 'Base Metals': 10000 } },
  ];
  for (const [n, floor] of [[10, 0.85], [17, 0.90]] as const) {
    const world: SolveWorld = {
      operation: operation(Array.from({ length: n }, (_, i) => chr(`c${i}`, 5))),
      planets, programHours: 24, stackingPenalty: 0.1,
    };
    const r = solveMax(world, 'Coolant', defaultSourcing(world, 'Coolant'), { method: 'greedy' });
    assert.ok(!('error' in r), `contention world must solve at n=${n}`);
    if ('error' in r) return;
    const ratio = r.realizedPerWeek / r.upperBoundPerWeek;
    assert.ok(ratio <= 1 + 1e-6, `bound violated at n=${n}: ${(ratio * 100).toFixed(1)}%`);
    assert.ok(ratio >= floor, `joint bound too loose at n=${n}: ${(ratio * 100).toFixed(1)}% < ${floor * 100}%`);
  }
});

test('capital cost uses live CC quotes when provided, NPC seed otherwise', async () => {
  const { capitalCost } = await import('../src/engine/capital.js');
  const world = smallWorld(2, 2);
  const r = solveMax(world, 'Coolant', { Water: 'extract', Electrolytes: 'extract' });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  const seed = capitalCost(r.plan);
  assert.equal(seed.ccLivePriced, 0);
  const live = capitalCost(r.plan, () => 95000);
  assert.equal(live.ccLivePriced, r.plan.colonies.length);
  assert.equal(live.totalIsk - seed.totalIsk, (95000 - 81000) * r.plan.colonies.length,
    'live CC pricing must shift the total by exactly the per-colony delta');
  // A partial/broken quote source falls back per colony, never zeroes.
  const broken = capitalCost(r.plan, () => null);
  assert.equal(broken.totalIsk, seed.totalIsk);
  assert.equal(broken.ccLivePriced, 0);
});
