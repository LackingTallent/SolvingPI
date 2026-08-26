/**
 * Goal-section refinement: goal-first gating, the accuracy ladder
 * (quick / refined / exact), suggested sourcing, and the preset tables.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveReadiness } from '../src/ui/readiness.js';
import { suggestSourcing, REFINE_MAX_PLANETS } from '../src/engine/suggest.js';
import { QUICK_DENSITY_PCT, SPACE_BANDS, SPACE_COST_PRESETS } from '../src/ui/presets.js';
import { character, operation } from '../src/world/characters.js';
import type { SolveWorld } from '../src/engine/allocator.js';
import type { MarketContext } from '../src/engine/modes.js';
import type { UiPlanet } from '../src/ui/state.js';

// ---------------------------------------------------------------------------
// Gate: the goal comes first
// ---------------------------------------------------------------------------

const scannedStorm: UiPlanet = {
  name: 'S', type: 'Storm',
  resources: [{ p0: 'Aqueous Liquids', w: 13000 }, { p0: 'Ionic Solutions', w: 12000 }],
};
const unscannedStorm: UiPlanet = {
  name: 'U', type: 'Storm',
  resources: [{ p0: 'Aqueous Liquids', w: 0 }, { p0: 'Ionic Solutions', w: 0 }],
};

test('no goal chosen blocks everything, and says only that', () => {
  const r = solveReadiness({
    planets: [scannedStorm], product: 'Coolant', sourcing: {}, mode: 'max', prices: {},
    modeChosen: false,
  });
  assert.ok(!r.ready);
  assert.equal(r.missing.length, 1);
  assert.match(r.missing[0]!, /Pick your goal/);
});

test('defaults preserve pre-ladder behavior (modeChosen true, refined level)', () => {
  const r = solveReadiness({ planets: [scannedStorm], product: 'Coolant', sourcing: { Water: 'extract', Electrolytes: 'extract' }, mode: 'max', prices: {} });
  assert.ok(r.ready, r.missing.join('; '));
});

// ---------------------------------------------------------------------------
// Accuracy ladder
// ---------------------------------------------------------------------------

test('quick: unscanned world without a band is blocked, naming the band', () => {
  const r = solveReadiness({
    planets: [unscannedStorm], product: 'Coolant', sourcing: {}, mode: 'max', prices: {},
    detailLevel: 'quick', spaceBand: null,
  });
  assert.ok(!r.ready);
  assert.match(r.missing.join(' '), /security band/);
});

test('quick: band chosen makes an unscanned world solvable (assumptions cover scans)', () => {
  const r = solveReadiness({
    planets: [unscannedStorm], product: 'Coolant',
    sourcing: { Water: 'extract', Electrolytes: 'extract' }, mode: 'max', prices: {},
    detailLevel: 'quick', spaceBand: 'nullsec',
  });
  assert.ok(r.ready, r.missing.join('; '));
});

test('quick: a fully scanned world needs no band at all', () => {
  const r = solveReadiness({
    planets: [scannedStorm], product: 'Coolant',
    sourcing: { Water: 'extract', Electrolytes: 'extract' }, mode: 'max', prices: {},
    detailLevel: 'quick', spaceBand: null,
  });
  assert.ok(r.ready, r.missing.join('; '));
});

test('refined: scan requirements stay hard (no stand-ins)', () => {
  const r = solveReadiness({
    planets: [unscannedStorm], product: 'Coolant',
    sourcing: { Water: 'extract', Electrolytes: 'extract' }, mode: 'max', prices: {},
    detailLevel: 'refined', spaceBand: 'nullsec',
  });
  assert.ok(!r.ready);
  assert.match(r.missing.join(' '), /Scan value needed/);
});

test('exact: default/preset costs block with the confirm path named; user rates pass', () => {
  const base = {
    planets: [scannedStorm], product: 'Coolant',
    sourcing: { Water: 'extract', Electrolytes: 'extract' } as const, mode: 'max' as const, prices: {},
    detailLevel: 'exact' as const,
  };
  const blockedDefault = solveReadiness({ ...base, costsSource: 'default' });
  assert.ok(!blockedDefault.ready);
  assert.match(blockedDefault.missing.join(' '), /real costs/);
  const blockedPreset = solveReadiness({ ...base, costsSource: 'preset-nullsec' });
  assert.ok(!blockedPreset.ready);
  const ok = solveReadiness({ ...base, costsSource: 'user' });
  assert.ok(ok.ready, ok.missing.join('; '));
});

// ---------------------------------------------------------------------------
// Suggested sourcing
// ---------------------------------------------------------------------------

function world(planets: SolveWorld['planets']): SolveWorld {
  return {
    operation: operation([character({ name: 'T', icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 })]),
    planets,
    programHours: 6,
  };
}

const market = (prices: MarketContext['prices']): MarketContext => ({
  prices,
  sellBasis: 'immediate', buyBasis: 'immediate',
  fees: { salesTaxRate: 0.03375, brokerRate: 0.015 },
  customs: { ownerRate: 0.05, hisecNpc: false, customsCodeLevel: 5 },
  freightOutPerM3: 10, freightInPerM3: 10,
});

const bothOres = world([{ name: 'S-1', type: 'Storm', resources: { 'Aqueous Liquids': 13000, 'Ionic Solutions': 12000 } }]);

test('heuristic (no prices): extract what is scanned, with a named reason; skip is disclosed', () => {
  const s = suggestSourcing(bothOres, 'Coolant', market({}));
  assert.equal(s.sourcing['Water'], 'extract');
  assert.equal(s.sourcing['Electrolytes'], 'extract');
  assert.ok(s.notes.every((n) => n.reason.length > 0));
  assert.equal(s.refined, false);
  assert.match(s.refinementSkipped ?? '', /no prices/);
});

test('heuristic: a missing ore falls to buy, named', () => {
  const s = suggestSourcing(
    world([{ name: 'S-1', type: 'Storm', resources: { 'Aqueous Liquids': 13000 } }]),
    'Coolant', market({}));
  assert.equal(s.sourcing['Water'], 'extract');
  assert.equal(s.sourcing['Electrolytes'], 'buy');
  assert.match(s.notes.find((n) => n.p1 === 'Electrolytes')!.reason, /no scanned Ionic Solutions/);
});

test('a pinned override is never second-guessed', () => {
  const s = suggestSourcing(bothOres, 'Coolant', market({}), { Water: 'buy' });
  assert.equal(s.sourcing['Water'], 'buy');
  assert.match(s.notes.find((n) => n.p1 === 'Water')!.reason, /your choice/);
});

test('price refinement: buying beats extracting from a near-dead deposit, and says so', () => {
  // Aqueous Liquids at w=100 is a token deposit: extracting Water starves the
  // chain, while buying it at 600 ISK against 20k Coolant is clearly better.
  // (Three planets so the chain is feasible under every sourcing alternative.)
  const w = world([
    { name: 'S-1', type: 'Storm', resources: { 'Aqueous Liquids': 100, 'Ionic Solutions': 13000 } },
    { name: 'S-2', type: 'Gas', resources: { 'Aqueous Liquids': 100, 'Ionic Solutions': 12000 } },
    { name: 'S-3', type: 'Barren', resources: {} },
  ]);
  const m = market({
    Coolant: { bid: 20000, ask: 21000 },
    Water: { bid: 500, ask: 600 },
    Electrolytes: { bid: 700, ask: 900 },
  });
  const s = suggestSourcing(w, 'Coolant', m);
  assert.equal(s.refined, true);
  assert.equal(s.sourcing['Water'], 'buy');
  assert.match(s.notes.find((n) => n.p1 === 'Water')!.reason, /beats/);
});

test('oversized worlds skip refinement and say why (deep analytics remains the thorough path)', () => {
  const many = world(Array.from({ length: REFINE_MAX_PLANETS + 1 }, (_, i) => ({
    name: `P-${i}`, type: 'Storm' as const, resources: { 'Aqueous Liquids': 13000, 'Ionic Solutions': 12000 },
  })));
  const s = suggestSourcing(many, 'Coolant', market({ Coolant: { bid: 20000, ask: 21000 } }));
  assert.equal(s.refined, false);
  assert.match(s.refinementSkipped ?? '', /too large/);
});

// ---------------------------------------------------------------------------
// Preset tables: defensible, one source of truth
// ---------------------------------------------------------------------------

test('cost presets: high sec models the NPC portion natively; nowhere else has one', () => {
  assert.equal(SPACE_COST_PRESETS.highsec.hisecNpc, true);
  assert.equal(SPACE_COST_PRESETS.highsec.customsPct, 5); // owner rate only — NPC part is computed from skill
  for (const b of ['lowsec', 'nullsec', 'wormhole'] as const) {
    assert.equal(SPACE_COST_PRESETS[b].hisecNpc, false, `${b} has no NPC customs`);
  }
});

test('cost presets: every band carries a rationale and sane market fees', () => {
  for (const b of SPACE_BANDS) {
    const p = SPACE_COST_PRESETS[b];
    assert.ok(p.rationale.length > 20, `${b} must defend its numbers`);
    assert.equal(p.salesTaxPct, 3.375); // Accounting V
    assert.equal(p.brokerPct, 1.5);
    assert.ok(p.freightPerM3 > 0);
  }
  // Freight rises with logistics risk: high < low ≤ null ≤ wormhole.
  assert.ok(SPACE_COST_PRESETS.highsec.freightPerM3 < SPACE_COST_PRESETS.lowsec.freightPerM3);
  assert.ok(SPACE_COST_PRESETS.lowsec.freightPerM3 <= SPACE_COST_PRESETS.nullsec.freightPerM3);
  assert.ok(SPACE_COST_PRESETS.nullsec.freightPerM3 <= SPACE_COST_PRESETS.wormhole.freightPerM3);
});

test('quick densities: monotone with space danger, wormhole at the calibrated reference', () => {
  assert.ok(QUICK_DENSITY_PCT.highsec < QUICK_DENSITY_PCT.lowsec);
  assert.ok(QUICK_DENSITY_PCT.lowsec < QUICK_DENSITY_PCT.nullsec);
  assert.ok(QUICK_DENSITY_PCT.nullsec <= QUICK_DENSITY_PCT.wormhole);
  assert.equal(QUICK_DENSITY_PCT.wormhole, 100);
  // Community-reported yield ratio: null-sec ≈ 3× high-sec.
  assert.equal(QUICK_DENSITY_PCT.nullsec / QUICK_DENSITY_PCT.highsec, 3);
});
