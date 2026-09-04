/**
 * UI state: plain serializable data, persisted best-effort to localStorage
 * (wrapped in try/catch — a blocked store must never break the page).
 * The engine never sees this shape; adapters in app.ts convert it.
 */
import type { PlanetType } from '../spec/schematics.js';
import { PLANET_TYPES } from '../spec/schematics.js';
import { resourcesOf } from '../world/planets.js';
import { QUICK_DENSITY_PCT, SPACE_BANDS, type SpaceBand } from './presets.js';
import { wFromDensityPct } from '../world/density.js';
import { chainIntermediates, p1InputsOf } from '../engine/chain.js';

export interface UiCharacter {
  name: string;
  icLevel: number;
  ccuLevel: number;
  customsCodeLevel: number;
  accountingLevel: number;
  brokerRelationsLevel: number;
}

export interface UiResource {
  p0: string;
  w: number;
  /** True while the density is a default/band ASSUMPTION, not the user's own
   * scan (owner 2026-09-03): the "Where do you operate?" tap re-bands every
   * assumed resource; typing a density clears the flag. */
  assumed?: boolean;
}

export interface UiPlanet {
  name: string;
  type: PlanetType;
  resources: UiResource[];
  /** Completion checkbox: a checked planet renders minimized. Planets load
   * minimized by default except the first. */
  minimized?: boolean;
  /** Solar system this planet is in (screenshot imports set it; optional for manual entry). */
  system?: string;
  /** ISO capture time when the values came from a screenshot import. */
  scannedAt?: string;
}

/** bids/asks: top-of-book depth levels (T-09) — fetched with every live quote,
 * persisted with it (~100KB for a full set, well inside localStorage), and
 * declared here so the type tells the truth about what the state carries. */
export interface UiQuote {
  bid: number;
  ask: number;
  dailyVolume?: number;
  bids?: ReadonlyArray<{ readonly price: number; readonly qty: number }>;
  asks?: ReadonlyArray<{ readonly price: number; readonly qty: number }>;
}

export type UiMode = 'max' | 'quota' | 'qol' | 'compare' | 'profit';

/** Accuracy ladder: quick (typical-value stand-ins, instant numbers) →
 * refined (your scans, preset costs allowed) → exact (everything yours). */
export type DetailLevel = 'quick' | 'refined' | 'exact';

/** Where the current fee/freight numbers came from — decides whether results
 * are labeled estimates and whether the Exact rung is satisfied. */
export type CostsSource = 'default' | `preset-${SpaceBand}` | 'user';

export interface UiState {
  characters: UiCharacter[];
  /** Owner spec 2026-09-01: section 2 starts EMPTY and earns its check mark
   * only when the user presses “Done adding characters” (reversible). */
  charactersDone: boolean;
  /** Streamline batch (owner 2026-09-02): Simple hides every power control;
   * Advanced shows them all. */
  advancedMode: boolean;
  /** True (default): the accuracy level is INFERRED from the data present —
   * the "How exact?" question only exists in Advanced. */
  autoDetail: boolean;
  planets: UiPlanet[];
  /** Contested-deposit haircut % per extra colony on the same (planet,
   * resource) deposit (truth audit T-08, owner approved 2026-09-03).
   * Default 10; 0 restores the old optimistic no-interference model. */
  stackPenaltyPct: number;
  prices: Record<string, UiQuote>;
  /** Live infrastructure quotes (the 8 Command Centers) — fetched with every
   * price refresh, used ONLY by the setup-capital card (owner 2026-09-03:
   * CC prices pulled from ESI, 81k NPC seed as fallback). Kept apart from
   * `prices` so commodity-only code paths (tierOf labels, chains, sourcing)
   * never meet a non-commodity name. */
  infraPrices: Record<string, UiQuote>;
  priceNote: string; // provenance + staleness, always shown
  fees: { salesTaxPct: number; brokerPct: number; customsPct: number; hisecNpc: boolean };
  freight: { outPerM3: number; inPerM3: number };
  sellBasis: 'immediate' | 'patient';
  buyBasis: 'immediate' | 'patient';
  programHours: number;
  mode: UiMode;
  /** Sourcing/detail controls stay hidden until the user has picked a goal. */
  modeChosen: boolean;
  detailLevel: DetailLevel;
  /** Security band driving Quick-estimate densities (and the cost prefill offer). */
  spaceBand: SpaceBand | null;
  costsSource: CostsSource;
  product: string;
  quotaPerWeek: number;
  qolSessions: number;
  /** Explicit per-input pins; an absent key means "Suggested (auto)".
   * P1 inputs: extract | refine | buy. Intermediates (P2/P3): make | buy —
   * 'buy' cuts the chain there (owner spec: buy P3s, make the P4). */
  sourcingOverrides: Record<string, 'extract' | 'refine' | 'buy' | 'make'>;
  /** Product mix (owner spec 2026-08-31): two or more products with relative
   * percentage shares. Active in max/quota/qol when it has >= 2 entries; the
   * solver optimizes the blend at that ratio. Empty = single-product mode. */
  mix: Array<{ product: string; pct: number }>;
}

/** New planets carry NO density until the user defines their type of space
 * (owner 2026-09-03, replacing the old blanket 70% default — "the type of
 * space means a lot"): band already chosen → the band's typical, marked
 * assumed (~); no band yet → 0, chips show "?", and the solve gate demands
 * the band (or real scans) before anything computes. */
export function defaultResources(type: PlanetType, band: SpaceBand | null): UiResource[] {
  const w = band === null ? 0 : Math.round(wFromDensityPct(QUICK_DENSITY_PCT[band]) * 10) / 10;
  return resourcesOf(type).map((p0) => ({ p0, w, assumed: true }));
}

/** Owner default: every input starts on extract ("mine it"); Suggested and
 * the other modes remain one click away under Adjust sourcing. */
export function extractDefaults(product: string): Record<string, 'extract' | 'refine' | 'buy' | 'make'> {
  try {
    return {
      ...Object.fromEntries(p1InputsOf(product).map((p1) => [p1, 'extract' as const])),
      // Intermediates default to made-in-house — same mine-it philosophy;
      // "buy finished" (chain cut) is one dropdown away, and Suggested/
      // Maximize-profits explore it automatically when unpinned.
      ...Object.fromEntries(chainIntermediates(product).map((i) => [i, 'make' as const])),
    };
  } catch {
    return {};
  }
}

export function defaultState(): UiState {
  return {
    // Owner spec 2026-09-01: ZERO starter characters — the user adds their
    // own and presses “Done adding characters” to complete the section.
    characters: [],
    charactersDone: false,
    advancedMode: false,
    autoDetail: true,
    // Owner decision (2026-08-28, reversing the earlier starter trio): a
    // fresh visit starts with ZERO planets — the user adds their own, and
    // the solve gate names the step ("Add at least one planet, section 3").
    planets: [],
    stackPenaltyPct: 10,
    prices: {},
    infraPrices: {},
    priceNote: 'No prices loaded yet — enter quotes below or fetch live Jita data.',
    fees: { salesTaxPct: 3.375, brokerPct: 1.5, customsPct: 10, hisecNpc: false },
    freight: { outPerM3: 400, inPerM3: 400 },
    sellBasis: 'immediate',
    buyBasis: 'immediate',
    programHours: 6,
    // Owner 2026-09-02 (reversing the pre-selected Compare): NOTHING is
    // checked until the user selects a goal themselves.
    mode: 'compare',
    modeChosen: false,
    detailLevel: 'quick',
    spaceBand: null,
    costsSource: 'default',
    product: 'Coolant',
    quotaPerWeek: 5000,
    qolSessions: 7,
    sourcingOverrides: extractDefaults('Coolant'),
    mix: [],
  };
}

const KEY = 'solving-pi-v9-state';

/** Sanitize any externally-sourced partial state (localStorage OR a loaded
 * save file — both funnels MUST share this; the file path once skipped it and
 * accepted garbage wholesale, an edge-suite finding). */
export function sanitizeState(parsed: Partial<UiState>): UiState {
  const base = defaultState();
    // Merge conservatively: unknown/missing fields fall back to defaults.
    const merged: UiState = { ...base, ...parsed, fees: { ...base.fees, ...parsed.fees }, freight: { ...base.freight, ...parsed.freight } };
    if (!Array.isArray(merged.characters)) merged.characters = base.characters;
    // Migration: saves from before the flag existed count as done when they
    // already carry characters. (Check the RAW input — the base default would
    // otherwise mask a missing field as false.)
    if (typeof parsed.charactersDone !== 'boolean') merged.charactersDone = merged.characters.length > 0;
    if (typeof parsed.advancedMode !== 'boolean') merged.advancedMode = false;
    if (typeof parsed.autoDetail !== 'boolean') merged.autoDetail = true;
    if (merged.characters.length === 0) merged.charactersDone = false;
    if (!Array.isArray(merged.planets)) merged.planets = base.planets;
    if (typeof parsed.stackPenaltyPct !== 'number' || !Number.isFinite(merged.stackPenaltyPct) || merged.stackPenaltyPct < 0 || merged.stackPenaltyPct > 90) merged.stackPenaltyPct = 10;
    if (!['max', 'quota', 'qol', 'compare', 'profit'].includes(merged.mode)) merged.mode = base.mode;
    if (!['quick', 'refined', 'exact'].includes(merged.detailLevel)) merged.detailLevel = base.detailLevel;
    for (const [k, v] of Object.entries(merged.sourcingOverrides ?? {})) {
      if (!['extract', 'refine', 'buy', 'make'].includes(v)) delete merged.sourcingOverrides[k];
    }
    if (merged.spaceBand !== null && !(SPACE_BANDS as readonly string[]).includes(merged.spaceBand)) merged.spaceBand = null;
    if (!Array.isArray(merged.mix)) merged.mix = [];
    const seenMix = new Set<string>();
    merged.mix = merged.mix.filter((e) => {
      if (!e || typeof e.product !== 'string' || !Number.isFinite(e.pct) || e.pct <= 0) return false;
      if (seenMix.has(e.product)) return false;
      seenMix.add(e.product);
      return true;
    }).slice(0, 6);
    if (merged.mix.length === 1) merged.mix = []; // a one-line mix is just a product
    if (merged.mix.length >= 2) {
      // Owner spec: shares always total EXACTLY 100.
      for (const e of merged.mix) e.pct = Math.max(1, Math.round(e.pct));
      const total = merged.mix.reduce((a, e) => a + e.pct, 0);
      let acc = 0;
      merged.mix.forEach((e, i) => {
        e.pct = i === merged.mix.length - 1
          ? Math.max(1, 100 - acc)
          : Math.max(1, Math.round((e.pct / total) * 100));
        acc += e.pct;
      });
      const t2 = merged.mix.reduce((a, e) => a + e.pct, 0);
      if (t2 !== 100) merged.mix[0]!.pct = Math.max(1, merged.mix[0]!.pct + (100 - t2));
    }
    if (typeof merged.modeChosen !== 'boolean') merged.modeChosen = false;
    if (merged.costsSource !== 'default' && merged.costsSource !== 'user'
      && !SPACE_BANDS.some((b) => merged.costsSource === `preset-${b}`)) merged.costsSource = base.costsSource;
    merged.planets = merged.planets.filter((p) => p && (PLANET_TYPES as readonly string[]).includes(p.type));
    for (const p of merged.planets) { if (!Array.isArray(p.resources)) p.resources = []; }
    // Game truth: each planet carries each of its type's 5 resources at most
    // once — sanitize saves made before the UI enforced it (keep the first
    // scanned entry per resource, drop illegal-for-type entries).
    // Planets load minimized except the first (older saves lack the flag).
    merged.planets.forEach((p, i) => {
      if (typeof p.minimized !== 'boolean') p.minimized = i > 0;
    });
    for (const p of merged.planets) {
      const legal = resourcesOf(p.type);
      const seen = new Set<string>();
      p.resources = p.resources.filter((r) => {
        if (!legal.includes(r.p0) || seen.has(r.p0)) return false;
        seen.add(r.p0);
        return true;
      });
    }
    // Round-4 audit: order-book depth from a hand-edited or corrupted save
    // used to reach walkBook unvalidated (a STRING iterated as levels →
    // NaN net; a number → "not iterable"). Depth must be an array of finite
    // positive {price, qty} in the right order (bids descending, asks
    // ascending) or it is dropped — the quote's bid/ask still stand.
    if (merged.prices === null || typeof merged.prices !== 'object' || Array.isArray(merged.prices)) merged.prices = {};
    const depthOk = (levels: unknown, ascending: boolean): levels is Array<{ price: number; qty: number }> => {
      if (!Array.isArray(levels) || levels.length === 0 || levels.length > 50) return false;
      let prev = ascending ? 0 : Infinity;
      for (const l of levels) {
        if (l === null || typeof l !== 'object') return false;
        const { price, qty } = l as { price?: unknown; qty?: unknown };
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return false;
        if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) return false;
        if (ascending ? price < prev : price > prev) return false;
        prev = price;
      }
      return true;
    };
    const sanitizeQuotes = (book: Record<string, UiQuote>): void => {
      for (const [name, q] of Object.entries(book)) {
        if (q === null || typeof q !== 'object' || typeof (q as UiQuote).bid !== 'number' || typeof (q as UiQuote).ask !== 'number'
          || !Number.isFinite((q as UiQuote).bid) || !Number.isFinite((q as UiQuote).ask)) {
          delete book[name];
          continue;
        }
        const quote = q as UiQuote & { bids?: unknown; asks?: unknown };
        if (quote.bids !== undefined && !depthOk(quote.bids, false)) delete quote.bids;
        if (quote.asks !== undefined && !depthOk(quote.asks, true)) delete quote.asks;
      }
    };
    sanitizeQuotes(merged.prices);
    if (merged.infraPrices === null || typeof merged.infraPrices !== 'object' || Array.isArray(merged.infraPrices)) merged.infraPrices = {};
    sanitizeQuotes(merged.infraPrices);
    return merged;
}

export function loadState(): UiState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return defaultState();
    return sanitizeState(JSON.parse(raw) as Partial<UiState>);
  } catch {
    return defaultState();
  }
}

/** Returns whether the save actually landed — the page must still work when
 * storage is unavailable (private mode, quota), but the UI must not CLAIM
 * "Autosaved" on a swallowed failure (Round-2 engineering audit). */
export function saveState(s: UiState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
