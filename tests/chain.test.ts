import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainNeeds, oreOf, p1InputsOf, weeklyPerFacility, P0_PER_P1 } from '../src/engine/chain.js';

test('facility weekly rates are DERIVED: 6720 / 840 / 504 / 168', () => {
  assert.equal(weeklyPerFacility('Water'), 6720);
  assert.equal(weeklyPerFacility('Coolant'), 840);
  // THE v8 QUOTA BUG: P3 throughput was wired to the P2 constant (840).
  // Derivation makes it 504 (3/cycle × 24 × 7) and the bug inexpressible.
  assert.equal(weeklyPerFacility('Robotics'), 504);
  assert.equal(weeklyPerFacility('Broadcast Node'), 168);
  assert.throws(() => weeklyPerFacility('Tritanium'), /Unknown schematic/);
});

test('oreOf and p1InputsOf', () => {
  assert.equal(oreOf('Water'), 'Aqueous Liquids');
  assert.throws(() => oreOf('Coolant'), /Not a P1/);
  assert.deepEqual([...p1InputsOf('Coolant')], ['Electrolytes', 'Water']);
  // P1-assisted P4: the direct P1 input appears in the sourcing set
  assert.ok(p1InputsOf('Sterile Conduits').includes('Water'));
  assert.ok(p1InputsOf('Nano-Factory').includes('Reactive Metals'));
  assert.throws(() => p1InputsOf('Aqueous Liquids'), /chain-target-invalid/);
});

test('Coolant @ 840/wk: 1 advanced facility, 6,720 of each P1', () => {
  const n = chainNeeds('Coolant', 840, { Water: 'extract', Electrolytes: 'extract' });
  assert.equal(n.advancedFacilities, 1);
  assert.equal(n.htFacilities, 0);
  assert.deepEqual(n.p1PerWeek, { Water: 6720, Electrolytes: 6720 });
  assert.deepEqual(n.extractP1PerWeek, { Water: 6720, Electrolytes: 6720 });
  assert.deepEqual(n.purchasesPerWeek, {});
  assert.deepEqual(n.outputsPerWeek, { Coolant: 840 });
});

test('refine sourcing: the doc fixture — 53,760 P1 needs 8,064,000 units of ore', () => {
  const n = chainNeeds('Water', 53760, { Water: 'refine' });
  assert.deepEqual(n.refineP1PerWeek, { Water: 53760 });
  assert.deepEqual(n.purchasesPerWeek, { 'Aqueous Liquids': 53760 * P0_PER_P1 });
  assert.equal(n.purchasesPerWeek['Aqueous Liquids'], 8064000);
});

test('buy sourcing: purchases carry the P1 itself, no colony work', () => {
  const n = chainNeeds('Coolant', 840, { Water: 'buy', Electrolytes: 'extract' });
  assert.deepEqual(n.purchasesPerWeek, { Water: 6720 });
  assert.deepEqual(n.extractP1PerWeek, { Electrolytes: 6720 });
  assert.deepEqual(n.refineP1PerWeek, {});
});

test('Broadcast Node @ 168/wk: full three-tier expansion, hand-computed', () => {
  const p1s = Object.fromEntries(p1InputsOf('Broadcast Node').map((p) => [p, 'extract' as const]));
  const n = chainNeeds('Broadcast Node', 168, p1s);
  // 168 P4 = 1 HT facility; inputs 6 each → 1,008 of each of 3 P3s
  assert.equal(n.htFacilities, 1);
  assert.equal(n.outputsPerWeek['Neocoms'], 1008);
  assert.equal(n.outputsPerWeek['Data Chips'], 1008);
  assert.equal(n.outputsPerWeek['High-Tech Transmitters'], 1008);
  // Each P3 @1,008/wk = 2 advanced facilities (504/fac) → 6 for P3 stage
  // P2 stage: each P3 unit eats 10/3 of each P2 input → 3,360 per P2 input
  // Neocoms: Biocells+SilicateGlass; DataChips: SupertensilePlastics+MicrofiberShielding;
  // HTT: Polyaramids+Transmitter → 6 distinct P2s @3,360 = 4 facilities each (840/fac)
  const p2Total = 6 * 3360;
  const advExpected = 6 + p2Total / 840; // 6 P3-facs + 24 P2-facs
  assert.ok(Math.abs(n.advancedFacilities - advExpected) < 1e-9, `${n.advancedFacilities} vs ${advExpected}`);
  // P1: each P2 @3,360 eats 8 of each of its two P1s → aggregate checked via sum
  const totalP1 = Object.values(n.p1PerWeek).reduce((a, b) => a + b, 0);
  assert.equal(totalP1, 6 * 3360 * 2 * 8);
});

test('sourcing must cover the chain EXACTLY: missing, extra, invalid all throw by name', () => {
  assert.throws(() => chainNeeds('Coolant', 840, { Water: 'extract' } as never), /sourcing-missing: no sourcing chosen for Electrolytes/);
  assert.throws(
    () => chainNeeds('Coolant', 840, { Water: 'extract', Electrolytes: 'extract', Bacteria: 'buy' } as never),
    /sourcing-extra: Bacteria/,
  );
  assert.throws(
    () => chainNeeds('Coolant', 840, { Water: 'extract', Electrolytes: 'jita' } as never),
    /sourcing-invalid: unknown mode "jita"/,
  );
  assert.throws(() => chainNeeds('Water', 100, { Water: 'buy' }), /sourcing-invalid: buying the target/);
  assert.throws(() => chainNeeds('Aqueous Liquids', 100, {}), /chain-target-invalid/);
  assert.throws(() => chainNeeds('Coolant', -5, { Water: 'extract', Electrolytes: 'extract' }), /ratePerWeek/);
});
