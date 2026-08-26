/**
 * UI state: plain serializable data, persisted best-effort to localStorage
 * (wrapped in try/catch — a blocked store must never break the page).
 * The engine never sees this shape; adapters in app.ts convert it.
 */
import type { PlanetType } from '../spec/schematics.js';
import { PLANET_TYPES } from '../spec/schematics.js';
import { resourcesOf } from '../world/planets.js';

export interface UiCharacter {
  name: string;
  icLevel: number;
  ccuLevel: number;
  customsCodeLevel: number;
  accountingLevel: number;
  brokerRelationsLevel: number;
}

export interface UiResource { p0: string; w: number }

export interface UiPlanet {
  name: string;
  type: PlanetType;
  resources: UiResource[];
  /** Solar system this planet is in (screenshot imports set it; optional for manual entry). */
  system?: string;
  /** ISO capture time when the values came from a screenshot import. */
  scannedAt?: string;
}

export interface UiQuote { bid: number; ask: number; dailyVolume?: number }

export type UiMode = 'max' | 'quota' | 'qol' | 'compare';

export interface UiState {
  characters: UiCharacter[];
  planets: UiPlanet[];
  prices: Record<string, UiQuote>;
  priceNote: string; // provenance + staleness, always shown
  fees: { salesTaxPct: number; brokerPct: number; customsPct: number; hisecNpc: boolean };
  freight: { outPerM3: number; inPerM3: number };
  sellBasis: 'immediate' | 'patient';
  buyBasis: 'immediate' | 'patient';
  programHours: number;
  mode: UiMode;
  product: string;
  quotaPerWeek: number;
  qolSessions: number;
  sourcingOverrides: Record<string, 'extract' | 'refine' | 'buy'>;
}

export function defaultState(): UiState {
  return {
    characters: [{ name: 'Main', icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 }],
    planets: [{ name: 'Planet I', type: 'Storm', resources: [{ p0: 'Aqueous Liquids', w: 13000 }] }],
    prices: {},
    priceNote: 'No prices loaded yet — enter quotes below or fetch live Jita data.',
    fees: { salesTaxPct: 3.375, brokerPct: 1.5, customsPct: 10, hisecNpc: false },
    freight: { outPerM3: 400, inPerM3: 400 },
    sellBasis: 'immediate',
    buyBasis: 'immediate',
    programHours: 6,
    mode: 'max',
    product: 'Coolant',
    quotaPerWeek: 5000,
    qolSessions: 7,
    sourcingOverrides: {},
  };
}

const KEY = 'solving-pi-v9-state';

export function loadState(): UiState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return defaultState();
    const parsed = JSON.parse(raw) as Partial<UiState>;
    const base = defaultState();
    // Merge conservatively: unknown/missing fields fall back to defaults.
    const merged: UiState = { ...base, ...parsed, fees: { ...base.fees, ...parsed.fees }, freight: { ...base.freight, ...parsed.freight } };
    if (!Array.isArray(merged.characters) || merged.characters.length === 0) merged.characters = base.characters;
    if (!Array.isArray(merged.planets)) merged.planets = base.planets;
    merged.planets = merged.planets.filter((p) => (PLANET_TYPES as readonly string[]).includes(p.type));
    // Game truth: each planet carries each of its type's 5 resources at most
    // once — sanitize saves made before the UI enforced it (keep the first
    // scanned entry per resource, drop illegal-for-type entries).
    for (const p of merged.planets) {
      const legal = resourcesOf(p.type);
      const seen = new Set<string>();
      p.resources = p.resources.filter((r) => {
        if (!legal.includes(r.p0) || seen.has(r.p0)) return false;
        seen.add(r.p0);
        return true;
      });
    }
    return merged;
  } catch {
    return defaultState();
  }
}

export function saveState(s: UiState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage unavailable — the page must still work */ }
}
