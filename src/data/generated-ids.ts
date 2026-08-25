/**
 * GENERATED FILE (currently PARTIAL — regenerate with `node tools/gen-sde.mjs`).
 *
 * The four commodity ids below were independently verified against the live
 * SDE via EVE Ref during library research (docs/library/11):
 *   Aqueous Liquids 2268, Water 3645, Coolant 9832, Broadcast Node 2867.
 * Everything else must come from the generator; lookups of missing entries
 * refuse by name (src/data/ids.ts).
 */
import type { FacilityKind } from '../spec/constants.js';

export interface GeneratedIds {
  readonly meta: {
    readonly status: 'partial' | 'generated';
    readonly generatedAt: string | null;
    readonly source: string;
  };
  /** commodity name -> typeID */
  readonly commodities: Readonly<Record<string, number>>;
  /** schematic_id -> output commodity name */
  readonly schematics: Readonly<Record<string, string>>;
  /** pin type_id -> facility kind */
  readonly pinKinds: Readonly<Record<string, FacilityKind>>;
}

export const GENERATED: GeneratedIds = {
  meta: {
    status: 'partial',
    generatedAt: null,
    source: 'EVE Ref spot-verification (library 11); full set pending tools/gen-sde.mjs',
  },
  commodities: {
    'Aqueous Liquids': 2268,
    'Water': 3645,
    'Coolant': 9832,
    'Broadcast Node': 2867,
  },
  schematics: {},
  pinKinds: {},
};
