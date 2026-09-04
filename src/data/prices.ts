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
  /** Fetch daily-volume history per type (default true). Infrastructure
   * price checks skip it — capital cost needs the ask, not the flow. */
  readonly history?: boolean;
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
      // T-18 fix: ESI order books are PAGED (x-pages header); reading only
      // page 1 silently dropped orders on busy types. Fetch every page
      // (capped at 20 — a single-type regional book never legitimately
      // exceeds that; the cap is a runaway guard, and hitting it is noted).
      const allOrders: EsiOrder[] = [];
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        const { body, headers } = await cfg.fetchJson(`${base}/markets/${regionId}/orders/?type_id=${typeId}&order_type=all&page=${page}`);
        if (page === 1) {
          const xp = Number(headers['x-pages'] ?? headers['X-Pages'] ?? '1');
          if (Number.isFinite(xp) && xp > 1) pages = Math.min(Math.floor(xp), 20);
        }
        allOrders.push(...(body as EsiOrder[]));
      }
      const orders = allOrders.filter((o) => locationId === null || o.location_id === locationId);
      const bidOrders = orders.filter((o) => o.is_buy_order);
      const askOrders = orders.filter((o) => !o.is_buy_order);
      const bids = bidOrders.map((o) => o.price);
      const asks = askOrders.map((o) => o.price);
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
        if (cfg.history === false) throw new Error('skipped');
        const { body: hist } = await cfg.fetchJson(`${base}/markets/${regionId}/history/?type_id=${typeId}`);
        const days = hist as Array<{ volume: number }>;
        const recent = days.slice(-7);
        if (recent.length > 0) {
          dailyVolume = recent.reduce((a, d) => a + d.volume, 0) / recent.length;
          // T-18 fix (venue consistency): prices come from ONE station, but
          // ESI history is region-wide — dividing station sales into region
          // volume understated the user's market share, firing the
          // saturation warning too late. ESI publishes no station-level
          // history, so the best public estimator is the station's share of
          // the region's STANDING book (both sides, all pages — fetched
          // above): scale the regional daily volume by that share. At Jita
          // 4-4 the share is typically ≥0.9, so the correction is small but
          // in the honest direction; a floor of 5% guards against a freak
          // empty-book snapshot zeroing the volume.
          if (locationId !== null) {
            const vol = (list: EsiOrder[]): number => list.reduce((a, o) => a + o.volume_remain, 0);
            const regionBook = vol(allOrders);
            const stationBook = vol(orders);
            if (regionBook > 0 && stationBook > 0) {
              dailyVolume *= Math.min(1, Math.max(0.05, stationBook / regionBook));
            }
          }
        }
      } catch { /* history is optional; saturation analytics will say so */ }

      // Order-book depth (truth audit T-09): aggregate by price, best-first,
      // top 15 levels each side — economics walks these for the week's whole
      // quantity so one thin top order cannot price the entire output.
      const depth = (list: EsiOrder[], desc: boolean): Array<{ price: number; qty: number }> => {
        const byPrice = new Map<number, number>();
        for (const o of list) byPrice.set(o.price, (byPrice.get(o.price) ?? 0) + o.volume_remain);
        return [...byPrice.entries()]
          .sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0]))
          .slice(0, 15)
          .map(([price, q]) => ({ price, qty: q }));
      };
      prices[name] = {
        bid, ask,
        ...(dailyVolume !== undefined ? { dailyVolume } : {}),
        bids: depth(bidOrders, true),
        asks: depth(askOrders, false),
      };
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
