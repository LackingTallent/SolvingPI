/**
 * ESI colony importer: turns /characters/{id}/planets/ responses into the
 * engine's world — REAL qty_per_cycle values (w) from installed extractors,
 * planet types, CC upgrade levels, and facility counts. This is the
 * locked-decision path that lets a live operation seed the raw-unit density
 * model without typing a single scan value.
 *
 * Everything is mapped through the id registry; unknown ids refuse by name.
 * The importer never guesses: pins it cannot classify are reported, not
 * dropped (v8's costliest bug class was silent drops at handoffs).
 */
import type { IdRegistry } from './ids.js';
import type { PlanetType } from '../spec/schematics.js';

/** ESI /characters/{character_id}/planets/ entry. */
export interface EsiPlanetSummary {
  readonly planet_id: number;
  readonly planet_type: string; // 'barren' | 'temperate' | ... (lowercase)
  readonly solar_system_id: number;
  readonly num_pins: number;
  readonly upgrade_level: number;
  readonly last_update: string;
}

/** ESI /characters/{character_id}/planets/{planet_id}/ shape (subset used). */
export interface EsiPlanetDetail {
  readonly pins: ReadonlyArray<{
    readonly pin_id: number;
    readonly type_id: number;
    readonly schematic_id?: number;
    readonly expiry_time?: string;
    readonly install_time?: string;
    readonly extractor_details?: {
      readonly cycle_time: number; // seconds
      readonly qty_per_cycle: number; // THE raw w
      readonly product_type_id: number;
      readonly heads: ReadonlyArray<{ readonly head_id: number; readonly latitude: number; readonly longitude: number }>;
    };
  }>;
  readonly routes: ReadonlyArray<{
    readonly source_pin_id: number;
    readonly destination_pin_id: number;
    readonly content_type_id: number;
    readonly quantity: number;
  }>;
}

const PLANET_TYPE_MAP: Readonly<Record<string, PlanetType>> = {
  barren: 'Barren', gas: 'Gas', ice: 'Ice', lava: 'Lava',
  oceanic: 'Oceanic', plasma: 'Plasma', storm: 'Storm', temperate: 'Temperate',
};

export interface ImportedExtractor {
  readonly resource: string;       // P0 name
  readonly w: number;              // qty_per_cycle from the live program
  readonly cycleSeconds: number;
  readonly heads: number;
  readonly expiry: string | null;  // when the program runs out
}

export interface ImportedColony {
  readonly characterName: string;
  readonly planetId: number;
  readonly planetType: PlanetType;
  readonly solarSystemId: number;
  readonly ccLevel: number;
  readonly lastUpdate: string;
  readonly extractors: ReadonlyArray<ImportedExtractor>;
  /** Facility counts by kind (from pin classification). */
  readonly facilities: Readonly<Record<string, number>>;
  /** Schematics installed, by output commodity name -> facility count. */
  readonly production: Readonly<Record<string, number>>;
  /** Pins the registry could not classify — surfaced, never dropped. */
  readonly unclassified: ReadonlyArray<{ pinId: number; typeId: number; reason: string }>;
}

export function importColony(
  characterName: string,
  summary: EsiPlanetSummary,
  detail: EsiPlanetDetail,
  ids: IdRegistry,
): ImportedColony {
  const planetType = PLANET_TYPE_MAP[summary.planet_type];
  if (planetType === undefined) throw new Error(`import-planet-type-unknown: "${summary.planet_type}"`);
  if (!Number.isInteger(summary.upgrade_level) || summary.upgrade_level < 0 || summary.upgrade_level > 5)
    throw new Error(`import-cc-level-invalid: ${summary.upgrade_level}`);

  const extractors: ImportedExtractor[] = [];
  const facilities: Record<string, number> = {};
  const production: Record<string, number> = {};
  const unclassified: Array<{ pinId: number; typeId: number; reason: string }> = [];

  for (const pin of detail.pins) {
    if (pin.extractor_details !== undefined) {
      const d = pin.extractor_details;
      let resource: string;
      try {
        resource = ids.nameOf(d.product_type_id);
      } catch (e) {
        unclassified.push({ pinId: pin.pin_id, typeId: d.product_type_id, reason: (e as Error).message });
        continue;
      }
      // An ECU with no live program has no qty; only import running programs.
      if (d.qty_per_cycle > 0) {
        extractors.push({
          resource,
          w: d.qty_per_cycle,
          cycleSeconds: d.cycle_time,
          heads: d.heads.length,
          expiry: pin.expiry_time ?? null,
        });
      }
      facilities['ecu'] = (facilities['ecu'] ?? 0) + 1;
      continue;
    }
    let kind: string;
    try {
      kind = ids.pinKind(pin.type_id);
    } catch (e) {
      unclassified.push({ pinId: pin.pin_id, typeId: pin.type_id, reason: (e as Error).message });
      continue;
    }
    facilities[kind] = (facilities[kind] ?? 0) + 1;
    if (pin.schematic_id !== undefined) {
      const output = ids.schematicName(pin.schematic_id); // throws by name if unknown
      production[output] = (production[output] ?? 0) + 1;
    }
  }

  return {
    characterName,
    planetId: summary.planet_id,
    planetType,
    solarSystemId: summary.solar_system_id,
    ccLevel: summary.upgrade_level,
    lastUpdate: summary.last_update,
    extractors,
    facilities,
    production,
    unclassified,
  };
}

/**
 * Seed the solver world's planet list from imported colonies: each planet
 * contributes its OBSERVED w per resource (the live program's qty_per_cycle),
 * with `observedAt` carried for the density-history feature.
 */
export interface ObservedDensity {
  readonly planetId: number;
  readonly planetType: PlanetType;
  readonly resource: string;
  readonly w: number;
  readonly observedAt: string;
  readonly source: 'esi-import';
}

export function observedDensities(colonies: ReadonlyArray<ImportedColony>): ObservedDensity[] {
  const out: ObservedDensity[] = [];
  for (const c of colonies) {
    for (const e of c.extractors) {
      out.push({
        planetId: c.planetId, planetType: c.planetType, resource: e.resource,
        w: e.w, observedAt: c.lastUpdate, source: 'esi-import',
      });
    }
  }
  return out;
}
