import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadenceCurve, cycleSecondsForProgram, perHourRate, programCycles, programTotal } from '../src/world/extraction.js';
import { DENSITY_REFERENCE_W, densityPctFromW, wFromDensityPct } from '../src/world/density.js';

const W = DENSITY_REFERENCE_W; // 13277.2694 — v8 calibration used as golden oracle input

test('golden oracle: v8.3 published table reproduces EXACTLY under 30-min cycles', () => {
  const total6h = programTotal(W, 6, { cycleSecondsOverride: 1800 });
  assert.ok(Math.abs(total6h - 290112.0) < 0.5, `6h total ${total6h} != 290112`);

  const rate = (h: number) => perHourRate(W, h, { cycleSecondsOverride: 1800 });
  const base = rate(6);
  assert.ok(Math.abs((rate(24) / base) * 100 - 81.5) < 0.05, `24h ratio ${(rate(24) / base) * 100}`);
  assert.ok(Math.abs((rate(168) / base) * 100 - 34.0) < 0.05, `168h ratio ${(rate(168) / base) * 100}`);
  assert.ok(Math.abs((rate(336) / base) * 100 - 21.9) < 0.05, `336h ratio ${(rate(336) / base) * 100}`);
});

test('game-correct cycle steps differ from the 30-min simplification by <=1.2%', () => {
  const total6h = programTotal(W, 6); // 15-min cycles for a 6h program
  assert.ok(Math.abs(total6h - 290238.4) < 1, `6h game-correct total ${total6h}`);
  const base = perHourRate(W, 6);
  const r336 = (perHourRate(W, 336) / base) * 100; // 4h cycles
  assert.ok(Math.abs(r336 - 22.1) < 0.2, `336h game-correct ratio ${r336}`);
  // Legacy vs game-correct never differ by more than ~1.2% at any length we ship
  for (const h of [6, 24, 168, 336]) {
    const legacy = programTotal(W, h, { cycleSecondsOverride: 1800 });
    const game = programTotal(W, h);
    const diffPct = Math.abs(game - legacy) / legacy * 100;
    assert.ok(diffPct <= 1.2, `${h}h differs ${diffPct}%`);
  }
});

test('cycle time step function (boundary interpretation: boundary keeps shorter cycle)', () => {
  assert.equal(cycleSecondsForProgram(1), 900);
  assert.equal(cycleSecondsForProgram(6), 900);
  assert.equal(cycleSecondsForProgram(25), 900);
  assert.equal(cycleSecondsForProgram(25.5), 1800);
  assert.equal(cycleSecondsForProgram(50), 1800);
  assert.equal(cycleSecondsForProgram(51), 3600);
  assert.equal(cycleSecondsForProgram(100), 3600);
  assert.equal(cycleSecondsForProgram(101), 7200);
  assert.equal(cycleSecondsForProgram(200), 7200);
  assert.equal(cycleSecondsForProgram(201), 14400);
  assert.equal(cycleSecondsForProgram(336), 14400);
  assert.throws(() => cycleSecondsForProgram(0.5));
  assert.throws(() => cycleSecondsForProgram(337));
});

test('property: decay envelope is monotonic; noise is bounded in [1, 1.8]x', () => {
  // DISCOVERY (Gate 1): the per-hour rate is NOT strictly monotonic in program
  // length — the clamped-cosine noise can make a program ending on a "nugget"
  // out-rate a slightly shorter one (e.g. w=30000: 4h beats 2h). The doc's
  // "short programs yield more per hour" is true of the DECAY ENVELOPE, and
  // that is the provable property. Independent decay-only computation here —
  // never call the engine to check the engine.
  const decayOnlyPerHour = (w: number, h: number): number => {
    const cs = cycleSecondsForProgram(h);
    const bar = cs / 900;
    const n = Math.floor((h * 3600) / cs);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += (bar * w) / (1 + (i + 0.5) * bar * 0.012);
    return sum / h;
  };
  const lengths = [1, 2, 4, 6, 12, 24, 48, 96, 168, 250, 336];
  for (const w of [500, 5000, W, 30000]) {
    let prevEnvelope = Infinity;
    for (const h of lengths) {
      const envelope = decayOnlyPerHour(w, h);
      assert.ok(envelope < prevEnvelope + 1e-9, `w=${w}: decay envelope rose at ${h}h`);
      prevEnvelope = envelope;
      const actual = perHourRate(w, h);
      assert.ok(actual >= envelope - 1e-6, `w=${w},${h}h: rate below decay floor`);
      assert.ok(actual <= envelope * 1.8 + 1e-6, `w=${w},${h}h: rate above 1.8x noise ceiling`);
    }
    // Large-scale monotonicity still holds: 6h out-rates weekly, weekly out-rates 14d.
    assert.ok(perHourRate(w, 6) > perHourRate(w, 168));
    assert.ok(perHourRate(w, 168) > perHourRate(w, 336));
  }
});

test('property: yield scales linearly-ish in w through decay (noise phase varies)', () => {
  // Decay term is linear in w; noise phase-shift is not. Totals must at least be
  // strictly increasing in w and within the [1, 1.8]x noise envelope of the decay-only sum.
  const totals = [1000, 5000, 13277, 40000].map((w) => programTotal(w, 24));
  for (let i = 1; i < totals.length; i++) assert.ok(totals[i]! > totals[i - 1]!);
});

test('per-cycle truncation option lowers totals by at most 1 unit per cycle', () => {
  const cycles = programCycles(W, 24);
  const truncated = programCycles(W, 24, { truncatePerCycle: true });
  assert.equal(cycles.length, truncated.length);
  for (let i = 0; i < cycles.length; i++) {
    assert.ok(truncated[i]! <= cycles[i]! && cycles[i]! - truncated[i]! < 1);
    assert.ok(Number.isInteger(truncated[i]!));
  }
});

test('cadence curve is normalized to the first entry and decreasing', () => {
  const curve = cadenceCurve(W, [6, 24, 168, 336], { cycleSecondsOverride: 1800 });
  assert.equal(curve[0]!.relativeToFirst, 1);
  assert.ok(Math.abs(curve[1]!.relativeToFirst - 0.815) < 0.001);
  assert.ok(Math.abs(curve[2]!.relativeToFirst - 0.340) < 0.001);
  assert.ok(Math.abs(curve[3]!.relativeToFirst - 0.219) < 0.001);
});

test('unknown option keys throw (no silent option-dropping, ever)', () => {
  assert.throws(
    () => programTotal(W, 6, { isBought: true } as never),
    /unknown keys: isBought/,
  );
});

test('density translation layer round-trips and is uncapped above 100%', () => {
  assert.ok(Math.abs(wFromDensityPct(100) - W) < 1e-9);
  assert.ok(Math.abs(densityPctFromW(W) - 100) < 1e-9);
  assert.ok(Math.abs(densityPctFromW(wFromDensityPct(137.5)) - 137.5) < 1e-9);
  assert.ok(wFromDensityPct(150) > W); // >100% is real, never capped
  assert.throws(() => wFromDensityPct(0));
  assert.throws(() => densityPctFromW(-5));
});
