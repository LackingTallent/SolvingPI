// Offline gate for gen-map: a mock CCP SDE download — a real zip (deflate)
// holding nested jsonl files with the official schema — run through the full
// pipeline. Asserts: roman-numeral naming, uniqueName override, unknown-type
// skip counting, region filtering, wormhole security carried.
// Run: node tools/gen-map-e2e.mjs
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';

rmSync('/tmp/genmap-fix', { recursive: true, force: true });
mkdirSync('/tmp/genmap-fix/sde', { recursive: true });
const w = (f, rows) => writeFileSync(`/tmp/genmap-fix/sde/${f}`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
w('mapRegions.jsonl', [
  { _key: 10000001, name: { en: 'Testlands' }, constellationIDs: [1] },
  { _key: 10000002, name: { en: 'Empty Quarter' }, constellationIDs: [2] }, // no planets → filtered
  { _key: 11000005, name: { en: 'J-Space Test' }, constellationIDs: [3] },
]);
w('mapSolarSystems.jsonl', [
  { _key: 30000001, name: { en: 'Alpha' }, securityStatus: 0.912345, regionID: 10000001 },
  { _key: 30000002, name: { en: 'Beta' }, securityStatus: -0.213, regionID: 10000001 },
  { _key: 30000003, name: { en: 'Lonely' }, securityStatus: 0.5, regionID: 10000002 },
  { _key: 31000001, name: { en: 'J123456' }, securityStatus: -0.99, regionID: 11000005 },
]);
w('mapPlanets.jsonl', [
  { _key: 40000001, typeID: 2017, solarSystemID: 30000001, celestialIndex: 1 },
  { _key: 40000002, typeID: 13, solarSystemID: 30000001, celestialIndex: 4 },
  { _key: 40000003, typeID: 30889, solarSystemID: 30000001, celestialIndex: 2 }, // shattered → skipped
  { _key: 40000004, typeID: 2016, solarSystemID: 30000002, celestialIndex: 1, uniqueName: { en: 'New Caldari Prime' } },
  { _key: 40000005, typeID: 11, solarSystemID: 31000001, celestialIndex: 3 },
  { _key: 40000006, typeID: 2016, solarSystemID: 99999999, celestialIndex: 1 }, // orphan → skipped
]);
execSync('cd /tmp/genmap-fix && zip -qr sde-mock.zip sde');
const zipBytes = readFileSync('/tmp/genmap-fix/sde-mock.zip');

const server = createServer((req, res) => { res.end(zipBytes); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
process.env.GEN_MAP_ZIP_URL = `http://127.0.0.1:${server.address().port}/sde.zip`;
process.env.GEN_MAP_OUT = '/tmp/genmap-fix/out';
await import(new URL('./gen-map.mjs', import.meta.url).href);
server.close();

const out = JSON.parse(readFileSync('/tmp/genmap-fix/out/universe-map.json', 'utf8'));
const assert = (c, m) => { if (!c) { console.error('E2E FAIL: ' + m); process.exit(1); } };
assert(out.skippedPlanets === 2, `unknown-type + orphan planets skipped and counted (got ${out.skippedPlanets})`);
assert(out.regions.length === 2, `planet-less region filtered (got ${out.regions.length})`);
const test = out.regions.find((r) => r.name === 'Testlands');
const alpha = test.systems.find((s) => s.name === 'Alpha');
assert(alpha.planets.length === 2, 'Alpha keeps its two known-type planets');
assert(alpha.planets[0].name === 'Alpha I' && alpha.planets[0].type === 'Storm', `roman naming (got ${alpha.planets[0].name})`);
assert(alpha.planets[1].name === 'Alpha IV' && alpha.planets[1].type === 'Gas', `celestialIndex → roman (got ${alpha.planets[1].name})`);
assert(alpha.security === 0.91, 'security rounded to 2 decimals');
const beta = test.systems.find((s) => s.name === 'Beta');
assert(beta.planets[0].name === 'New Caldari Prime', 'uniqueName.en used verbatim');
const jr = out.regions.find((r) => r.name === 'J-Space Test');
assert(jr.id === 11000005 && jr.systems[0].planets[0].type === 'Temperate', 'J-space region + planets carried');
console.log('gen-map E2E: all assertions pass (official jsonl zip pipeline)');
