import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freightOf, hours, isk, iskPerM3, m3, m3PerQty, priceOf, iskPerQty, qty, scale, volumeOf, hoursToSeconds } from '../src/units.js';
import { TIER_VOLUME_M3 } from '../src/spec/constants.js';

test('constructors validate: NaN/Infinity always throw; sign rules per unit', () => {
  assert.throws(() => isk(NaN), /must be finite/);
  assert.throws(() => m3(-1), /must be >= 0/);
  assert.throws(() => qty(-5), /must be >= 0/);
  assert.throws(() => hours(0), /must be > 0/);
  assert.equal(isk(-500), -500); // losses are reported as negatives, never floored
});

test('storage fixture: 12,000 m3 holds 2,400,000 raw units', () => {
  assert.equal(12000 / TIER_VOLUME_M3[0], 2400000);
});

test('named cross-unit operations compute correctly', () => {
  assert.equal(volumeOf(qty(150), m3PerQty(TIER_VOLUME_M3[0])), 0.75);
  assert.equal(volumeOf(qty(1), m3PerQty(TIER_VOLUME_M3[1])), 0.19);
  assert.equal(priceOf(qty(70), iskPerQty(1000)), 70000);
  assert.equal(freightOf(m3(100), iskPerM3(500)), 50000);
  assert.equal(hoursToSeconds(hours(6)), 21600);
  assert.equal(scale(isk(100), 1.5), 150);
});

test('freight is charged on volume, not unit count (the 100x-bug killer)', () => {
  // 1 P1 vs 150 P0: same "one refined unit", ~4x the freight volume
  const p1Vol = volumeOf(qty(1), m3PerQty(TIER_VOLUME_M3[1]));
  const oreVol = volumeOf(qty(150), m3PerQty(TIER_VOLUME_M3[0]));
  assert.ok(Math.abs(oreVol / p1Vol - 3.947) < 0.01);
});
