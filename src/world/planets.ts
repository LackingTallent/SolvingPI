/**
 * Planet legality facts. Pure functions over spec data.
 */
import { P0_SPAWNS, PLANET_TYPES, type PlanetType } from '../spec/schematics.js';

export type { PlanetType };
export { PLANET_TYPES };

export function isPlanetType(s: string): s is PlanetType {
  return (PLANET_TYPES as ReadonlyArray<string>).includes(s);
}

/** Can this P0 be extracted on this planet type? */
export function spawnsOn(p0: string, planet: PlanetType): boolean {
  const spawns = P0_SPAWNS[p0];
  if (spawns === undefined) throw new Error(`Unknown P0 resource: "${p0}"`);
  return spawns.includes(planet);
}

/** High-Tech Production Plants are legal ONLY on Barren and Temperate. SOURCE: UniWiki. */
export function canBuildHighTech(planet: PlanetType): boolean {
  return planet === 'Barren' || planet === 'Temperate';
}

/** P0 resources available on a given planet type. */
export function resourcesOf(planet: PlanetType): ReadonlyArray<string> {
  return Object.entries(P0_SPAWNS)
    .filter(([, planets]) => planets.includes(planet))
    .map(([p0]) => p0);
}
