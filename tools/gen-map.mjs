#!/usr/bin/env node
/**
 * Generates static/map/universe-map.json for the Region Scout from CCP's
 * OFFICIAL Static Data Export — the post-September-2025 JSON-Lines format,
 * downloaded straight from the developers site (no third-party mirror; the
 * old Fuzzwork CSV tables this script once used no longer exist). Run in an
 * environment with network access (Ryan's machine or CI):
 *
 *   node tools/gen-map.mjs
 *
 * Source: https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip
 * (always redirects to the newest build). Files used, schema per the
 * official docs:
 *   mapRegions.jsonl       _key (regionID), name.en
 *   mapSolarSystems.jsonl  _key (systemID), name.en, securityStatus, regionID
 *   mapPlanets.jsonl       _key, typeID, solarSystemID, celestialIndex,
 *                          uniqueName.en (rare special names)
 *
 * Planet display names follow the game's own convention — "<system> <roman
 * celestialIndex>" — with uniqueName.en used verbatim when CCP provides one.
 * Planet type ids map through the SAME registry the site uses at runtime
 * (esi-universe PLANET_TYPE_ID_TO_NAME, v8-verbatim). Unknown ids (shattered
 * planets etc.) are skipped and COUNTED in the output header — never guessed.
 *
 * The zip is read with plain Node (zlib inflate + a minimal central-directory
 * walk) — no npm install, no system tools. Offline gate:
 * node tools/gen-map-e2e.mjs (mock download, full pipeline).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const ZIP_URL = process.env.GEN_MAP_ZIP_URL
  ?? 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';
const UA = 'SolvingPI-v9 gen-map (https://solvingpi.com; contact via site)';
const here = dirname(fileURLToPath(import.meta.url));

// Same ids as src/ui/esi-universe.ts PLANET_TYPE_ID_TO_NAME (v8 verbatim).
const PLANET_TYPE_ID_TO_NAME = {
  2016: 'Barren', 13: 'Gas', 12: 'Ice', 2015: 'Lava',
  2014: 'Oceanic', 2063: 'Plasma', 2017: 'Storm', 11: 'Temperate',
};

// The game names planets "<system> <roman index>"; celestialIndex is 1..18.
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

/** Minimal ZIP reader: central directory → named entries, deflate/store only.
 * The SDE zip is a plain small-entry archive; anything exotic refuses by name. */
function readZipEntries(buf, wanted) {
  // End-of-central-directory: scan back for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end-of-central-directory not found — download truncated?');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error(`zip: bad central-directory entry at ${off}`);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const short = wanted.find((w) => name === w || name.endsWith(`/${w}`));
    if (short !== undefined) {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      if (method === 8) out.set(short, inflateRawSync(raw));
      else if (method === 0) out.set(short, Buffer.from(raw));
      else throw new Error(`zip: unsupported compression method ${method} for ${name}`);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  for (const w of wanted) if (!out.has(w)) throw new Error(`zip: ${w} not found in the SDE archive — has CCP renamed it?`);
  return out;
}

const jsonl = (buf) => buf.toString('utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));

console.log(`gen-map: downloading the official SDE (JSON Lines) from CCP …`);
console.log('gen-map: this is a few hundred MB — give it a few minutes.');
const res = await fetch(ZIP_URL, { headers: { 'User-Agent': UA } });
if (!res.ok) throw new Error(`SDE download: HTTP ${res.status} (${ZIP_URL})`);
const zip = Buffer.from(await res.arrayBuffer());
console.log(`gen-map: downloaded ${(zip.length / 1048576).toFixed(0)} MB — unpacking the three map tables …`);
const entries = readZipEntries(zip, ['mapRegions.jsonl', 'mapSolarSystems.jsonl', 'mapPlanets.jsonl']);

const regions = jsonl(entries.get('mapRegions.jsonl'));
const systems = jsonl(entries.get('mapSolarSystems.jsonl'));
const planets = jsonl(entries.get('mapPlanets.jsonl'));

const systemName = new Map(systems.map((s) => [s._key, s.name?.en ?? `system ${s._key}`]));
const planetsBySystem = new Map();
let skipped = 0;
for (const p of planets) {
  const type = PLANET_TYPE_ID_TO_NAME[p.typeID];
  if (type === undefined) { skipped++; continue; }
  const sys = systemName.get(p.solarSystemID);
  if (sys === undefined) { skipped++; continue; }
  const roman = ROMAN[p.celestialIndex] ?? String(p.celestialIndex);
  const name = p.uniqueName?.en ?? `${sys} ${roman}`;
  if (!planetsBySystem.has(p.solarSystemID)) planetsBySystem.set(p.solarSystemID, []);
  planetsBySystem.get(p.solarSystemID).push({ index: p.celestialIndex, name, type });
}
for (const list of planetsBySystem.values()) list.sort((a, b) => a.index - b.index);

const systemsByRegion = new Map();
for (const s of systems) {
  if (!systemsByRegion.has(s.regionID)) systemsByRegion.set(s.regionID, []);
  systemsByRegion.get(s.regionID).push({
    id: s._key,
    name: s.name?.en ?? `system ${s._key}`,
    security: Math.round((s.securityStatus ?? 0) * 100) / 100,
    planets: (planetsBySystem.get(s._key) ?? []).map(({ name, type }) => ({ name, type })),
  });
}

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  skippedPlanets: skipped,
  regions: regions
    .map((r) => ({
      id: r._key,
      name: r.name?.en ?? `region ${r._key}`,
      systems: (systemsByRegion.get(r._key) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((r) => r.systems.some((s) => s.planets.length > 0))
    .sort((a, b) => a.name.localeCompare(b.name)),
};

if (process.env.GEN_MAP_ZIP_URL === undefined && out.regions.length < 60)
  throw new Error(`gen-map: only ${out.regions.length} regions with planets — refusing a partial map`);

const dir = process.env.GEN_MAP_OUT ?? join(here, '..', 'static', 'map');
mkdirSync(dir, { recursive: true });
const path = join(dir, 'universe-map.json');
writeFileSync(path, JSON.stringify(out));
const systemsTotal = out.regions.reduce((n, r) => n + r.systems.length, 0);
console.log(`gen-map: wrote ${path} — ${out.regions.length} regions, ${systemsTotal} systems, ${skipped} planets skipped (unknown type or orphaned).`);
