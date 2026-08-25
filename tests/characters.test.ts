import { test } from 'node:test';
import assert from 'node:assert/strict';
import { character, maxPlanets, operation, totalSlots } from '../src/world/characters.js';

const chr = (name: string, icLevel: number) =>
  character({ name, icLevel, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 });

test('planet budget: 1 + IC level, max 6 at V', () => {
  assert.equal(maxPlanets(chr('a', 0)), 1);
  assert.equal(maxPlanets(chr('a', 3)), 4);
  assert.equal(maxPlanets(chr('a', 5)), 6);
});

test('the [6,1,1] world: a main at IC V and two alts at IC 0 is 8 slots, not 18', () => {
  const op = operation([chr('main', 5), chr('alt1', 0), chr('alt2', 0)]);
  assert.equal(totalSlots(op), 8);
});

test('scale sweep: operations of 1, 2, 5, 10, 25, and 50 characters all sum correctly', () => {
  for (const n of [1, 2, 5, 10, 25, 50]) {
    const chars = Array.from({ length: n }, (_, i) => chr(`c${i}`, i % 6));
    const op = operation(chars);
    const expected = chars.reduce((a, c) => a + 1 + c.icLevel, 0);
    assert.equal(totalSlots(op), expected);
  }
});

test('supported size is 1..50: 0 and 51 throw by name', () => {
  assert.throws(() => operation([]), /supported size is 1\.\.50/);
  const many = Array.from({ length: 51 }, (_, i) => chr(`c${i}`, 5));
  assert.throws(() => operation(many), /supported size is 1\.\.50/);
});

test('strict constructors: unknown keys, bad levels, duplicate names throw', () => {
  assert.throws(
    () => character({ name: 'x', icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5, planets: 6 } as never),
    /unknown keys: planets/,
  );
  assert.throws(() => chr('x', 6), /icLevel/);
  assert.throws(() => chr('x', -1), /icLevel/);
  assert.throws(() => operation([chr('same', 5), chr('same', 0)]), /duplicate character name/);
  assert.throws(() => character({ ...chr('ok', 5), name: '' }), /non-empty/);
});
