import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPrices, snapshotAgeMinutes, JITA_44_STATION_ID, type FetchJson } from '../src/data/prices.js';
import { idRegistry } from '../src/data/ids.js';
import type { GeneratedIds } from '../src/data/generated-ids.js';
import { importColony, observedDensities, type EsiPlanetDetail, type EsiPlanetSummary } from '../src/data/importer.js';

const testIds: GeneratedIds = {
  meta: { status: 'generated', generatedAt: '2026-08-25T00:00:00Z', source: 'test fixture' },
  commodities: { 'Aqueous Liquids': 2268, Water: 3645, Coolant: 9832 },
  schematics: { '121': 'Water', '65': 'Coolant' },
  pinKinds: { '9001': 'basic', '9002': 'advanced', '9003': 'launchpad', '9004': 'commandCenter', '9005': 'storage' },
};

test('id registry refuses missing entries BY NAME and points at the generator', () => {
  const ids = idRegistry(testIds);
  assert.equal(ids.typeIdOf('Water'), 3645);
  assert.equal(ids.nameOf(9832), 'Coolant');
  assert.equal(ids.schematicName(121), 'Water');
  assert.equal(ids.pinKind(9002), 'advanced');
  assert.throws(() => ids.typeIdOf('Robotics'), /missing-typeid: "Robotics".*gen-sde/);
  assert.throws(() => ids.nameOf(42), /missing-typeid-name: 42/);
  assert.throws(() => ids.schematicName(999), /missing-schematic-id: 999/);
  assert.throws(() => ids.pinKind(1), /missing-pin-type: 1/);
  // The shipped partial registry carries only EVE-Ref-verified ids
  const shipped = idRegistry();
  assert.equal(shipped.meta.status, 'partial');
  assert.equal(shipped.typeIdOf('Water'), 3645);
});

function fakeEsi(ordersByType: Record<number, Array<{ buy: boolean; price: number; at?: number }>>, history?: number[]): FetchJson {
  return async (url: string) => {
    const m = /markets\/\d+\/(orders|history)\/\?type_id=(\d+)/.exec(url);
    if (m === null) throw new Error(`unexpected url ${url}`);
    const typeId = Number(m[2]);
    if (m[1] === 'history') {
      if (history === undefined) throw new Error('no history');
      return { body: history.map((volume, i) => ({ date: `2026-08-${10 + i}`, volume })), headers: {} };
    }
    return {
      body: (ordersByType[typeId] ?? []).map((o) => ({
        is_buy_order: o.buy, price: o.price, type_id: typeId,
        location_id: o.at ?? JITA_44_STATION_ID, volume_remain: 1000,
      })),
      headers: {},
    };
  };
}

test('price service: best bid/ask AT THE STATION, other locations excluded, volume averaged', async () => {
  const snapshot = await fetchPrices(['Coolant'], {
    ids: idRegistry(testIds),
    now: () => '2026-08-25T12:00:00Z',
    fetchJson: fakeEsi(
      {
        9832: [
          { buy: true, price: 11000 }, { buy: true, price: 10500 },
          { buy: true, price: 99999, at: 123 },          // elsewhere: ignored
          { buy: false, price: 12500 }, { buy: false, price: 13000 },
          { buy: false, price: 1, at: 123 },             // elsewhere: ignored
        ],
      },
      [4000, 5000, 6000, 5000, 5000, 5000, 5000],
    ),
  });
  const q = snapshot.prices['Coolant']!;
  assert.equal(q.bid, 11000);
  assert.equal(q.ask, 12500);
  // T-18 venue consistency: regional daily volume (5000) is scaled by the
  // station's share of the standing book — 4 of 6 equal-volume orders sit at
  // the station, so 5000 × 4/6.
  assert.ok(Math.abs((q.dailyVolume ?? 0) - 5000 * (4 / 6)) < 1e-6);
  assert.deepEqual(snapshot.unpriced, []);
  assert.match(snapshot.source, /region 10000002/);
});

test('price service pages the order book — best prices beyond page 1 are seen (T-18)', async () => {
  // Page 1 carries a worse ask; page 2 carries the true best ask + the only
  // bid. Reading page 1 alone would misprice the ask AND drop the bid side.
  const paged: FetchJson = async (url: string) => {
    if (/history/.test(url)) return { body: [{ date: '2026-08-10', volume: 7000 }], headers: {} };
    const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? '1');
    const mk = (buy: boolean, price: number) => ({
      is_buy_order: buy, price, type_id: 9832, location_id: JITA_44_STATION_ID, volume_remain: 500,
    });
    if (page === 1) return { body: [mk(false, 14000)], headers: { 'x-pages': '2' } };
    return { body: [mk(false, 12250), mk(true, 11750)], headers: {} };
  };
  const snapshot = await fetchPrices(['Coolant'], {
    ids: idRegistry(testIds),
    now: () => '2026-08-25T12:00:00Z',
    fetchJson: paged,
  });
  const q = snapshot.prices['Coolant']!;
  assert.equal(q.ask, 12250, 'best ask lives on page 2 — paging must find it');
  assert.equal(q.bid, 11750, 'the only bid lives on page 2');
  assert.deepEqual(snapshot.unpriced, []);
});

test('price service: one-sided or empty books are UNPRICED with reasons, never guessed', async () => {
  const snapshot = await fetchPrices(['Coolant', 'Water', 'Robotics'], {
    ids: idRegistry(testIds),
    now: () => '2026-08-25T12:00:00Z',
    fetchJson: fakeEsi({
      9832: [{ buy: true, price: 11000 }], // no asks
      3645: [],                            // empty book
    }),
  });
  assert.equal(Object.keys(snapshot.prices).length, 0);
  const reasons = Object.fromEntries(snapshot.unpriced.map((u) => [u.name, u.reason]));
  assert.match(reasons['Coolant']!, /ask side empty/);
  assert.match(reasons['Water']!, /no orders/);
  assert.match(reasons['Robotics']!, /missing-typeid/);
});

test('staleness is measurable data', () => {
  const snap = { prices: {}, fetchedAt: '2026-08-25T12:00:00Z', source: 's', regionId: 1, locationId: null, unpriced: [] };
  assert.equal(snapshotAgeMinutes(snap, '2026-08-25T12:45:00Z'), 45);
  assert.throws(() => snapshotAgeMinutes(snap, '2026-08-25T11:00:00Z'), /snapshot-age-invalid/);
});

const summary: EsiPlanetSummary = {
  planet_id: 40001234, planet_type: 'barren', solar_system_id: 30001, num_pins: 12,
  upgrade_level: 4, last_update: '2026-08-24T20:00:00Z',
};

const detail: EsiPlanetDetail = {
  pins: [
    { pin_id: 1, type_id: 7777, extractor_details: { cycle_time: 1800, qty_per_cycle: 9143.7, product_type_id: 2268, heads: [{ head_id: 0, latitude: 1, longitude: 1 }, { head_id: 1, latitude: 1, longitude: 1.1 }] }, expiry_time: '2026-08-26T02:00:00Z' },
    { pin_id: 2, type_id: 9001, schematic_id: 121 },
    { pin_id: 3, type_id: 9001, schematic_id: 121 },
    { pin_id: 4, type_id: 9003 },
    { pin_id: 5, type_id: 9004 },
    { pin_id: 6, type_id: 4242 }, // unknown pin type
  ],
  routes: [{ source_pin_id: 1, destination_pin_id: 2, content_type_id: 2268, quantity: 3000 }],
};

test('importer: real w from extractor_details, pins classified, unknowns SURFACED not dropped', () => {
  const c = importColony('main', summary, detail, idRegistry(testIds));
  assert.equal(c.planetType, 'Barren');
  assert.equal(c.ccLevel, 4);
  assert.equal(c.extractors.length, 1);
  const e = c.extractors[0]!;
  assert.equal(e.resource, 'Aqueous Liquids');
  assert.equal(e.w, 9143.7); // THE raw survey value, no typing
  assert.equal(e.cycleSeconds, 1800);
  assert.equal(e.heads, 2);
  assert.equal(e.expiry, '2026-08-26T02:00:00Z');
  assert.deepEqual(c.facilities, { ecu: 1, basic: 2, launchpad: 1, commandCenter: 1 });
  assert.deepEqual(c.production, { Water: 2 });
  assert.equal(c.unclassified.length, 1);
  assert.equal(c.unclassified[0]!.typeId, 4242);
  assert.match(c.unclassified[0]!.reason, /missing-pin-type/);
});

test('importer: idle extractors are not density observations; observedDensities carries provenance', () => {
  const idle: EsiPlanetDetail = {
    pins: [{ pin_id: 1, type_id: 7777, extractor_details: { cycle_time: 0, qty_per_cycle: 0, product_type_id: 2268, heads: [] } }],
    routes: [],
  };
  const c = importColony('main', summary, idle, idRegistry(testIds));
  assert.equal(c.extractors.length, 0);
  assert.equal(c.facilities['ecu'], 1); // the building exists, the program does not

  const obs = observedDensities([importColony('main', summary, detail, idRegistry(testIds))]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.w, 9143.7);
  assert.equal(obs[0]!.source, 'esi-import');
  assert.equal(obs[0]!.observedAt, '2026-08-24T20:00:00Z');
});

test('importer: invalid planet types and CC levels refuse by name', () => {
  assert.throws(
    () => importColony('m', { ...summary, planet_type: 'shattered' }, detail, idRegistry(testIds)),
    /import-planet-type-unknown: "shattered"/,
  );
  assert.throws(
    () => importColony('m', { ...summary, upgrade_level: 9 }, detail, idRegistry(testIds)),
    /import-cc-level-invalid: 9/,
  );
});
