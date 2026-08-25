import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHETYPES, fitsCommandCenter, layout, layoutDemand, linkCpuTf, linkPgMw } from '../src/world/facilities.js';
import { LINK_CAPACITY_M3 } from '../src/spec/constants.js';

const links = (n: number) => Array.from({ length: n }, () => ({ lengthKm: 0, level: 0 }));

test('archetype fixtures fit CC level 5 (verification 2026-08-25)', () => {
  for (const [name, arch] of Object.entries(ARCHETYPES)) {
    const fit = fitsCommandCenter(arch, 5);
    assert.ok(fit.fits, `${name} must fit CC5: ${fit.why.join('; ')}`);
  }
});

test('feasibility edges: 25 advanced fits, 26 does not; 19 HT fits, 20 does not', () => {
  const adv = (n: number) =>
    layout({ ecus: 0, headsPerEcu: [], basic: 0, advanced: n, hightech: 0, storage: 0, launchpads: 1, links: links(n + 1) });
  assert.ok(fitsCommandCenter(adv(25), 5).fits);
  const over = fitsCommandCenter(adv(26), 5);
  assert.ok(!over.fits);
  assert.match(over.why.join(' '), /pg-exceeded/);

  const ht = (n: number) =>
    layout({ ecus: 0, headsPerEcu: [], basic: 0, advanced: 0, hightech: n, storage: 0, launchpads: 1, links: links(n + 1) });
  assert.ok(fitsCommandCenter(ht(19), 5).fits);
  const overHt = fitsCommandCenter(ht(20), 5);
  assert.ok(!overHt.fits);
  assert.match(overHt.why.join(' '), /cpu-exceeded/);
});

test('surplus-density option: 12 basics beside a 10-head ECU still fit CC5', () => {
  const l = layout({
    ecus: 1, headsPerEcu: [10], basic: 12, advanced: 0, hightech: 0, storage: 0, launchpads: 1, links: links(14),
  });
  assert.ok(fitsCommandCenter(l, 5).fits);
});

test('extraction archetype demand matches hand-computed CPU/PG', () => {
  const d = layoutDemand(ARCHETYPES.extraction);
  // ECU 400 + 10 heads ×110 + 8 basic ×200 + pad 3600 + 10 links ×15 = 6,850 tf
  assert.equal(d.cpuTf, 400 + 1100 + 1600 + 3600 + 150);
  // ECU 2600 + heads 5500 + basic 6400 + pad 700 + links 100 = 15,300 MW
  assert.equal(d.pgMw, 2600 + 5500 + 6400 + 700 + 100);
});

test('link cost scales with distance; capacity doubles per level', () => {
  assert.equal(linkCpuTf({ lengthKm: 0, level: 0 }), 15);
  assert.equal(linkPgMw({ lengthKm: 0, level: 0 }), 10);
  assert.equal(linkCpuTf({ lengthKm: 100, level: 0 }), 15 + 20);
  assert.equal(linkPgMw({ lengthKm: 100, level: 0 }), 10 + 15);
  assert.equal(LINK_CAPACITY_M3(0), 250);
  assert.equal(LINK_CAPACITY_M3(10), 256000);
  assert.throws(() => LINK_CAPACITY_M3(11));
});

test('upgraded links refuse to be priced by NAME until scaling is measured', () => {
  assert.throws(() => linkCpuTf({ lengthKm: 0, level: 1 }), /unverified \(OPEN-QUESTIONS #3\)/);
});

test('layout constructor: unknown keys and illegal counts throw by name', () => {
  assert.throws(
    () => layout({ ecus: 0, headsPerEcu: [], basic: 0, advanced: 1, hightech: 0, storage: 0, launchpads: 1, links: [], sliders: 3 } as never),
    /unknown keys: sliders/,
  );
  assert.throws(
    () => layout({ ecus: 1, headsPerEcu: [11], basic: 0, advanced: 0, hightech: 0, storage: 0, launchpads: 1, links: [] }),
    /heads per ECU must be 1\.\.10/,
  );
  assert.throws(
    () => layout({ ecus: 2, headsPerEcu: [5], basic: 0, advanced: 0, hightech: 0, storage: 0, launchpads: 1, links: [] }),
    /headsPerEcu has 1 entries for 2/,
  );
});

test('fit failures name their reason (no silent failures)', () => {
  const monster = layout({
    ecus: 0, headsPerEcu: [], basic: 0, advanced: 40, hightech: 0, storage: 0, launchpads: 1, links: links(41),
  });
  const fit = fitsCommandCenter(monster, 5);
  assert.ok(!fit.fits);
  assert.ok(fit.why.length > 0);
  for (const reason of fit.why) assert.match(reason, /needs \d+.*provides \d+/);
});
