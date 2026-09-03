/**
 * Universe map for the Region Scout: regions → systems → planets (name +
 * type) + security. Two sources, same shape:
 *
 *   1. BAKED (preferred): static/map/universe-map.json, generated offline by
 *      tools/gen-map.mjs from CCP's SDE (Fuzzwork mirror) — instant, zero API
 *      traffic, and map data changes essentially never.
 *   2. LIVE CRAWL (fallback): the public ESI universe endpoints, one region
 *      at a time, cached in localStorage — for a deploy whose baked file is
 *      missing or stale. Hundreds of calls per region, so progress is
 *      reported and results are kept.
 *
 * Activity overlay: ESI /universe/system_kills/ + /universe/system_jumps/ —
 * public, hourly, whole universe in two calls. Cached for an hour. Shown as
 * its own column, never blended into ISK numbers.
 *
 * Facts, not guesses: unknown planet type ids are skipped WITH A COUNT the
 * UI can disclose; nothing is invented.
 */
import type { PlanetType } from '../spec/schematics.js';
import { ESI_BASE_URL, PLANET_TYPE_ID_TO_NAME, type EsiJson } from '../ui/esi-universe.js';

export interface MapPlanet { readonly name: string; readonly type: PlanetType }
export interface MapSystem {
  readonly id: number;
  readonly name: string;
  readonly security: number;
  readonly planets: ReadonlyArray<MapPlanet>;
}
export interface MapRegion { readonly id: number; readonly name: string }

export interface UniverseMap {
  readonly version: number;
  readonly generatedAt: string;
  readonly regions: ReadonlyArray<MapRegion & { readonly systems: ReadonlyArray<MapSystem> }>;
}

/** J-space (wormhole) regions occupy exactly the 11xxxxxx region-id block in
 * CCP's map data; known space is 10xxxxxx and Abyssal sits at 12xxxxxx+. The
 * only band call the scout needs from the region id is "is this J-space". */
export const isWormholeRegionId = (regionId: number): boolean => regionId >= 11000000 && regionId < 12000000;

// ---------------------------------------------------------------------------
// Baked map
// ---------------------------------------------------------------------------

/** Load the baked map if this deploy ships one; null when absent. */
export async function loadBakedMap(
  fetchJson: (url: string) => Promise<unknown>,
): Promise<UniverseMap | null> {
  try {
    const raw = (await fetchJson('map/universe-map.json')) as UniverseMap;
    if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.regions)) return null;
    return raw;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Live ESI fallback
// ---------------------------------------------------------------------------

/** All regions, named. One ids call + ceil(n/1000) name calls. */
export async function loadRegionList(esi: EsiJson): Promise<MapRegion[]> {
  const ids = (await esi(`${ESI_BASE_URL}/universe/regions/?datasource=tranquility`)) as number[];
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('esi-regions-empty: /universe/regions returned nothing');
  const out: MapRegion[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const named = (await esi(`${ESI_BASE_URL}/universe/names/?datasource=tranquility`, {
      method: 'POST', body: JSON.stringify(ids.slice(i, i + 1000)),
    })) as Array<{ id: number; name: string; category: string }>;
    for (const n of named) if (n.category === 'region') out.push({ id: n.id, name: n.name });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export interface CrawlResult {
  readonly systems: MapSystem[];
  /** Planets whose type id the registry does not know (disclosed, not guessed). */
  readonly skippedPlanets: number;
}

/**
 * Crawl one region live from ESI: region → constellations → systems →
 * planets. onProgress reports (done, total) over SYSTEM detail calls so the
 * UI can show honest progress on the slow part.
 */
export async function crawlRegion(
  esi: EsiJson,
  regionId: number,
  onProgress?: (done: number, total: number) => void,
): Promise<CrawlResult> {
  const region = (await esi(`${ESI_BASE_URL}/universe/regions/${regionId}/?datasource=tranquility`)) as { constellations: number[] };
  if (!Array.isArray(region.constellations)) throw new Error(`esi-region-bad: region ${regionId} has no constellation list`);
  const systemIds: number[] = [];
  for (const cid of region.constellations) {
    const c = (await esi(`${ESI_BASE_URL}/universe/constellations/${cid}/?datasource=tranquility`)) as { systems: number[] };
    if (Array.isArray(c.systems)) systemIds.push(...c.systems);
  }
  const systems: MapSystem[] = [];
  let skippedPlanets = 0;
  let done = 0;
  for (const sid of systemIds) {
    const s = (await esi(`${ESI_BASE_URL}/universe/systems/${sid}/?datasource=tranquility`)) as {
      name: string; security_status: number; planets?: Array<{ planet_id: number }>;
    };
    const planets: MapPlanet[] = [];
    for (const p of s.planets ?? []) {
      const pd = (await esi(`${ESI_BASE_URL}/universe/planets/${p.planet_id}/?datasource=tranquility`)) as { name: string; type_id: number };
      const type = PLANET_TYPE_ID_TO_NAME[pd.type_id];
      if (type === undefined) { skippedPlanets++; continue; }
      planets.push({ name: pd.name, type });
    }
    systems.push({ id: sid, name: s.name, security: s.security_status, planets });
    done++;
    onProgress?.(done, systemIds.length);
  }
  return { systems, skippedPlanets };
}

// ---------------------------------------------------------------------------
// Activity overlay (public, hourly)
// ---------------------------------------------------------------------------

export interface SystemActivity {
  readonly shipKills: number;
  readonly podKills: number;
  readonly npcKills: number;
  readonly jumps: number;
}

/** Kills + jumps for the whole universe in two calls. Quiet systems are
 * ABSENT from both feeds — absence means zero, and that IS the good news. */
export async function loadActivity(esi: EsiJson): Promise<ReadonlyMap<number, SystemActivity>> {
  const [kills, jumps] = await Promise.all([
    esi(`${ESI_BASE_URL}/universe/system_kills/?datasource=tranquility`) as Promise<Array<{ system_id: number; ship_kills: number; pod_kills: number; npc_kills: number }>>,
    esi(`${ESI_BASE_URL}/universe/system_jumps/?datasource=tranquility`) as Promise<Array<{ system_id: number; ship_jumps: number }>>,
  ]);
  const m = new Map<number, { shipKills: number; podKills: number; npcKills: number; jumps: number }>();
  const at = (id: number) => {
    let e = m.get(id);
    if (e === undefined) { e = { shipKills: 0, podKills: 0, npcKills: 0, jumps: 0 }; m.set(id, e); }
    return e;
  };
  if (Array.isArray(kills)) for (const k of kills) { const e = at(k.system_id); e.shipKills = k.ship_kills; e.podKills = k.pod_kills; e.npcKills = k.npc_kills; }
  if (Array.isArray(jumps)) for (const j of jumps) { at(j.system_id).jumps = j.ship_jumps; }
  return m;
}

/** Plain-words traffic verdict for a row — a BADGE beside the ISK number,
 * never mixed into it. */
export function activityBadge(a: SystemActivity | undefined): { label: string; tone: 'quiet' | 'busy' | 'hot' } {
  const playerKills = (a?.shipKills ?? 0) + (a?.podKills ?? 0);
  const jumps = a?.jumps ?? 0;
  if (playerKills === 0 && jumps <= 30) return { label: 'quiet', tone: 'quiet' };
  if (playerKills <= 2) return { label: `${jumps} jumps/hr`, tone: 'busy' };
  return { label: `${playerKills} kills/hr`, tone: 'hot' };
}
