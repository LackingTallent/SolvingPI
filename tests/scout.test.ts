/**
 * Region Scout scoring: phantom worlds per system, real engine underneath.
 * The scout's promises: never throw on a bad system (rank it last with the
 * reason), feasible-first ordering, quota verdicts honest, planet-type facts
 * summarized without invention.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planetTypeCounts, scoutSystems, type ScoutSystemInfo } from '../src/engine/scout.js';
import { character, operation } from '../src/world/characters.js';
import type { MarketContext } from '../src/engine/modes.js';
import { wFromDensityPct } from '../src/world/density.js';

const op = (n = 2) => operation(Array.from({ length: n }, (_, i) => character({
  name: `C${i}`, icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5,
})));

const market: MarketContext = {
  prices: {
    Water: { bid: 750, ask: 900 }, Electrolytes: { bid: 600, ask: 700 },
    Coolant: { bid: 9800, ask: 10500 },
    'Aqueous Liquids': { bid: 5, ask: 7 }, 'Ionic Solutions': { bid: 6, ask: 8 },
  },
  sellBasis: 'immediate', buyBasis: 'immediate',
  fees: { salesTaxRate: 0.03375, brokerRate: 0.015 },
  customs: { ownerRate: 0.05, hisecNpc: false, customsCodeLevel: 5 },
  freightOutPerM3: 10, freightInPerM3: 10,
};

const sys = (id: number, name: string, security: number, pct: number, types: ReadonlyArray<[string, string]>): ScoutSystemInfo => ({
  id, name, security, assumedW: wFromDensityPct(pct),
  planets: types.map(([pname, t]) => ({ name: pname, type: t as ScoutSystemInfo['planets'][number]['type'] })),
});

// Coolant needs Water (Aqueous Liquids: many types) + Electrolytes (Ionic
// Solutions: Storm/Gas). A system with Storm+Gas covers it; Barren-only can't.
const covered = sys(1, 'Covers', -0.3, 90, [['Covers I', 'Storm'], ['Covers II', 'Gas'], ['Covers III', 'Storm']]);
const uncovered = sys(2, 'Barrens', -0.3, 90, [['Barrens I', 'Barren'], ['Barrens II', 'Barren']]);
const hisecTwin = sys(3, 'Hicover', 0.9, 30, [['Hicover I', 'Storm'], ['Hicover II', 'Gas'], ['Hicover III', 'Storm']]);
const empty = sys(4, 'Void', -0.5, 90, []);

test('scout: covering system feasible and ranked above non-covering; empty system explains itself', () => {
  const rows = scoutSystems([uncovered, covered, empty], op(), 6, market, { mode: 'max', product: 'Coolant' });
  assert.equal(rows[0]!.system.name, 'Covers');
  assert.equal(rows[0]!.feasible, true);
  assert.ok(rows[0]!.netPerWeek > 0);
  const voidRow = rows.find((r) => r.system.name === 'Void')!;
  assert.equal(voidRow.feasible, false);
  assert.match(voidRow.note, /no planets/);
  // Barrens carries neither ore — yet it IS feasible via the buy-inputs cut
  // (import P1s, run the factory): the scout must surface that plan too,
  // just ranked below the system that can mine.
  const barrens = rows.find((r) => r.system.name === 'Barrens')!;
  assert.equal(barrens.feasible, true);
  assert.ok(barrens.netPerWeek < rows[0]!.netPerWeek);
});

test('scout: identical planets — the better assumed band outranks (null over high)', () => {
  const rows = scoutSystems([hisecTwin, covered], op(), 6, market, { mode: 'max', product: 'Coolant' });
  assert.equal(rows[0]!.system.name, 'Covers');
  assert.ok(rows[0]!.netPerWeek > rows[1]!.netPerWeek);
  assert.equal(rows[1]!.feasible, true);
});

test('scout quota: met vs under-target verdicts are honest', () => {
  const rowsLow = scoutSystems([covered], op(), 6, market, { mode: 'quota', product: 'Coolant', quotaPerWeek: 100 });
  assert.equal(rowsLow[0]!.feasible, true);
  assert.match(rowsLow[0]!.note, /meets/);
  const rowsHigh = scoutSystems([covered], op(), 6, market, { mode: 'quota', product: 'Coolant', quotaPerWeek: 10_000_000 });
  assert.equal(rowsHigh[0]!.feasible, false);
  assert.match(rowsHigh[0]!.note, /tops out at/);
});

test('scout compare: picks its own best product per system', () => {
  const rows = scoutSystems([covered], op(), 6, market, { mode: 'compare' });
  assert.equal(rows[0]!.feasible, true);
  assert.ok(rows[0]!.product.length > 0);
  assert.match(rows[0]!.note, /best product here/);
});

test('scout: product goal without a product is a named caller error', () => {
  assert.throws(() => scoutSystems([covered], op(), 6, market, { mode: 'max' }), /scout-goal-invalid/);
});

test('scout: no prices — systems rank infeasible with reasons, never a throw', () => {
  const noPrices: MarketContext = { ...market, prices: {} };
  const rows = scoutSystems([covered], op(), 6, noPrices, { mode: 'max', product: 'Coolant' });
  assert.equal(rows[0]!.feasible, false);
  assert.ok(rows[0]!.note.length > 0);
});

test('planetTypeCounts: counts by type, biggest first, no invention', () => {
  const counts = planetTypeCounts(covered.planets);
  assert.deepEqual(counts, [['Storm', 2], ['Gas', 1]]);
});
