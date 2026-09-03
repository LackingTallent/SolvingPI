import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveReadiness } from '../src/ui/readiness.js';
import { resourcesOf } from '../src/world/planets.js';
import { PLANET_TYPES } from '../src/spec/schematics.js';
import type { UiPlanet } from '../src/ui/state.js';

test('GAME TRUTH: every planet type carries exactly 5 resources (the UI cap is physics, not policy)', () => {
  for (const t of PLANET_TYPES) {
    assert.equal(resourcesOf(t).length, 5, `${t} should carry exactly 5 resources`);
  }
});

const storm: UiPlanet = { name: 'S', type: 'Storm', resources: [{ p0: 'Aqueous Liquids', w: 13000 }] };
const stormBoth: UiPlanet = {
  name: 'S', type: 'Storm',
  resources: [{ p0: 'Aqueous Liquids', w: 13000 }, { p0: 'Ionic Solutions', w: 12000 }],
};
const coolantExtract = { Water: 'extract', Electrolytes: 'extract' } as const;
const goodPrices = {
  Coolant: { bid: 11000, ask: 12500 },
  Water: { bid: 700, ask: 900 },
  Electrolytes: { bid: 700, ask: 900 },
};

test('no planets: blocked, with the fix named', () => {
  const r = solveReadiness({ planets: [], product: 'Coolant', sourcing: coolantExtract, mode: 'max', prices: {} });
  assert.ok(!r.ready);
  assert.match(r.missing.join(' '), /Add at least one planet \(section 2\)/);
});

test('extract sourcing without a scanned ore: blocked, names the ore, the input, and both fixes', () => {
  const r = solveReadiness({ planets: [storm], product: 'Coolant', sourcing: coolantExtract, mode: 'max', prices: {} });
  assert.ok(!r.ready);
  assert.equal(r.missing.length, 1);
  assert.match(r.missing[0]!, /Ionic Solutions/);
  assert.match(r.missing[0]!, /extract Electrolytes/);
  assert.match(r.missing[0]!, /section 2.*section 1/);
});

test('max mode: ready without any prices once extraction is covered (output needs no quotes)', () => {
  const r = solveReadiness({ planets: [stormBoth], product: 'Coolant', sourcing: coolantExtract, mode: 'max', prices: {} });
  assert.ok(r.ready, r.missing.join('; '));
});

test('a zero/unscanned value does not count as scanned', () => {
  const half: UiPlanet = { ...stormBoth, resources: [{ p0: 'Aqueous Liquids', w: 13000 }, { p0: 'Ionic Solutions', w: 0 }] };
  const r = solveReadiness({ planets: [half], product: 'Coolant', sourcing: coolantExtract, mode: 'max', prices: {} });
  assert.ok(!r.ready);
});

test('buy sourcing removes the scan requirement for that input', () => {
  const r = solveReadiness({
    planets: [storm], product: 'Coolant',
    sourcing: { Water: 'extract', Electrolytes: 'buy' }, mode: 'max', prices: {},
  });
  assert.ok(r.ready, r.missing.join('; '));
});

test('qol mode demands prices for the whole chain, named', () => {
  const missing = solveReadiness({ planets: [stormBoth], product: 'Coolant', sourcing: coolantExtract, mode: 'qol', prices: {} });
  assert.ok(!missing.ready);
  assert.match(missing.missing.join(' '), /needs prices for: .*Coolant/);
  const ok = solveReadiness({ planets: [stormBoth], product: 'Coolant', sourcing: coolantExtract, mode: 'qol', prices: goodPrices });
  assert.ok(ok.ready, ok.missing.join('; '));
  // refine sourcing pulls the ore into the required price set
  const refine = solveReadiness({
    planets: [stormBoth], product: 'Coolant',
    sourcing: { Water: 'refine', Electrolytes: 'extract' }, mode: 'qol', prices: goodPrices,
  });
  assert.ok(!refine.ready);
  assert.match(refine.missing.join(' '), /Aqueous Liquids/);
});

test('compare mode needs at least one usable price; one-sided quotes do not count', () => {
  const none = solveReadiness({ planets: [stormBoth], product: 'Coolant', sourcing: {}, mode: 'compare', prices: {} });
  assert.ok(!none.ready);
  const oneSided = solveReadiness({
    planets: [stormBoth], product: 'Coolant', sourcing: {}, mode: 'compare',
    prices: { Coolant: { bid: 11000, ask: 0 } },
  });
  assert.ok(!oneSided.ready);
  const ok = solveReadiness({
    planets: [stormBoth], product: 'Coolant', sourcing: {}, mode: 'compare',
    prices: { Coolant: { bid: 11000, ask: 12500 } },
  });
  assert.ok(ok.ready);
});
