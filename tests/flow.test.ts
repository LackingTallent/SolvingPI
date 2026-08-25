import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colonyPlan, runwayHours, steadyState, surplusM3PerHour, weeklyNet, HOURS_PER_WEEK } from '../src/engine/flow.js';
import { extractionColony } from '../src/engine/colony.js';
import { DENSITY_REFERENCE_W, wFromDensityPct } from '../src/world/density.js';
import { perHourRate } from '../src/world/extraction.js';

const W = DENSITY_REFERENCE_W;
const legacy = { cycleSecondsOverride: 1800 } as const;

test('golden fixture: reference density, 6h programs, 8 basics → exactly 53,760 P1/week, facility-capped', () => {
  const r = extractionColony({ resource: 'Aqueous Liquids', w: W, programHours: 6, basics: 8, extraction: legacy });
  assert.equal(r.p1Name, 'Water');
  assert.equal(r.p1PerWeek, 53760);
  assert.equal(r.bottleneck, 'facility');
  // v8's hidden 0.7% headroom, now disclosed: 48,352/h supplied vs 48,000/h consumed
  assert.ok(Math.abs(r.surplusP0PerHour - 352) < 1, `surplus ${r.surplusP0PerHour}`);
  assert.equal(r.capacityHeadroomPerWeek, 0);
});

test('THE v8 CORRECTION: above 100% density, output stays capped at what 8 basics can make', () => {
  const r = extractionColony({ resource: 'Aqueous Liquids', w: wFromDensityPct(150), programHours: 6, basics: 8, extraction: legacy });
  assert.equal(r.p1PerWeek, 53760); // NOT 53,760 × 1.5 = 80,640
  assert.equal(r.bottleneck, 'facility');
  assert.ok(r.surplusP0PerHour > 20000, 'the unusable surplus is real and disclosed');
});

test('the surplus becomes real P1 when the layout adds basics (per-colony choice)', () => {
  // Note: 150% density supplies ~82,425 P0/h here, MORE than 1.5 × the 100%
  // supply — the noise phase shifts with w, so scaling is not exactly linear.
  // Raw-units modeling handles this exactly; percent-linear models cannot.
  const w150 = wFromDensityPct(150);
  const capped = extractionColony({ resource: 'Aqueous Liquids', w: w150, programHours: 6, basics: 8, extraction: legacy });
  const twelve = extractionColony({ resource: 'Aqueous Liquids', w: w150, programHours: 6, basics: 12, extraction: legacy });
  assert.ok(twelve.p1PerWeek > capped.p1PerWeek);
  assert.equal(twelve.p1PerWeek, 12 * 20 * 2 * 168); // 80,640 — still facility-capped
  assert.equal(twelve.bottleneck, 'facility');
  const fourteen = extractionColony({ resource: 'Aqueous Liquids', w: w150, programHours: 6, basics: 14, extraction: legacy });
  assert.equal(fourteen.bottleneck, 'extractor'); // 14 basics (84,000/h) out-eat the extractor
  assert.equal(fourteen.surplusP0PerHour, 0);
  assert.ok(fourteen.p1PerWeek > twelve.p1PerWeek);
});

test('below the cap, output equals supply ÷ 150 exactly (not v8 linear-in-percent)', () => {
  const w65 = wFromDensityPct(65);
  const r = extractionColony({ resource: 'Aqueous Liquids', w: w65, programHours: 6, basics: 8, extraction: legacy });
  const supply = perHourRate(w65, 6, legacy);
  assert.equal(r.bottleneck, 'extractor');
  assert.ok(Math.abs(r.p1PerWeek - (supply / 150) * HOURS_PER_WEEK) < 1e-6);
  // v8 would have said exactly 34,944 (53,760 × 0.65). The physical answer differs
  // because 100% reference density carries 0.7% headroom and noise phase shifts with w.
  assert.notEqual(Math.round(r.p1PerWeek), 34944);
});

test('long programs starve the basics: weekly cadence at reference density is extractor-limited', () => {
  const r = extractionColony({ resource: 'Aqueous Liquids', w: W, programHours: 168, basics: 8, extraction: legacy });
  assert.equal(r.bottleneck, 'extractor');
  assert.ok(r.p1PerWeek < 53760 * 0.36, `weekly cadence yields ${r.p1PerWeek}`);
  assert.ok(r.capacityHeadroomPerWeek > 0);
});

test('factory colony: 24 advanced fully fed → 20,160 P2/week; starving one input halves it and names it', () => {
  const fed = steadyState({
    extractors: [],
    imports: [
      { commodity: 'Water', qtyPerHour: 24 * 40 },
      { commodity: 'Electrolytes', qtyPerHour: 24 * 40 },
    ],
    factories: [{ schematic: 'Coolant', count: 24 }],
  });
  assert.equal(weeklyNet(fed, 'Coolant'), 24 * 5 * HOURS_PER_WEEK); // 20,160
  assert.equal(fed.stages[0]!.limitedBy, 'capacity');

  const starved = steadyState({
    extractors: [],
    imports: [
      { commodity: 'Water', qtyPerHour: 24 * 40 },
      { commodity: 'Electrolytes', qtyPerHour: 12 * 40 },
    ],
    factories: [{ schematic: 'Coolant', count: 24 }],
  });
  assert.equal(weeklyNet(starved, 'Coolant'), 10080);
  assert.deepEqual(starved.stages[0]!.limitedBy, { input: 'Electrolytes' });
  assert.equal(starved.stages[0]!.utilization, 0.5);
  // The unconsumed Water is disclosed as surplus, not vanished
  assert.equal(starved.perHour.get('Water')!.net, 12 * 40);
});

test('vertical chain in one colony: extractor → basics → advanced runs tier by tier', () => {
  const flow = steadyState({
    extractors: [
      { resource: 'Aqueous Liquids', w: W, programHours: 6, extraction: legacy },
      { resource: 'Ionic Solutions', w: W, programHours: 6, extraction: legacy },
    ],
    imports: [],
    factories: [
      // declared out of order on purpose: tier ordering must feed basics first
      { schematic: 'Coolant', count: 4 },
      { schematic: 'Water', count: 8 },
      { schematic: 'Electrolytes', count: 8 },
    ],
  });
  // 8 basics each: 320 P1/h of each input; 4 advanced need 160/h each → capacity-limited
  assert.equal(flow.stages[0]!.limitedBy, 'capacity');
  assert.equal(weeklyNet(flow, 'Coolant'), 4 * 5 * HOURS_PER_WEEK);
  // Water surplus: 320 produced − 160 consumed = 160/h net
  assert.ok(Math.abs(flow.perHour.get('Water')!.net - 160) < 1e-9);
});

test('high-tech chain arithmetic: 16 HT plants fully fed → 2,688 P4/week', () => {
  const flow = steadyState({
    extractors: [],
    imports: [
      { commodity: 'Neocoms', qtyPerHour: 16 * 6 },
      { commodity: 'Data Chips', qtyPerHour: 16 * 6 },
      { commodity: 'High-Tech Transmitters', qtyPerHour: 16 * 6 },
    ],
    factories: [{ schematic: 'Broadcast Node', count: 16 }],
  });
  assert.equal(weeklyNet(flow, 'Broadcast Node'), 2688);
});

test('runway is a QOL metric: buffers change visit cadence, never throughput', () => {
  const r = extractionColony({ resource: 'Aqueous Liquids', w: W, programHours: 6, basics: 8, extraction: legacy });
  // Net accumulation: 320 P1/h × 0.19 m³ + surplus P0 × 0.005 m³
  const expected = 320 * 0.19 + r.surplusP0PerHour * 0.005;
  assert.ok(Math.abs(surplusM3PerHour(r.flow) - expected) < 1e-6);
  const pad = runwayHours(r.flow, 10000);
  const padPlusStorage = runwayHours(r.flow, 22000);
  assert.ok(pad > 0 && padPlusStorage > pad);
  assert.equal(runwayHours(steadyState({ extractors: [], imports: [], factories: [] }), 10000), Infinity);
});

test('strict plan validation: unknown keys, unknown schematics, non-P0 extraction all throw', () => {
  assert.throws(
    () => colonyPlan({ extractors: [], imports: [], factories: [], sliders: true } as never),
    /unknown keys: sliders/,
  );
  assert.throws(
    () => steadyState({ extractors: [], imports: [], factories: [{ schematic: 'Tritanium', count: 1 }] }),
    /Unknown schematic/,
  );
  assert.throws(
    () => steadyState({ extractors: [{ resource: 'Water', w: 100, programHours: 6 }], imports: [], factories: [] }),
    /must be a P0/,
  );
  assert.throws(
    () => steadyState({ extractors: [], imports: [{ commodity: 'Water', qtyPerHour: -5 }], factories: [] }),
    /qtyPerHour/,
  );
});
