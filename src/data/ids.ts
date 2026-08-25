/**
 * TypeID registry: name ↔ EVE typeID, pin-type classification, schematic ids.
 * The GENERATED file is produced by `node tools/gen-sde.mjs` from official
 * sources (ESI /universe/ids + Fuzzwork SDE mirrors) in an environment with
 * network access. Until fully generated it is PARTIAL, and every lookup of a
 * missing entry REFUSES BY NAME — the engine never invents an id.
 */
import { GENERATED, type GeneratedIds } from './generated-ids.js';
import type { FacilityKind } from '../spec/constants.js';

export interface IdRegistry {
  typeIdOf(commodityName: string): number;
  nameOf(typeId: number): string;
  schematicName(schematicId: number): string;
  pinKind(pinTypeId: number): FacilityKind;
  readonly meta: GeneratedIds['meta'];
}

export function idRegistry(data: GeneratedIds = GENERATED): IdRegistry {
  const byName = new Map(Object.entries(data.commodities));
  const byId = new Map([...byName].map(([n, id]) => [id, n]));
  const schem = new Map(Object.entries(data.schematics).map(([k, v]) => [Number(k), v]));
  const pins = new Map(Object.entries(data.pinKinds).map(([k, v]) => [Number(k), v]));
  return {
    typeIdOf(name) {
      const id = byName.get(name);
      if (id === undefined)
        throw new Error(`missing-typeid: "${name}" not in the generated registry (${data.meta.status}) — run tools/gen-sde.mjs`);
      return id;
    },
    nameOf(typeId) {
      const n = byId.get(typeId);
      if (n === undefined) throw new Error(`missing-typeid-name: ${typeId} not in the generated registry — run tools/gen-sde.mjs`);
      return n;
    },
    schematicName(schematicId) {
      const n = schem.get(schematicId);
      if (n === undefined) throw new Error(`missing-schematic-id: ${schematicId} not in the generated registry — run tools/gen-sde.mjs`);
      return n;
    },
    pinKind(pinTypeId) {
      const k = pins.get(pinTypeId);
      if (k === undefined) throw new Error(`missing-pin-type: ${pinTypeId} not in the generated registry — run tools/gen-sde.mjs`);
      return k;
    },
    meta: data.meta,
  };
}
