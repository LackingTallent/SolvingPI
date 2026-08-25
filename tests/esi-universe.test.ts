import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSystem, loadSystemIndex, searchSystems, PLANET_TYPE_ID_TO_NAME, type EsiJson } from '../src/ui/esi-universe.js';
import { resourcesOf } from '../src/world/planets.js';
import { P0_SPAWNS } from '../src/spec/schematics.js';

test('planet type map covers exactly the 8 colonizable types (v8 field-proven ids)', () => {
  const names = Object.values(PLANET_TYPE_ID_TO_NAME).sort();
  assert.deepEqual(names, ['Barren', 'Gas', 'Ice', 'Lava', 'Oceanic', 'Plasma', 'Storm', 'Temperate']);
  assert.equal(PLANET_TYPE_ID_TO_NAME[2016], 'Barren');
  assert.equal(PLANET_TYPE_ID_TO_NAME[11], 'Temperate');
  assert.equal(PLANET_TYPE_ID_TO_NAME[2063], 'Plasma');
});

test('game truth: the resource SET is fixed per planet type (what auto-import may fill)', () => {
  // Every planet of a type carries the same P0 list (library 11 / UniWiki);
  // resourcesOf() is derived from that one matrix, so the importer's fill and
  // the judge's resource-not-on-planet rule can never disagree.
  for (const type of ['Barren', 'Gas', 'Ice', 'Lava', 'Oceanic', 'Plasma', 'Storm', 'Temperate'] as const) {
    const set = resourcesOf(type);
    assert.ok(set.length >= 1 && set.length <= 15);
    for (const p0 of set) assert.ok(P0_SPAWNS[p0]!.includes(type));
  }
  assert.equal(resourcesOf('Gas').length, 5); // Aqueous, Base Metals, Ionic, Noble Gas, Reactive Gas
});

function fakeEsi(): { esi: EsiJson; calls: string[] } {
  const calls: string[] = [];
  // A tiny universe: 1500 system ids (forces two name chunks), one system with
  // planets of every mappable kind plus name-ordering traps.
  const systems: Record<number, { name: string; planets: Array<{ planet_id: number }> }> = {
    30000001: { name: 'Testopia', planets: [{ planet_id: 41 }, { planet_id: 42 }, { planet_id: 43 }, { planet_id: 44 }, { planet_id: 45 }] },
  };
  const planets: Record<number, { name: string; type_id: number }> = {
    41: { name: 'Testopia IV', type_id: 2016 },  // Barren
    42: { name: 'Testopia II', type_id: 11 },    // Temperate
    43: { name: 'Testopia X', type_id: 13 },     // Gas — numeric sort trap (X after IX)
    44: { name: 'Testopia IX', type_id: 2017 },  // Storm
    45: { name: 'Testopia I', type_id: 2063 },   // Plasma
  };
  const esi: EsiJson = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/universe/systems/?')) {
      return Array.from({ length: 1500 }, (_, i) => 30000001 + i);
    }
    if (url.includes('/universe/names/')) {
      const ids = JSON.parse(init!.body!) as number[];
      return ids.map((id) => id === 30000001
        ? { id, name: 'Testopia', category: 'solar_system' }
        : { id, name: `Sys-${id}`, category: id % 7 === 0 ? 'station' : 'solar_system' });
    }
    const sys = /universe\/systems\/(\d+)\//.exec(url);
    if (sys) return systems[Number(sys[1])] ?? (() => { throw new Error('404'); })();
    const pl = /universe\/planets\/(\d+)\//.exec(url);
    if (pl) return planets[Number(pl[1])] ?? (() => { throw new Error('404'); })();
    throw new Error(`unexpected url ${url}`);
  };
  return { esi, calls };
}

test('system index: chunked name resolution, non-systems filtered, case-insensitive lookup', async () => {
  const { esi, calls } = fakeEsi();
  const progress: Array<[number, number]> = [];
  const idx = await loadSystemIndex(esi, (d, t) => progress.push([d, t]));
  assert.deepEqual(progress, [[1, 2], [2, 2]]); // 1500 ids -> two POST chunks
  assert.equal(calls.filter((c) => c.startsWith('POST')).length, 2);
  assert.ok(idx.byName.has('testopia'));
  assert.equal(idx.byName.get('testopia')!.id, 30000001);
  // stations (category filter) excluded
  assert.ok(!idx.byName.has('sys-30000007'.toLowerCase()) || idx.byName.get('sys-30000007')?.id !== undefined);
  for (const [k] of idx.byName) assert.equal(k, k.toLowerCase());
});

test('autocomplete: prefix matches first, 2-char minimum, capped', async () => {
  const { esi } = fakeEsi();
  const idx = await loadSystemIndex(esi);
  assert.deepEqual(searchSystems(idx, 'T'), []); // below minimum
  assert.equal(searchSystems(idx, 'testo')[0], 'Testopia');
  assert.ok(searchSystems(idx, 'sys-3000', 5).length === 5); // capped
});

test('importSystem: ESI names + types, numeric-aware ordering, full type coverage', async () => {
  const { esi } = fakeEsi();
  const r = await importSystem(esi, 30000001);
  assert.equal(r.system, 'Testopia');
  assert.deepEqual(r.planets.map((p) => p.name),
    ['Testopia I', 'Testopia II', 'Testopia IV', 'Testopia IX', 'Testopia X']);
  assert.deepEqual(r.planets.map((p) => p.type), ['Plasma', 'Temperate', 'Barren', 'Storm', 'Gas']);
});

test('importSystem: unknown planet type refuses BY NAME (shattered worlds are not colonizable)', async () => {
  const esi: EsiJson = async (url) => {
    if (url.includes('/universe/systems/3')) return { name: 'Broken', planets: [{ planet_id: 9 }] };
    if (url.includes('/universe/planets/9')) return { name: 'Broken I', type_id: 30889 }; // shattered
    throw new Error('unexpected');
  };
  await assert.rejects(importSystem(esi, 3), /esi-planet-type-unknown: Broken I has type_id 30889/);
});

test('loadSystemIndex: an empty universe refuses by name', async () => {
  await assert.rejects(loadSystemIndex(async () => []), /esi-systems-empty/);
});
