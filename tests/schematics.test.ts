import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  P0_SPAWNS, P1_FROM_P0, P2_RECIPES, P3_RECIPES, P4_RECIPES, SCHEMATICS,
  commoditiesAtTier, tierOf,
} from '../src/spec/schematics.js';
import { canBuildHighTech, resourcesOf, spawnsOn } from '../src/world/planets.js';

test('chain counts: 15 P0, 15 P1, 24 P2, 21 P3, 8 P4', () => {
  assert.equal(Object.keys(P0_SPAWNS).length, 15);
  assert.equal(Object.keys(P1_FROM_P0).length, 15);
  assert.equal(Object.keys(P2_RECIPES).length, 24);
  assert.equal(Object.keys(P3_RECIPES).length, 21);
  assert.equal(Object.keys(P4_RECIPES).length, 8);
  assert.equal(SCHEMATICS.size, 15 + 24 + 21 + 8);
});

test('P0→P1: bijection, 3000→20 @30min in a basic facility', () => {
  const p1s = new Set(Object.values(P1_FROM_P0));
  assert.equal(p1s.size, 15, 'P0→P1 must be one-to-one');
  for (const [p0, p1] of Object.entries(P1_FROM_P0)) {
    const s = SCHEMATICS.get(p1)!;
    assert.equal(s.tier, 1);
    assert.equal(s.facility, 'basic');
    assert.equal(s.cycleSeconds, 1800);
    assert.equal(s.outQty, 20);
    assert.deepEqual(s.inputs, { [p0]: 3000 });
    assert.ok(p0 in P0_SPAWNS, `${p1} input ${p0} is a real P0`);
  }
});

test('P1→P2: exactly 2 inputs @40 each → 5 @1h in an advanced facility', () => {
  const p1Names = new Set(Object.values(P1_FROM_P0));
  for (const [p2, inputs] of Object.entries(P2_RECIPES)) {
    const s = SCHEMATICS.get(p2)!;
    assert.equal(s.tier, 2);
    assert.equal(s.facility, 'advanced');
    assert.equal(s.cycleSeconds, 3600);
    assert.equal(s.outQty, 5);
    assert.equal(inputs.length, 2, `${p2} must have 2 inputs`);
    for (const [input, n] of Object.entries(s.inputs)) {
      assert.equal(n, 40, `${p2} input ${input} must be 40/cycle`);
      assert.ok(p1Names.has(input), `${p2} input ${input} must be a P1`);
    }
  }
});

test('P2→P3: 2-3 inputs @10 each → 3 @1h in an advanced facility', () => {
  for (const [p3, inputs] of Object.entries(P3_RECIPES)) {
    const s = SCHEMATICS.get(p3)!;
    assert.equal(s.tier, 3);
    assert.equal(s.facility, 'advanced');
    assert.equal(s.outQty, 3);
    assert.ok(inputs.length === 2 || inputs.length === 3, `${p3} must have 2-3 inputs`);
    for (const [input, n] of Object.entries(s.inputs)) {
      assert.equal(n, 10, `${p3} input ${input} must be 10/cycle`);
      assert.ok(input in P2_RECIPES, `${p3} input ${input} must be a P2`);
    }
  }
});

test('P3→P4: (3×P3@6) or (2×P3@6 + 1×P1@40) → 1 @1h in a high-tech plant', () => {
  const p1Names = new Set(Object.values(P1_FROM_P0));
  for (const [p4, r] of Object.entries(P4_RECIPES)) {
    const s = SCHEMATICS.get(p4)!;
    assert.equal(s.tier, 4);
    assert.equal(s.facility, 'hightech');
    assert.equal(s.outQty, 1);
    for (const p3 of r.p3) {
      assert.ok(p3 in P3_RECIPES, `${p4} input ${p3} must be a P3`);
      assert.equal(s.inputs[p3], 6);
    }
    if (r.p1 !== undefined) {
      assert.equal(r.p3.length, 2, `${p4}: P1-assisted recipes carry exactly 2 P3s`);
      assert.ok(p1Names.has(r.p1), `${p4} P1 input ${r.p1} must be a P1`);
      assert.equal(s.inputs[r.p1], 40);
      assert.equal(Object.keys(s.inputs).length, 3);
    } else {
      assert.equal(r.p3.length, 3, `${p4}: pure-P3 recipes carry exactly 3 P3s`);
      assert.equal(Object.keys(s.inputs).length, 3);
    }
  }
});

test('spot fixtures from the library', () => {
  assert.deepEqual(P2_RECIPES['Coolant'], ['Water', 'Electrolytes']);
  assert.deepEqual(P4_RECIPES['Broadcast Node']!.p3, ['Neocoms', 'Data Chips', 'High-Tech Transmitters']);
  assert.equal(P4_RECIPES['Sterile Conduits']!.p1, 'Water');
  assert.equal(P4_RECIPES['Nano-Factory']!.p1, 'Reactive Metals');
  // Ice planet fix (v7 bug): Planktic Colonies on Ice, Suspended Plasma NOT on Ice
  assert.ok(spawnsOn('Planktic Colonies', 'Ice'));
  assert.ok(!spawnsOn('Suspended Plasma', 'Ice'));
});

test('every P0 spawns somewhere; Gas planets host Reactive Gas exclusively', () => {
  for (const [p0, planets] of Object.entries(P0_SPAWNS)) {
    assert.ok(planets.length >= 1, `${p0} must spawn on at least one planet type`);
  }
  assert.deepEqual([...P0_SPAWNS['Reactive Gas']!], ['Gas']);
  assert.ok(resourcesOf('Gas').includes('Reactive Gas'));
});

test('high-tech legality: Barren and Temperate only', () => {
  assert.ok(canBuildHighTech('Barren'));
  assert.ok(canBuildHighTech('Temperate'));
  for (const p of ['Gas', 'Ice', 'Lava', 'Oceanic', 'Plasma', 'Storm'] as const) {
    assert.ok(!canBuildHighTech(p), `${p} must not allow high-tech plants`);
  }
});

test('tierOf and commoditiesAtTier are consistent', () => {
  assert.equal(tierOf('Aqueous Liquids'), 0);
  assert.equal(tierOf('Water'), 1);
  assert.equal(tierOf('Coolant'), 2);
  assert.equal(tierOf('Robotics'), 3);
  assert.equal(tierOf('Wetware Mainframe'), 4);
  assert.throws(() => tierOf('Tritanium'), /Unknown commodity/);
  assert.equal(commoditiesAtTier(0).length, 15);
  assert.equal(commoditiesAtTier(1).length, 15);
  assert.equal(commoditiesAtTier(2).length, 24);
  assert.equal(commoditiesAtTier(3).length, 21);
  assert.equal(commoditiesAtTier(4).length, 8);
});
