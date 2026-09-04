/**
 * SOLVE WORKER (Round-3, owner approved 2026-09-03): the compare/profit
 * ranking — ~100 greedy solves — runs OFF the main thread entirely, so the
 * page stays fully interactive even on 50-character rosters. The engine is
 * DOM-free by design (verified in the Round-2 audit), so it imports cleanly
 * into a module worker. Everything crossing the boundary is plain data.
 *
 * Protocol: the app posts { id, world, market, overrides }; the worker posts
 * back { id, progress, total } after each chunk and finally
 * { id, done: true, ranked, excluded }. Any throw posts { id, error }.
 * The main thread (app.ts comparativeChunked) falls back to its own chunked
 * loop when workers are unavailable — same math, same order, either path.
 */
import { comparative, sweepRankedRow, allProducts, type MarketContext, type RankedOption } from '../engine/modes.js';
import type { SolveWorld } from '../engine/allocator.js';
import type { Sourcing } from '../engine/chain.js';

interface CompareRequest {
  readonly id: number;
  readonly world: SolveWorld;
  readonly market: MarketContext;
  readonly overrides: Readonly<Record<string, Sourcing>>;
}

const post = (msg: unknown): void => { (self as unknown as { postMessage(m: unknown): void }).postMessage(msg); };

self.addEventListener('message', (ev) => {
  const req = (ev as MessageEvent).data as CompareRequest;
  try {
    const names = allProducts();
    const ranked: RankedOption[] = [];
    const excluded: Array<{ product: string; reason: string }> = [];
    const CHUNK = 6;
    // Phase 1 — postures per candidate, sweep OFF (sweepTop: 0), so the merge
    // is chunk-order independent. Phase 2 sweeps the merged top rows exactly
    // as a whole comparative() call would — chunked ≡ whole-run, guaranteed.
    for (let i = 0; i < names.length; i += CHUNK) {
      const part = comparative(req.world, req.market, names.slice(i, i + CHUNK), req.overrides, { sweepTop: 0 });
      ranked.push(...part.ranked);
      excluded.push(...part.excluded);
      post({ id: req.id, progress: Math.min(i + CHUNK, names.length), total: names.length });
    }
    ranked.sort((a, b) => b.economics.netPerWeek - a.economics.netPerWeek);
    const K = Math.min(20, ranked.length);
    for (let i = 0; i < K; i++) {
      ranked[i] = sweepRankedRow(req.world, req.market, ranked[i]!, req.overrides);
      post({ id: req.id, refine: i + 1, total: K });
    }
    ranked.sort((a, b) => b.economics.netPerWeek - a.economics.netPerWeek);
    post({ id: req.id, done: true, ranked, excluded });
  } catch (e) {
    post({ id: req.id, error: (e as Error).message });
  }
});
