/**
 * Planetary infrastructure MARKET items (owner 2026-09-03: "have the prices
 * pulled directly from the ESI"). Command Centers are the only capital
 * component that actually trades on the market — facility placement fees and
 * CC upgrade charges are FIXED game costs deducted directly on placement
 * (UniWiki Planetary Buildings), not market items, so there is no endpoint
 * that could price them; they stay as spec constants. The eight Command
 * Centers are priced live through the same ESI order-book path as every
 * commodity (best Jita 4-4 ask = what you actually pay), with the 81,000 ISK
 * NPC seed as the offline fallback.
 *
 * Type ids VERIFIED 2026-09-03 against EVE Ref market group 1322 (Planetary
 * Infrastructure → Command Centers), spot-checked per type page (2524 =
 * Barren Command Center, 2254 = Temperate Command Center).
 */
import type { PlanetType } from '../spec/schematics.js';

export const COMMAND_CENTERS: Readonly<Record<PlanetType, { readonly name: string; readonly typeId: number }>> = {
  Barren: { name: 'Barren Command Center', typeId: 2524 },
  Gas: { name: 'Gas Command Center', typeId: 2534 },
  Ice: { name: 'Ice Command Center', typeId: 2533 },
  Lava: { name: 'Lava Command Center', typeId: 2549 },
  Oceanic: { name: 'Oceanic Command Center', typeId: 2525 },
  Plasma: { name: 'Plasma Command Center', typeId: 2551 },
  Storm: { name: 'Storm Command Center', typeId: 2550 },
  Temperate: { name: 'Temperate Command Center', typeId: 2254 },
};

export const COMMAND_CENTER_NAMES: ReadonlyArray<string> = Object.values(COMMAND_CENTERS).map((c) => c.name);

export function commandCenterName(type: PlanetType): string {
  return COMMAND_CENTERS[type].name;
}

/** Minimal name→id lookup for the price service (never guesses). */
export function infraTypeIdOf(name: string): number {
  const hit = Object.values(COMMAND_CENTERS).find((c) => c.name === name);
  if (hit === undefined) throw new Error(`missing-typeid: "${name}" is not a known infrastructure item`);
  return hit.typeId;
}
