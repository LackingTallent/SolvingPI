# 30 — Rebuild Plan (FINAL v1 — decisions locked 2026-08-25)

Goal: a ground-up rebuild of Solving PI (v9, fresh repo) that is logically sound, grounded in
real game mechanics, and gives users deep, economics-driven analytics — with multiple ways to
arrive at their best answer, all resting on one universal math core.

Ordering rule: truth before math, math before optimization, optimization before UI. Nothing
downstream is built until its upstream layer's gate passes.

## Locked decisions (Ryan, 2026-08-25)
- Fresh repo. Deployed to a prototype site when ready (Cloudflare and Netlify both available;
  production cutover is a separate later decision).
- Density: the math core runs on raw survey units (qty-per-cycle, what the game and ESI use);
  the UI shows the familiar percentage as a translation layer.
- Density sources: manual scan entry + ESI import of installed colonies (SSO in scope) +
  saved per-planet history with drift/depletion trends.
- Above-cap surplus: per-colony choice — default archetype with capped-and-disclosed output,
  derived-layout alternative offered whenever surplus exists.
- Equinox: FULL scope — skyhook-aware customs everywhere plus the reagent economy
  (Magmatic Gas, Superionic Ice), bays, raid-window risk. Classic PI and reagents can coexist
  on one planet and are modeled as parallel income streams.
- Scale: accurate for ANY operation from 1 to 50 characters (1-300 colony slots), not tuned
  to one size. Per-character reality modeled individually: each character has its own planet
  count (1-6 by Interplanetary Consolidation level), own CC upgrade levels, own tax standing.
  Sum-not-multiply everywhere. See "Scale requirement" below for the solver and test
  consequences.

## Phase 0 — Verification foundation  [DONE except spec assembly]
- 03-owner-formulas.md verified with per-item verdicts; independent CCP-formula
  reimplementation reproduces the decay table and 290,112 exactly (verify/ scripts kept as
  regression oracles for the new engine).
- Remaining: resolve library UNVERIFIED flags that Phase 1 depends on (cycle-time boundary
  inclusivity, per-cycle truncation, link-upgrade scaling — measured in-client or from SDE),
  and assemble the single "constants & formulas" spec. SDE-derived numbers are generated from
  the SDE (2025 JSONL) at build time, never typed.

## Phase 1 — World model (facts, no opinions)
- Typed model: planets, P0 spawns, schematics (from SDE), facilities, CPU/PG, capacities,
  volumes, skills, character limits, POCO/skyhook tax rules, fee rules, reagent objects.
- Every quantity carries units (ISK, m³, units, s, tf, MW); unit mismatches are type errors
  (kills the 100×-volume bug class). Pure functions only.
- Gate 1: property tests + fixtures against known in-game cases.

## Phase 2 — Universal math core
- Extraction: CCP formula with the real cycle-time step function; input is raw w (per head
  layout), % shown as translation. Outputs per-day AND per-login rates; decay-vs-cadence
  tradeoff curve is first-class.
- Flow model: colony as steady-state flow network with hard stage caps —
  output = min(facility capacity, supply ÷ ratio) at every stage; buffers give unattended
  runway (QOL metric), never throughput. Layout (heads/basics/adv/HT counts) is a variable
  validated against CPU/PG, with the classic archetypes as presets.
- ONE accounting ledger: net = realized revenue − input opportunity cost − customs (POCO or
  skyhook, base-cost basis, ×0.5 import, ×1.5 CC launch) − market fees (7.5%-base sales tax,
  broker, skill-adjusted) − freight. Price-basis (bid/ask, immediate/patient) carried on every
  ISK figure. Zero-cost identity asserted forever. Reagent income uses the same ledger with a
  raid-risk haircut on the Surplus Bay share (parameterized, disclosed).
- Gate 2: golden tests vs hand-computed cases + the verify/ oracles; cross-checks against
  v8.3 where v8.3 was right.

## Phase 3 — Feasibility judge (built BEFORE any solver)
- validatePlan: every hard constraint (CPU/PG, planets/char, one colony per char per planet,
  schematic ratios, capacities, planet-type legality incl. HT on Barren/Temperate only,
  skills, restricted systems, skyhook sov requirements) → pass/fail with named reasons.
- Judge and solvers share the same constants spec but the judge is independently tested with
  adversarial illegal plans — all must be caught by name (36-rule suite carried forward and
  extended; the dealer-vs-judge cap mismatch class becomes impossible: dealers must call the
  judge).
- Gate 3: adversarial suite green.

## Phase 4 — Solvers: multiple paths, one truth
All modes propose plans; the judge validates; the ledger prices. Modes differ only in
objective/direction:
- Forward (from planets/characters you have) → max net ISK/day or ISK/login.
- Backward (from a product quota) → min planets/logins/capital.
- Attention-first (from a login budget) → max net within cadence.
- Comparative → ranked frontier with tradeoffs and sensitivity (prices, density, freight).
- Every answer states its baseline (e.g. vs selling raw P1) and its binding constraint
  (limitedBy/why carried forward).
- Optimality: greedy allocator + an ILP/branch-and-bound reference solver to MEASURE the gap
  (replaces the projected small-world extrapolation; closes v8.3's "still open" item).

### Scale requirement: exact where it hurts, bounded where it's big
v8.3's own measurements show the greedy gap is WORST for small operations (up to 33% left
behind at 4 slots, 20% at 6, 14% at 8) — precisely the 1-2 character users. Meanwhile
exhaustive/exact search is cheapest at exactly those sizes. So the solver is hybrid by design:
- Small worlds (below a measured size threshold): the exact solver (ILP/branch-and-bound) IS
  the answer, not a benchmark. A 1-character user gets provably optimal plans.
- Large worlds: greedy/heuristic allocation with the exact solver run on relaxations or
  samples to report a measured optimality bound ("within X% of optimal"), never an
  extrapolated one.
- The threshold is chosen by measurement (where exact solve time crosses ~1-2s in-browser),
  not hardcoded.
- Performance budget: all modes must complete interactively at 50 chars × 6 planets = 300
  slots (the allocator, judge, and ledger are benchmarked at 1, 5, 28, and 50 characters in
  CI).

- Gate 4: cross-mode consistency — identical plan ⇒ identical ISK in every mode; influence
  tests (test-matrix pattern): every user-facing setting must change some output; scale sweep
  — correctness suites run at 1, 2, 5, 10, 28, and 50 characters with heterogeneous
  per-character planet counts and skills (uneven worlds like [6,1,1] are first-class test
  fixtures, since that shape broke v8.3's dealer).

## Phase 5 — Analytics layer (derived from 20-economics-principles.md)
- Marginal: value of next planet/char/login/CC level; where the next unit of effort pays most.
- Market: realized-price spread, depth/saturation vs your output rate, buy-vs-refine-vs-
  extract per input at realized prices, chain-depth tax efficiency.
- Operational: bottleneck naming, buffer runway, decay-vs-login curve, plan-switching cost vs
  benefit, density drift from saved history, skyhook raid-exposure.
- Every insight cites inputs (price snapshot age, density source & date). No unexplained
  numbers.

## Phase 6 — Data layer
- SDE build-time pipeline (2025 JSONL; Fuzzwork fallback) → schematics, volumes, types.
- Prices: ESI markets with explicit basis + staleness surfaced; defined fallback order;
  ESI citizenship (compatibility-date pinning, token-bucket pacing, honest User-Agent).
- SSO: client-side PKCE, token calls routed through a ~50-line Cloudflare Worker proxy behind
  a flag (insures against CORS drift; enables refresh-token custody later). Multi-character:
  N logins, per-char token records, serialized refreshes — sized for up to 50 characters
  (importer paced within ESI token buckets; a 50-char full import stays inside rate limits
  and shows per-character progress).
- ESI importer: /characters/{id}/planets → pins, extractor_details (real w!), routes → seeds
  density history and current-plan state.
- Gate 6: importer round-trip test on live colonies; price-basis audit.

## Phase 7 — UI + prototype deploy
- Built last over a stable engine API. Entry paths: from planets / from a product / from a
  login budget / from a market view — converging on the same plan objects. Copy-paste
  per-planet templates retained. No sliders; constraints as constraints.
- Real module system (no filename-prefix concat); a page that throws is a failed build.
- Deploy to a prototype site (separate from solvingpi.com) when Gates 1-6 are green and the
  UI passes its own influence tests. Production cutover is Ryan's call after using it.

## Cross-cutting rules (from FINDINGS + audits)
- Options assembled in exactly one place (engineOpts pattern), enforced by build check; any
  function receiving unknown keys throws.
- One source of truth per concept: one ledger, one preset table, one constants spec.
- Influence testing in CI: a control that does nothing must fail the build.
- Verify every fix by re-breaking it; assertions that have never failed are guesses.
- Prose docs (the "in words" page) asserted against the engine so they cannot drift.
- No Date.now()-style hidden state in engine code; everything reproducible from inputs.

## Known-bug ledger from v8.3 the rebuild must structurally prevent
Quota P3/P2 constant miswire; empty shopping list (key mismatch); buy-side pricing of
purchases; zeroed cost fields on Product/QOL cards; QOL path ignoring sourcing; dealer
ignoring per-char caps; ME10 composite defaults contradicting first principles; duplicate
preset tables (3.37 vs 3.4). Each becomes a named regression test in the new suite.
