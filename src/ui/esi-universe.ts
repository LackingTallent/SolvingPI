/**
 * ESI universe lookups for the system search: resolve system names and load a
 * system's planets (names + types) from CCP's own API — facts, not guesses.
 *
 * Endpoint contract (field-proven by the v8.3 site, which ran this exact flow
 * in production, and consistent with docs/library/14+17):
 *   GET  /universe/systems/            -> number[] of all system ids
 *   POST /universe/names/  [ids...]    -> [{id, name, category}] (max 1000/call)
 *   GET  /universe/systems/{id}/       -> { name, planets: [{planet_id, ...}], ... }
 *   GET  /universe/planets/{id}/       -> { name, type_id, system_id }
 *
 * The planet type map is v8's PLANET_TYPE_ID_TO_NAME (11-ui-systems.js:111),
 * verbatim. Unknown type ids REFUSE BY NAME — never guess a planet type.
 *
 * Game truth on resources (docs/library/11, UniWiki Planetary Commodities):
 * the SET of raw resources a planet carries is fully determined by its planet
 * TYPE — every planet of a type carries the same fixed list. Only the
 * densities differ, and those exist nowhere outside the in-game scan view, so
 * the importer fills the resource LIST and leaves every value for the user's
 * scans or the screenshot batch import.
 *
 * Transport is injected so the module contract-tests offline; the default in
 * the browser prefers the legacy `esiFetch` wrapper (UA + compatibility-date +
 * 429 pacing) when the skin has defined it.
 */
import type { PlanetType } from '../spec/schematics.js';

/** v8 11-ui-systems.js:111, verbatim. */
export const PLANET_TYPE_ID_TO_NAME: Readonly<Record<number, PlanetType>> = {
  2016: 'Barren', 13: 'Gas', 12: 'Ice', 2015: 'Lava',
  2014: 'Oceanic', 2063: 'Plasma', 2017: 'Storm', 11: 'Temperate',
};

export const ESI_BASE_URL = 'https://esi.evetech.net/latest';

export type EsiJson = (url: string, init?: { method?: string; body?: string }) => Promise<unknown>;

/** Browser default: reuse the skin's esiFetch (pacing + UA) when present. */
export function defaultEsiJson(): EsiJson {
  return async (url, init) => {
    const g = globalThis as { esiFetch?: (u: string, i?: object) => Promise<Response> };
    const doFetch = typeof g.esiFetch === 'function' ? g.esiFetch : fetch.bind(globalThis);
    const opts: RequestInit | undefined = init
      ? { method: init.method ?? 'GET', ...(init.body !== undefined ? { body: init.body } : {}), headers: { 'Content-Type': 'application/json' } }
      : undefined;
    const res = await doFetch(url, opts);
    if (!res.ok) throw new Error(`ESI ${url.replace(ESI_BASE_URL, '')}: HTTP ${res.status}`);
    return res.json();
  };
}

export interface SystemIndex {
  /** lowercase name -> { id, name } */
  readonly byName: ReadonlyMap<string, { id: number; name: string }>;
  readonly count: number;
}

/**
 * Load the full system-name index (one ids call + ceil(n/1000) name calls).
 * Deliberately LAZY — callers invoke this on first focus of the search field,
 * never at page load (that eager fetch was functional-audit defect #8).
 */
export async function loadSystemIndex(
  esi: EsiJson,
  onProgress?: (done: number, total: number) => void,
): Promise<SystemIndex> {
  const ids = (await esi(`${ESI_BASE_URL}/universe/systems/?datasource=tranquility`)) as number[];
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('esi-systems-empty: /universe/systems returned nothing');
  const byName = new Map<string, { id: number; name: string }>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 1000) chunks.push(ids.slice(i, i + 1000));
  let done = 0;
  for (const chunk of chunks) {
    const named = (await esi(`${ESI_BASE_URL}/universe/names/?datasource=tranquility`, {
      method: 'POST', body: JSON.stringify(chunk),
    })) as Array<{ id: number; name: string; category: string }>;
    for (const n of named) {
      if (n.category === 'solar_system') byName.set(n.name.toLowerCase(), { id: n.id, name: n.name });
    }
    done += 1;
    onProgress?.(done, chunks.length);
  }
  return { byName, count: byName.size };
}

/** Top matches for an autocomplete fragment (prefix first, then substring). */
export function searchSystems(index: SystemIndex, fragment: string, limit = 20): string[] {
  const q = fragment.trim().toLowerCase();
  if (q.length < 2) return [];
  const prefix: string[] = [];
  const inner: string[] = [];
  for (const [lower, entry] of index.byName) {
    if (lower.startsWith(q)) prefix.push(entry.name);
    else if (lower.includes(q)) inner.push(entry.name);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...inner].slice(0, limit);
}

export interface ImportedSystemPlanet {
  readonly name: string;   // e.g. "Jita IV" — ESI's own name
  readonly type: PlanetType;
}

export interface ImportedSystem {
  readonly system: string;
  readonly planets: ReadonlyArray<ImportedSystemPlanet>;
}

/**
 * Load a system's planets: names and types straight from ESI. Throws by name
 * on an unknown planet type_id rather than guessing.
 */
export async function importSystem(esi: EsiJson, systemId: number): Promise<ImportedSystem> {
  const sys = (await esi(`${ESI_BASE_URL}/universe/systems/${systemId}/?datasource=tranquility`)) as {
    name: string; planets?: Array<{ planet_id: number }>;
  };
  const planetIds = (sys.planets ?? []).map((p) => p.planet_id);
  const planets: ImportedSystemPlanet[] = [];
  // Small-batch concurrency: kind to ESI, still fast for 10-ish planets.
  for (let i = 0; i < planetIds.length; i += 4) {
    const batch = planetIds.slice(i, i + 4);
    const results = await Promise.all(batch.map(async (pid) => {
      const p = (await esi(`${ESI_BASE_URL}/universe/planets/${pid}/?datasource=tranquility`)) as {
        name: string; type_id: number;
      };
      const type = PLANET_TYPE_ID_TO_NAME[p.type_id];
      if (type === undefined) {
        throw new Error(`esi-planet-type-unknown: ${p.name} has type_id ${p.type_id} — not one of the 8 PI planet types (shattered planets cannot be colonized)`);
      }
      return { name: p.name, type };
    }));
    planets.push(...results);
  }
  planets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { system: sys.name, planets };
}
