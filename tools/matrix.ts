/**
 * MATRIX TEST — the whole planning flow, engine level, start to finish:
 *   character counts × goals × detail-path sourcing × product tiers,
 * every cell asserted (suggestion coverage, judge verdict, bound sanity,
 * ledger finiteness, gate behavior), with a printed pass/fail matrix.
 *
 * Run: tsx tools/matrix.ts   (exits non-zero on any cell failure)
 *
 * The UI adapters (quick-density substitution, readiness gate wiring) are
 * exercised separately in the browser matrix (tools/ui-matrix.mjs); this file
 * proves the engine under every combination the UI can hand it.
 */
import { PLANET_TYPES, SCHEMATICS, tierOf, type PlanetType } from '../src/spec/schematics.js';
import { resourcesOf } from '../src/world/planets.js';
import { character, operation } from '../src/world/characters.js';
import { solveMax, solveQuota, type SolveWorld } from '../src/engine/allocator.js';
import { comparative, economics, qolSolve, type MarketContext } from '../src/engine/modes.js';
import { suggestSourcing } from '../src/engine/suggest.js';
import { p1InputsOf, oreOf } from '../src/engine/chain.js';
import { analyze } from '../src/engine/analytics.js';
import { solveReadiness } from '../src/ui/readiness.js';

// ---------------------------------------------------------------------------
// Neutral fixtures (NO personal data): synthetic systems, tier-derived prices.
// ---------------------------------------------------------------------------

/** Which planet type carries a given P0 (first match; deterministic order). */
function typeCarrying(p0: string): PlanetType {
  for (const t of PLANET_TYPES) if (resourcesOf(t).includes(p0)) return t;
  throw new Error(`no planet type carries ${p0}`);
}

/** Build a world with `chars` characters and planets that carry every ore the
 * product needs (plus filler variety), densities varied deterministically. */
function makeWorld(chars: number, product: string): SolveWorld {
  const ores = [...new Set(p1InputsOf(product).map((p1) => oreOf(p1)))];
  const types = [...new Set([...ores.map(typeCarrying), 'Barren' as PlanetType, 'Storm' as PlanetType])];
  const planetCount = Math.min(6 * chars + 4, 120);
  const planets: SolveWorld['planets'] = [];
  for (let i = 0; i < planetCount; i++) {
    const type = types[i % types.length]!;
    const resources: Record<string, number> = {};
    for (const [j, p0] of resourcesOf(type).entries()) {
      // Deterministic spread 55%..125% of the reference — no randomness.
      resources[p0] = 13277.2694 * (0.55 + 0.1 * ((i + j) % 8));
    }
    planets.push({ name: `M-${i + 1}`, type, resources });
  }
  return {
    operation: operation(Array.from({ length: chars }, (_, i) => character({
      name: `Char-${i + 1}`,
      icLevel: i % 3 === 0 ? 5 : 4, // mixed skills — never one char × N
      ccuLevel: 5, customsCodeLevel: i % 2 === 0 ? 5 : 3, accountingLevel: 5, brokerRelationsLevel: 4,
    }))),
    planets,
    programHours: 6,
  };
}

/** Tier-derived synthetic prices for every commodity (P0..P4), spread bid<ask. */
function makeMarket(): MarketContext {
  const prices: Record<string, { bid: number; ask: number; dailyVolume: number }> = {};
  const tierMid = [5, 500, 9000, 70000, 1_300_000];
  const all = new Set<string>();
  for (const name of SCHEMATICS.keys()) {
    all.add(name);
    for (const p1 of p1InputsOf(name)) { all.add(p1); try { all.add(oreOf(p1)); } catch { /* not P1 */ } }
  }
  for (const name of all) {
    const mid = tierMid[tierOf(name)] ?? 500;
    prices[name] = { bid: mid * 0.97, ask: mid * 1.03, dailyVolume: 1e6 };
  }
  return {
    prices,
    sellBasis: 'immediate', buyBasis: 'immediate',
    fees: { salesTaxRate: 0.03375, brokerRate: 0.015 },
    customs: { ownerRate: 0.05, hisecNpc: false, customsCodeLevel: 5 },
    freightOutPerM3: 400, freightInPerM3: 400,
  };
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

const CHAR_COUNTS = [1, 3, 10, 25, 50];
const PRODUCTS = ['Water', 'Coolant', 'Robotics', 'Broadcast Node']; // P1..P4
const MODES = ['max', 'quota', 'qol', 'compare'] as const;
const market = makeMarket();

let pass = 0, fail = 0;
const failures: string[] = [];
const cell = (label: string, fn: () => void): void => {
  try { fn(); pass++; } catch (e) { fail++; failures.push(`${label}: ${(e as Error).message}`); }
};
const assert = (cond: boolean, msg: string): void => { if (!cond) throw new Error(msg); };

const t0 = Date.now();
for (const chars of CHAR_COUNTS) {
  for (const product of PRODUCTS) {
    const world = makeWorld(chars, product);

    // Suggested sourcing must cover the chain with named reasons, always.
    const suggestion = suggestSourcing(world, product, market);
    cell(`${chars}c ${product} suggest`, () => {
      const inputs = p1InputsOf(product);
      assert(inputs.every((p1) => suggestion.sourcing[p1] !== undefined), 'suggestion missed an input');
      assert(suggestion.notes.every((n) => n.reason.length > 0), 'a choice has no reason');
      assert(suggestion.refined || suggestion.refinementSkipped !== undefined, 'refinement state undisclosed');
    });
    // A pinned override must survive suggestion verbatim.
    cell(`${chars}c ${product} pin`, () => {
      const firstInput = p1InputsOf(product)[0];
      if (firstInput === undefined || firstInput === product) return;
      const pinned = suggestSourcing(world, product, market, { [firstInput]: 'buy' });
      assert(pinned.sourcing[firstInput] === 'buy', 'pin was overruled');
    });

    for (const mode of MODES) {
      const label = `${chars}c ${product} ${mode}`;
      if (mode === 'compare') {
        if (chars > 10) continue; // compare re-solves ~100 products; bounded here
        cell(label, () => {
          const { ranked, excluded } = comparative(world, market);
          assert(ranked.length + excluded.length === new Set([...SCHEMATICS.keys()]).size,
            `compare lost products: ${ranked.length}+${excluded.length}`);
          assert(ranked.length > 0, 'compare ranked nothing on a healthy world');
          for (const r of ranked) assert(Number.isFinite(r.economics.netPerWeek), `non-finite net for ${r.product}`);
          for (let i = 1; i < ranked.length; i++) {
            assert(ranked[i - 1]!.economics.netPerWeek >= ranked[i]!.economics.netPerWeek, 'ranking out of order');
          }
        });
        continue;
      }
      cell(label, () => {
        if (mode === 'max') {
          const r = solveMax(world, product, suggestion.sourcing);
          assert(!('error' in r), 'error' in r ? r.error : '');
          if ('error' in r) return;
          assert(r.verdict.legal, `judge rejected: ${r.verdict.violations.map((v) => v.rule).join(',')}`);
          assert(r.realizedPerWeek > 0, 'zero output on a healthy world');
          assert(r.realizedPerWeek <= r.upperBoundPerWeek * (1 + 1e-9) || r.upperBoundPerWeek === 0,
            `realized ${r.realizedPerWeek} exceeds bound ${r.upperBoundPerWeek}`);
          const eco = economics(r, market, world.programHours);
          assert(Number.isFinite(eco.netPerWeek), 'non-finite net');
          assert(Math.abs(eco.ledger.net - eco.netPerWeek) < 1e-6, 'ledger does not reconcile to net');
        } else if (mode === 'quota') {
          const full = solveMax(world, product, suggestion.sourcing);
          const capacity = 'error' in full ? 0 : full.realizedPerWeek;
          const q = solveQuota(world, product, Math.max(1, Math.floor(capacity * 0.4)), suggestion.sourcing);
          assert(!('error' in q), 'error' in q ? q.error : '');
          if ('error' in q) return;
          assert(q.verdict.legal, 'quota plan rejected by judge');
          assert(q.realizedPerWeek >= Math.floor(capacity * 0.4) - 1e-6, 'quota not met');
          // An impossible quota must refuse BY NAME with the achievable figure.
          const impossible = solveQuota(world, product, capacity * 10 + 1e6, suggestion.sourcing);
          assert('error' in impossible, 'impossible quota did not refuse');
          if ('error' in impossible) assert(impossible.achievablePerWeek !== undefined, 'refusal lacks achievable figure');
        } else {
          const q = qolSolve(world, product, market, 7, suggestion.sourcing);
          assert(!('error' in q), 'error' in q ? q.error : '');
          if ('error' in q) return;
          assert(q.result.verdict.legal, 'qol plan rejected by judge');
          assert(Number.isFinite(q.economics.netPerWeek), 'qol non-finite net');
          assert(168 / q.programHours <= 7 + 1e-9, `qol cadence ${q.programHours}h breaks the 7-session budget`);
        }
      });
    }

    // Deep analytics must run clean on the priced max solve (small/mid worlds).
    if (chars <= 10) {
      cell(`${chars}c ${product} analytics`, () => {
        const r = solveMax(world, product, suggestion.sourcing);
        if ('error' in r) throw new Error(r.error);
        const report = analyze(world, r, market);
        assert(report.insights.length >= 5, 'analytics thin');
        assert(report.insights.every((i) => i.detail.length > 0), 'an insight lacks detail');
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Gate matrix: readiness across goals × detail levels (pure, exhaustive).
// ---------------------------------------------------------------------------
const scanned = [{ name: 'S', type: 'Storm' as const, resources: [{ p0: 'Aqueous Liquids', w: 13000 }, { p0: 'Ionic Solutions', w: 12000 }] }];
const unscanned = [{ name: 'U', type: 'Storm' as const, resources: [{ p0: 'Aqueous Liquids', w: 0 }, { p0: 'Ionic Solutions', w: 0 }] }];
const chainPrices = { Coolant: { bid: 11000, ask: 12500 }, Water: { bid: 700, ask: 900 }, Electrolytes: { bid: 700, ask: 900 } };
for (const mode of MODES) {
  for (const level of ['quick', 'refined', 'exact'] as const) {
    for (const [worldName, planets] of [['scanned', scanned], ['unscanned', unscanned]] as const) {
      cell(`gate ${mode} ${level} ${worldName}`, () => {
        const base = {
          planets, product: 'Coolant',
          sourcing: { Water: 'extract', Electrolytes: 'extract' } as const,
          mode, prices: chainPrices, detailLevel: level,
          spaceBand: 'nullsec' as const, costsSource: 'user' as const,
        };
        assert(!solveReadiness({ ...base, modeChosen: false }).ready, 'no-goal must always block');
        const r = solveReadiness(base);
        const expectReady = worldName === 'scanned' || level === 'quick';
        assert(r.ready === expectReady,
          `expected ready=${String(expectReady)}, got ${String(r.ready)} [${r.missing.join(' | ')}]`);
        if (level === 'exact') {
          assert(!solveReadiness({ ...base, costsSource: 'default' }).ready, 'exact must demand own costs');
        }
        if (level === 'quick' && worldName === 'unscanned') {
          assert(!solveReadiness({ ...base, spaceBand: null }).ready, 'quick+unscanned must demand a band');
        }
      });
    }
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nMATRIX: ${pass} cells passed, ${fail} failed (${secs}s)`);
for (const f of failures) console.error(`FAIL ${f}`);
process.exit(fail === 0 ? 0 : 1);
