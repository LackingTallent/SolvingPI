/**
 * Production chain data: 15 P0, 15 P1, 24 P2, 21 P3, 8 P4.
 * SOURCE: UniWiki Planetary Commodities / Planetary Industry (library 11),
 * verified against the schematic cycle rules:
 *   P0→P1 basic 30 min: 3000 in → 20 out
 *   P1→P2 advanced 1 h: 40 × each of 2 inputs → 5 out
 *   P2→P3 advanced 1 h: 10 × each of 2–3 inputs → 3 out
 *   P3→P4 high-tech 1 h: 6 × each of 3 P3s → 1 out, OR 6 × each of 2 P3s + 40 × one P1 → 1 out
 *
 * REGENERATION: tools/gen-sde.ts rebuilds this file (and adds typeIDs) from the
 * official SDE (2025 JSONL) — run it in an environment with registry access.
 * Until typeIDs land, commodities are keyed by exact in-game name.
 */

import type { Tier } from './constants.js';

export type PlanetType =
  | 'Barren' | 'Gas' | 'Ice' | 'Lava' | 'Oceanic' | 'Plasma' | 'Storm' | 'Temperate';

export const PLANET_TYPES: ReadonlyArray<PlanetType> =
  ['Barren', 'Gas', 'Ice', 'Lava', 'Oceanic', 'Plasma', 'Storm', 'Temperate'];

/** P0 resources and the planet types they spawn on. SOURCE: UniWiki Planetary Commodities. */
export const P0_SPAWNS: Readonly<Record<string, ReadonlyArray<PlanetType>>> = {
  'Aqueous Liquids': ['Barren', 'Gas', 'Ice', 'Oceanic', 'Storm', 'Temperate'],
  'Autotrophs': ['Temperate'],
  'Base Metals': ['Barren', 'Gas', 'Lava', 'Plasma', 'Storm'],
  'Carbon Compounds': ['Barren', 'Oceanic', 'Temperate'],
  'Complex Organisms': ['Oceanic', 'Temperate'],
  'Felsic Magma': ['Lava'],
  'Heavy Metals': ['Ice', 'Lava', 'Plasma'],
  'Ionic Solutions': ['Gas', 'Storm'],
  'Microorganisms': ['Barren', 'Ice', 'Oceanic', 'Temperate'],
  'Noble Gas': ['Gas', 'Ice', 'Storm'],
  'Noble Metals': ['Barren', 'Plasma'],
  'Non-CS Crystals': ['Lava', 'Plasma'],
  'Planktic Colonies': ['Ice', 'Oceanic'],
  'Reactive Gas': ['Gas'],
  'Suspended Plasma': ['Lava', 'Plasma', 'Storm'],
};

/** P0 → P1 refining pairs (1:1 mapping). */
export const P1_FROM_P0: Readonly<Record<string, string>> = {
  'Aqueous Liquids': 'Water',
  'Autotrophs': 'Industrial Fibers',
  'Base Metals': 'Reactive Metals',
  'Carbon Compounds': 'Biofuels',
  'Complex Organisms': 'Proteins',
  'Felsic Magma': 'Silicon',
  'Heavy Metals': 'Toxic Metals',
  'Ionic Solutions': 'Electrolytes',
  'Microorganisms': 'Bacteria',
  'Noble Gas': 'Oxygen',
  'Noble Metals': 'Precious Metals',
  'Non-CS Crystals': 'Chiral Structures',
  'Planktic Colonies': 'Biomass',
  'Reactive Gas': 'Oxidizing Compound',
  'Suspended Plasma': 'Plasmoids',
};

/** P1 → P2 recipes: exactly two P1 inputs each. */
export const P2_RECIPES: Readonly<Record<string, ReadonlyArray<string>>> = {
  'Biocells': ['Precious Metals', 'Biofuels'],
  'Construction Blocks': ['Toxic Metals', 'Reactive Metals'],
  'Consumer Electronics': ['Chiral Structures', 'Toxic Metals'],
  'Coolant': ['Water', 'Electrolytes'],
  'Enriched Uranium': ['Toxic Metals', 'Precious Metals'],
  'Fertilizer': ['Proteins', 'Bacteria'],
  'Genetically Enhanced Livestock': ['Biomass', 'Proteins'],
  'Livestock': ['Biofuels', 'Proteins'],
  'Mechanical Parts': ['Precious Metals', 'Reactive Metals'],
  'Microfiber Shielding': ['Silicon', 'Industrial Fibers'],
  'Miniature Electronics': ['Silicon', 'Chiral Structures'],
  'Nanites': ['Reactive Metals', 'Bacteria'],
  'Oxides': ['Oxygen', 'Oxidizing Compound'],
  'Polyaramids': ['Industrial Fibers', 'Oxidizing Compound'],
  'Polytextiles': ['Industrial Fibers', 'Biofuels'],
  'Rocket Fuel': ['Electrolytes', 'Plasmoids'],
  'Silicate Glass': ['Silicon', 'Oxidizing Compound'],
  'Superconductors': ['Water', 'Plasmoids'],
  'Supertensile Plastics': ['Biomass', 'Oxygen'],
  'Synthetic Oil': ['Oxygen', 'Electrolytes'],
  'Test Cultures': ['Water', 'Bacteria'],
  'Transmitter': ['Chiral Structures', 'Plasmoids'],
  'Viral Agent': ['Biomass', 'Bacteria'],
  'Water-Cooled CPU': ['Water', 'Reactive Metals'],
};

/** P2 → P3 recipes: two or three P2 inputs each. */
export const P3_RECIPES: Readonly<Record<string, ReadonlyArray<string>>> = {
  'Biotech Research Reports': ['Nanites', 'Livestock', 'Construction Blocks'],
  'Camera Drones': ['Silicate Glass', 'Rocket Fuel'],
  'Condensates': ['Oxides', 'Coolant'],
  'Cryoprotectant Solution': ['Test Cultures', 'Synthetic Oil', 'Fertilizer'],
  'Data Chips': ['Supertensile Plastics', 'Microfiber Shielding'],
  'Gel-Matrix Biopaste': ['Oxides', 'Biocells', 'Superconductors'],
  'Guidance Systems': ['Water-Cooled CPU', 'Transmitter'],
  'Hazmat Detection Systems': ['Polytextiles', 'Viral Agent', 'Transmitter'],
  'Hermetic Membranes': ['Polyaramids', 'Genetically Enhanced Livestock'],
  'High-Tech Transmitters': ['Polyaramids', 'Transmitter'],
  'Industrial Explosives': ['Fertilizer', 'Polytextiles'],
  'Neocoms': ['Biocells', 'Silicate Glass'],
  'Nuclear Reactors': ['Microfiber Shielding', 'Enriched Uranium'],
  'Planetary Vehicles': ['Supertensile Plastics', 'Mechanical Parts', 'Miniature Electronics'],
  'Robotics': ['Mechanical Parts', 'Consumer Electronics'],
  'Smartfab Units': ['Construction Blocks', 'Miniature Electronics'],
  'Supercomputers': ['Water-Cooled CPU', 'Coolant', 'Consumer Electronics'],
  'Synthetic Synapses': ['Supertensile Plastics', 'Test Cultures'],
  'Transcranial Microcontrollers': ['Biocells', 'Nanites'],
  'Ukomi Superconductors': ['Synthetic Oil', 'Superconductors'],
  'Vaccines': ['Livestock', 'Viral Agent'],
};

/** P3 → P4 recipes: three P3 inputs @6, or two P3 @6 plus one P1 @40. */
export const P4_RECIPES: Readonly<Record<string, { p3: ReadonlyArray<string>; p1?: string }>> = {
  'Broadcast Node': { p3: ['Neocoms', 'Data Chips', 'High-Tech Transmitters'] },
  'Integrity Response Drones': { p3: ['Gel-Matrix Biopaste', 'Hazmat Detection Systems', 'Planetary Vehicles'] },
  'Nano-Factory': { p3: ['Industrial Explosives', 'Ukomi Superconductors'], p1: 'Reactive Metals' },
  'Organic Mortar Applicators': { p3: ['Condensates', 'Robotics'], p1: 'Bacteria' },
  'Recursive Computing Module': { p3: ['Synthetic Synapses', 'Guidance Systems', 'Transcranial Microcontrollers'] },
  'Self-Harmonizing Power Core': { p3: ['Camera Drones', 'Nuclear Reactors', 'Hermetic Membranes'] },
  'Sterile Conduits': { p3: ['Smartfab Units', 'Vaccines'], p1: 'Water' },
  'Wetware Mainframe': { p3: ['Supercomputers', 'Biotech Research Reports', 'Cryoprotectant Solution'] },
};

// ---------------------------------------------------------------------------
// Uniform schematic view — one shape for every tier, derived from the tables
// above so the recipe data exists in exactly one place.
// ---------------------------------------------------------------------------

export interface Schematic {
  readonly output: string;
  readonly tier: Tier;
  readonly outQty: number;
  readonly cycleSeconds: number;
  readonly facility: 'basic' | 'advanced' | 'hightech';
  /** input commodity name -> units consumed per cycle */
  readonly inputs: Readonly<Record<string, number>>;
}

function buildSchematics(): ReadonlyMap<string, Schematic> {
  const m = new Map<string, Schematic>();
  for (const [p0, p1] of Object.entries(P1_FROM_P0)) {
    m.set(p1, { output: p1, tier: 1, outQty: 20, cycleSeconds: 1800, facility: 'basic', inputs: { [p0]: 3000 } });
  }
  for (const [p2, ins] of Object.entries(P2_RECIPES)) {
    m.set(p2, {
      output: p2, tier: 2, outQty: 5, cycleSeconds: 3600, facility: 'advanced',
      inputs: Object.fromEntries(ins.map((i) => [i, 40])),
    });
  }
  for (const [p3, ins] of Object.entries(P3_RECIPES)) {
    m.set(p3, {
      output: p3, tier: 3, outQty: 3, cycleSeconds: 3600, facility: 'advanced',
      inputs: Object.fromEntries(ins.map((i) => [i, 10])),
    });
  }
  for (const [p4, r] of Object.entries(P4_RECIPES)) {
    const inputs: Record<string, number> = Object.fromEntries(r.p3.map((i) => [i, 6]));
    if (r.p1 !== undefined) inputs[r.p1] = 40;
    m.set(p4, { output: p4, tier: 4, outQty: 1, cycleSeconds: 3600, facility: 'hightech', inputs });
  }
  return m;
}

export const SCHEMATICS: ReadonlyMap<string, Schematic> = buildSchematics();

/** Commodity -> tier, for every commodity in the chain (P0 included). */
export function tierOf(name: string): Tier {
  if (name in P0_SPAWNS) return 0;
  const s = SCHEMATICS.get(name);
  if (s === undefined) throw new Error(`Unknown commodity: "${name}"`);
  return s.tier;
}

/** All commodity names at a tier. */
export function commoditiesAtTier(tier: Tier): ReadonlyArray<string> {
  if (tier === 0) return Object.keys(P0_SPAWNS);
  return [...SCHEMATICS.values()].filter((s) => s.tier === tier).map((s) => s.output);
}
