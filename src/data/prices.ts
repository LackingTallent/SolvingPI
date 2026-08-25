/**
 * Price service. Realized prices come from the ORDER BOOK (best bid, best
 * ask, at a specific location), never from a single blended number — the v8
 * line priced purchases off the wrong side because the side was implicit.
 *
 * Everything network-facing takes an injected `fetchJson` so the whole module
 * tests offline; the live wiring (ESI base URL, compatibility date, pacing)
 * is configuration, not code changes. Staleness is data: every snapshot
 * carries fetchedAt and the caller surfaces it to the user.
 */
import type { PriceSet, Quote } from '../engine/modes.js';
import type { IdRegistry } from './ids.js';

export const JITA_REGION_ID = 10000002; // The Forge
export const JITA_44_STATION_ID = 60003760; // Jita IV-4 CNAP

/** Injected transport: returns parsed JSON plus selected response headers. */
export type FetchJson = (url: string) => Promise<{ body: unknown; headers: Readonly<Record<string, string>> }>;

export interface EsiOrder {
  readonly is_buy_order: boolean;
  readonly location_id: number;
  readonly price: number;
  readonly type_id: number;
  readonly volume_remain: number;
}

export interface PriceSnapshot {
  readonly prices: PriceSet;
  readonly fetchedAt: string; // ISO timestamp (caller-supplied clock)
  readonly source: string;
  readonly regionId: number;
  readonly locationId: number | null;
  /** Commodities requested but not priced, with reasons — never silent. */
  readonly unpriced: ReadonlyArray<{ name: string; reason: string }>;
}

export interface PriceServiceConfig {
  readonly fetchJson: FetchJson;
  readonly ids: IdRegistry;
  readonly baseUrl?: string; // default ESI
  readonly regionId?: number;
  /** Restrict best-of-book to one station/structure (default Jita 4-4). null = whole region. */
  readonly locationId?: number | null;
  readonly now: () => string; // ISO clock, injected for determinism
}

const DEFAULT_BASE = 'https://esi.evetech.net/latest';

/**
 * Build a PriceSet for `names` from ESI regional order books (one request per
 * type via type_id filter) and daily volumes from market history.
 * Sequential by design — the market-orders token bucket is generous but
 * bursts are rude; callers wanting speed can shard names across calls.
 */
export async function fetchPrices(names: ReadonlyArray<string>, cfg: PriceServiceConfig): Promise<PriceSnapshot> {
  const base = cfg.baseUrl ?? DEFAULT_BASE;
  const regionId = cfg.regionId ?? JITA_REGION_ID;
  const locationId = cfg.locationId === undefined ? JITA_44_STATION_ID : cfg.locationId;
  const prices: Record<string, Quote> = {};
  const unpriced: Array<{ name: string; reason: string }> = [];

  for (const name of names) {
    let typeId: number;
    try {
      typeId = cfg.ids.typeIdOf(name);
    } catch (e) {
      unpriced.push({ name, reason: (e as Error).message });
      continue;
    }
    try {
      const { body } = await cfg.fetchJson(`${base}/markets/${regionId}/orders/?type_id=${typeId}&order_type=all`);
      const orders = (body as EsiOrder[]).filter((o) => locationId === null || o.location_id === locationId);
      const bids = orders.filter((o) => o.is_buy_order).map((o) => o.price);
      const asks = orders.filter((o) => !o.is_buy_order).map((o) => o.price);
      if (bids.length === 0 && asks.length === 0) {
        unpriced.push({ name, reason: `no orders at location ${locationId ?? 'region-wide'}` });
        continue;
      }
      const bid = bids.length > 0 ? Math.max(...bids) : 0;
      const ask = asks.length > 0 ? Math.min(...asks) : Number.POSITIVE_INFINITY;
      if (asks.length === 0) { unpriced.push({ name, reason: 'no sell orders (ask side empty)' }); continue; }
      if (bids.length === 0) { unpriced.push({ name, reason: 'no buy orders (bid side empty)' }); continue; }

      let dailyVolume: number | undefined;
      try {
        const { body: hist } = await cfg.fetchJson(`${base}/markets/${regionId}/history/?type_id=${typeId}`);
        const days = hist as Array<{ volume: number }>;
        const recent = days.slice(-7);
        if (recent.length > 0) dailyVolume = recent.reduce((a, d) => a + d.volume, 0) / recent.length;
      } catch { /* history is optional; saturation analytics will say so */ }

      prices[name] = dailyVolume !== undefined ? { bid, ask, dailyVolume } : { bid, ask };
    } catch (e) {
      unpriced.push({ name, reason: `fetch failed: ${(e as Error).message}` });
    }
  }

  return {
    prices,
    fetchedAt: cfg.now(),
    source: `${base} region ${regionId}${locationId !== null ? ` @ ${locationId}` : ''}`,
    regionId,
    locationId,
    unpriced,
  };
}

/** Age of a snapshot in minutes against a caller clock — for the staleness banner. */
export function snapshotAgeMinutes(snapshot: PriceSnapshot, nowIso: string): number {
  const age = (Date.parse(nowIso) - Date.parse(snapshot.fetchedAt)) / 60000;
  if (!Number.isFinite(age) || age < 0) throw new Error(`snapshot-age-invalid: fetchedAt=${snapshot.fetchedAt} now=${nowIso}`);
  return age;
}
