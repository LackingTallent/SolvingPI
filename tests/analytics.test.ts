import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveMax, type SolveWorld } from '../src/engine/allocator.js';
import { analyze, bottleneckReport, buyVsMake, cadenceInsights, marginalCharacter, marginalTraining, optimalityInsight, patiencePremium, rawP1Baseline, runwayInsight, saturationInsights } from '../src/engine/analytics.js';
import { character, operation } from '../src/world/characters.js';
import type { MarketContext } from '../src/engine/modes.js';

const chr = (name: string, ic: number) =>
  character({ name, icLevel: ic, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 });

const legacy = { cycleSecondsOverride: 1800 } as const;

const world: SolveWorld = {
  operation: operation([chr('main', 3), chr('alt', 1)]),
  planets: [
    { name: 'W-1', type: 'Storm', resources: { 'Aqueous Liquids': 13277.2694, 'Ionic Solutions': 12500 } },
    { name: 'W-2', type: 'Gas', resources: { 'Aqueous Liquids': 9500, 'Ionic Solutions': 13000 } },
    { name: 'W-3', type: 'Barren', resources: { 'Aqueous Liquids': 8000 } },
    { name: 'W-4', type: 'Temperate', resources: { 'Aqueous Liquids': 6500 } },
  ],
  programHours: 6,
  extraction: legacy,
};

const market: MarketContext = {
  prices: {
    Water: { bid: 750, ask: 900, dailyVolume: 2_000_000 },
    Electrolytes: { bid: 700, ask: 850 },
    Coolant: { bid: 11000, ask: 12500, dailyVolume: 5000 },
    'Aqueous Liquids': { bid: 4, ask: 6 },
    'Ionic Solutions': { bid: 4, ask: 6 },
  },
  sellBasis: 'immediate',
  buyBasis: 'immediate',
  fees: { salesTaxRate: 0.03375, brokerRate: 0.015 },
  customs: { ownerRate: 0.1, hisecNpc: false, customsCodeLevel: 5 },
  freightOutPerM3: 400,
  freightInPerM3: 400,
};

const sourcing = { Water: 'extract', Electrolytes: 'extract' } as const;

function solved() {
  const r = solveMax(world, 'Coolant', sourcing);
  assert.ok(!('error' in r), JSON.stringify(r));
  if ('error' in r) throw new Error('unreachable');
  return r;
}

test('every insight carries value, unit, detail, and a citation trail', () => {
  const report = analyze(world, solved(), market);
  assert.ok(report.insights.length >= 8);
  for (const i of report.insights) {
    assert.ok(i.id.length > 0 && i.title.length > 0 && i.unit.length > 0);
    assert.ok(i.detail.length > 0, `${i.id} has no explanation`);
    assert.ok(i.inputs.length > 0, `${i.id} cites no inputs`);
    if (i.value === null) assert.match(i.detail, /unavailable|could not|no /i);
  }
});

test('bottleneck is NAMED and every other stage reports slack', () => {
  const r = solved();
  const report = bottleneckReport(r);
  const bottleneck = report.filter((i) => i.id === 'bottleneck');
  assert.equal(bottleneck.length, 1);
  const slack = report.filter((i) => i.id.startsWith('slack:'));
  assert.ok(slack.length >= 1);
  for (const s of slack) assert.ok((s.value ?? 0) <= 1 + 1e-9);
  // The binding constraint runs at 100% by definition
  assert.ok(Math.abs((bottleneck[0]!.value ?? 0) - 1) < 1e-6);
});

test('optimality: exhaustive answers disclose their count-search scope; value is realized/UB', () => {
  const r = solved();
  const i = optimalityInsight(r);
  assert.equal(r.method, 'exhaustive');
  assert.match(i.detail, /colony-mix COUNTS/);
  assert.match(i.detail, /placement stays heuristic/);
  assert.ok((i.value ?? 0) > 0 && (i.value ?? 2) <= 1 + 1e-6);
});

test('runway is finite and positive for an accumulating operation', () => {
  const i = runwayInsight(solved());
  assert.ok(i.value !== null && i.value > 0 && Number.isFinite(i.value));
  assert.match(i.detail, /overflow after/);
});

test('patience premium has the right sign structure and cites quotes', () => {
  const i = patiencePremium(solved(), market);
  assert.ok(i.value !== null);
  // ask 12.5k vs bid 11k on Coolant: spread 13.6% vs broker 1.5% → patience should win here
  assert.ok(i.value > 0, `expected positive premium, got ${i.value}`);
  assert.match(i.detail, /broker/);
});

test('saturation: flags heavy share, stays calm on deep markets, names missing volume', () => {
  const list = saturationInsights(solved(), market);
  const coolant = list.find((i) => i.id === 'saturation:Coolant');
  assert.ok(coolant && coolant.value !== null && coolant.value > 0.1);
  assert.match(coolant.detail, /move the price|diversify/i);
  const noVol = saturationInsights(solved(), {
    ...market,
    prices: { ...market.prices, Coolant: { bid: 11000, ask: 12500 } },
  }).find((i) => i.id === 'saturation:Coolant');
  assert.ok(noVol && noVol.value === null);
  assert.match(noVol.detail, /unavailable: no dailyVolume/);
});

test('buy-vs-make re-solves every mode and responds to prices (influence)', () => {
  const r = solved();
  const cheapOre: MarketContext = {
    ...market,
    prices: { ...market.prices, 'Aqueous Liquids': { bid: 0.1, ask: 0.2 }, Water: { bid: 750, ask: 900 } },
  };
  const cmp = buyVsMake(world, r, cheapOre);
  const water = cmp.find((c) => c.p1 === 'Water');
  assert.ok(water);
  assert.equal(water.options.length, 3);
  for (const o of water.options) assert.ok(o.netPerWeek !== null, `${o.mode}: ${o.reason}`);

  const dearOre: MarketContext = {
    ...market,
    prices: { ...market.prices, 'Aqueous Liquids': { bid: 50, ask: 60 } },
  };
  const cmpDear = buyVsMake(world, r, dearOre);
  const waterDear = cmpDear.find((c) => c.p1 === 'Water')!;
  const refineCheap = water.options.find((o) => o.mode === 'refine')!.netPerWeek!;
  const refineDear = waterDear.options.find((o) => o.mode === 'refine')!.netPerWeek!;
  assert.ok(refineDear < refineCheap, 'dearer ore must make refining worse');
});

test('marginal character and training: computed by full re-solve, positive on a constrained world', () => {
  const r = solved();
  const mc = marginalCharacter(world, r, market);
  assert.ok(mc.value !== null && mc.value > 0, JSON.stringify(mc));
  assert.match(mc.detail, /adds .* ISK\/wk/);
  const mt = marginalTraining(world, r, market);
  assert.ok(mt.value !== null && mt.value >= 0, JSON.stringify(mt));
  assert.match(mt.detail, /IC 3 to 4|IC 1 to 2/);
  // Fully-trained operations say so instead of inventing a number
  const maxed: SolveWorld = { ...world, operation: operation([chr('a', 5), chr('b', 5)]) };
  const rMax = solveMax(maxed, 'Coolant', sourcing);
  assert.ok(!('error' in rMax));
  if ('error' in rMax) return;
  const mtMax = marginalTraining(maxed, rMax, market);
  assert.equal(mtMax.value, null);
  assert.match(mtMax.detail, /already has Interplanetary Consolidation V/);
});

test('cadence curve: net per week falls with longer programs, net per session rises', () => {
  const curve = cadenceInsights(world, 'Coolant', sourcing, market, [6, 168]);
  assert.equal(curve.length, 2);
  const [h6, h168] = curve;
  assert.ok(h6!.netPerWeek !== null && h168!.netPerWeek !== null);
  assert.ok(h6!.netPerWeek! > h168!.netPerWeek!, 'weekly cadence must earn less per week');
  assert.ok(h168!.netPerSession! > h6!.netPerSession!, 'but more per login');
  assert.equal(h6!.sessionsPerWeek, 28);
  assert.equal(h168!.sessionsPerWeek, 1);
});

test('the raw-P1 baseline compares against the best dumb strategy and can warn', () => {
  const r = solved();
  const i = rawP1Baseline(world, r, market);
  assert.ok(i.value !== null);
  assert.match(i.detail, /beats the best dumb strategy|WARNING/);
  // Crash Coolant's price → the chain should stop beating raw Water
  const crashed: MarketContext = { ...market, prices: { ...market.prices, Coolant: { bid: 900, ask: 1000 } } };
  const warn = rawP1Baseline(world, r, crashed);
  assert.ok(warn.value !== null && warn.value < 0);
  assert.match(warn.detail, /WARNING/);
});
