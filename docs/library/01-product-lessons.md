# Solving PI — Product Lessons from the Existing Build

Studied from the repo at `/root/solvingpi-old/solving-pi` (v8.0.0-era `master`, single commit
"Add files via upload"). Sources: full read of all 28 `src/js` modules, `build.js`, the
`tools/` suites and fixtures, and all 22 docs. Companion file:
`02-legacy-formulas.md` (every formula, verbatim, with file:line).

---

## 1. What the product is

A **single-file, zero-dependency EVE Online Planetary Industry planner** (solvingpi.com /
solvingpi.netlify.app). The user enters what planets and characters they have; the tool
decides what to build, splits colonies between extraction and factories, prices the result
against live Jita data, and emits a per-character, per-planet plan with copy-paste colony
templates for the game client.

One-sentence goal (REBUILD-BRIEF): *turn "I have 28 characters and these planets" into
"build exactly this, and here are the templates to paste into the game."*

### The page, top to bottom (from `src/index.html` + module wiring)

- **Step-0 planning fork** — "Plan from my planets" vs. "Plan from a quota" (the quota
  path hides sections 1 and 4 because operation size and goal are *outputs* in that
  direction).
- **Section 1 — Operation size.** Character count (1–50), per-character planet counts
  (1–6 each, individually sized, with optional character names), extraction program
  length control (6h–336h) with a live yield/storage readout.
- **Section 2 — Systems & planets.** System cards with ESI-backed system-name
  autocomplete; planet cards with type dropdown and per-resource density number fields
  (seeded at 50%, flagged as placeholder until touched); per-planet screenshot OCR; batch
  screenshot import (up to 20 images or a .zip, dependency-free ZIP reader).
- **Section 3 — Financial settings.** % of Jita buy realised, shipping ISK/m³, customs %,
  sales tax %, "other tax" % (broker), with regional presets (zero / highsec / lowsec /
  nullsec / wormhole), each disclosed as typical-not-yours. Input sourcing mode:
  extract-everything / hybrid (buy chosen P1s) / buy-all-inputs, with an order-book-depth
  purchase pricer.
- **Section 4 — "SMART Goals — Real Plans".** Three goal modes (radio group):
  - **Profit Goal Focus** — ranks all 83 PI commodities + fuel blocks + nanite paste by
    net ISK/week buildable on *your* world; top 10 cards; "+ mix" builds a multi-product
    plan with requested vs. achieved slot shares.
  - **Product Goal Focus** — you pick up to 10 commodities of any tier (incl. composites);
    each is planned independently against the full slot budget, plus the mix strip.
  - **QOL Goal Focus** — you say how often you log in (interval hours); every planet that
    can run a self-contained P0→P2 chain gets its most profitable one, with per-planet
    launchpad-overflow warnings and the yield cost of the interval stated live.
- **Confirm → Dashboard.** A judged plan rendered character-by-character with warp-order
  rows, role badges (EXTRACT / FACTORY / P4 ASSEMBLY / LAZY), per-colony copy-paste
  template buttons, setup-complete tick boxes (session-only), a hauling table (what moves
  between planets weekly), and a bought-in shopping list.
- **Quota calculator** (inverse direction) — name a product, quantity, deadline, expected
  density; get colonies and planet *types* needed (with poor/typical/rich density range),
  characters needed, and which planet types cover the most inputs.
- **Reference panels** — 83-commodity market grid, 90-day price-history chart (lazy-loaded,
  batched ESI), order-book depth chart, template library (259 rows: 60 generated + 199
  community, stored as verbatim file text with author credit), EVE/ESI status panel with
  the tool's own rate-limit budget displayed.
- **Save/Load** — versioned readable JSON of everything entered (incl. the confirmed
  console with its captured prices), validated before touching the page; plus localStorage
  autosave with an explicit restore offer.
- Accessibility: skip link, aria-live result announcements ("N options found. Best: X"),
  aria-busy during calculation, focus-managed help modal.

### Scale and hard rules

Supports 50 characters / 300 planets as *ceilings, never planning assumptions*. Seven hard
game rules (R1–R7) enforced by a separate judge (`validatePlan` in `04-world.js`): one
command center per character per planet; per-character colony caps; resource must exist on
the planet type; ≤5 ECU lines per colony; P4 assembly only on Barren/Temperate; facility
caps (24 Advanced / 16 High-Tech at CCU V); conservation (produced + bought ≥ consumed).

---

## 2. Architecture

### Shape

- **One HTML file built by concatenation.** `build.js` (~166 lines, Node stdlib only)
  concatenates `src/css/*.css` and `src/js/*.js` in filename order into `dist/index.html`,
  injecting at `/* @build:css */` and `/* @build:js */` markers, and stamping the version
  from the git tag (falling back to package.json — a bug class of its own, fixed twice).
- **The numeric filename prefix IS the load order.** No module system; `const`/`let` do not
  hoist across the concatenation, so a module reading a later module's constant kills the
  page at load. This single property caused repeated production breakage (see §5).
- 28 JS modules (`01-data` … `28-quota`, plus `20b-imported-templates`), ~9,900 lines of
  JS in src plus a 66 KB `test-ui.js` and a 40 KB `verify.js` gate.

### Layering (the good part)

```
01-data          static game data, recipes, type IDs, shared physics consts, esiFetch()
02-composites    fuel blocks / nanite paste / deployables + non-PI volumes & type IDs
03-mechanics     PURE: extractor decay, weekly yield, the canonical recipe walk
04-world         PURE: makeWorld (validates a world), validatePlan (THE JUDGE, R1–R7)
05-allocator     PURE: chainDemand → buildAllocContext → placeUnits → maxUnits → allocateMax
06-economics     PURE: price-basis resolution, the weekly ledger (computeEconomics)
07-manufacturing PURE: industry-job time/materials/fees for composites
08-convenience   PURE: regroups a legal plan for fewer trips (never changes output)
09-modes         PURE: profitStage1 / allocateMix / lazyPlan; mode enum throws on unknown
10-plan          PURE: buildPlanModel — judged plan + transfers + disclosures, data only
11–26            DOM/UI modules (cards, finance, results rendering, OCR, save/load, panels)
27-engine-adapter THE ONLY DOM↔engine bridge (reads page into a world, maps result shapes)
28-quota         world-free inverse calculator
```

Data flow on Calculate: DOM → `readWorldFromPage()` (adapter) → `makeWorld` →
mode function (`profitStage1`/`allocateMix`/`lazyPlan`) → `allocateMax` (binary search over
greedy placement, best of k=1..5) → `computeEconomics` → adapter maps into the legacy
result-card shape → results panel. On Confirm: `allocateMax` again → `buildPlanModel`
(which invokes `validatePlan`, the judge) → `renderDashboard`. An illegal plan is refused
with its errors shown, never rendered.

### Verification gates

- `node build.js --check` → `tools/verify.js`, **47 structural checks against the built
  artifact**: module numbering/load order, TDZ execution against a stub DOM
  (`test-browser.js` catches "alive but unwired"), dead code, duplicate CSS selectors,
  balanced tags, ESI request patterns (identification present, compat date pinned),
  secret scanning, owner product rules (no `type=range` sliders anywhere, the judge is
  actually *invoked* not just defined, one definition per lookup, density substitution
  disclosed), an independent re-derivation of the recipe chain (a deliberately separate
  oracle copy of the walk), and live execution of the decay model asserting
  `extractorTotalOutput(6) === 290112`.
- 12 fixture suites, 713 assertions (`tools/test-*.js`), against one reference world
  (11 type-legal planets, 28 chars, 65% density) whose **every expected value was measured
  from the current build**, never inherited (see `docs/RETIRED-TESTS.md` for why the
  previous fixture set was deleted wholesale rather than patched).
- Suites cover: physics/catalogue/allocation (`test-engine`), no padding toward ceilings
  (`test-scale`), the three goals through the real entry point (`test-goals`), the seven
  hard rules (`test-plan`), OCR matching/bars (`test-ocr`), lossless save round trip incl.
  real 0% densities (`test-saveload`), every control wired (`test-ui`), every control
  *clicked* (`test-systems`), Confirm's data path (`test-dashboard`), and the primary
  renderer (`test-render-dashboard`).

### ESI integration (worth studying)

`esiFetch()` in `01-data.js` is the single wrapper for all ~8 call sites: identification
via `X-User-Agent` header **and** `user_agent` query param (browser drops `User-Agent`
silently — documented trap), pinned `compatibility_date` (never rolling), token-budget
awareness read from `X-Ratelimit-*` headers with proactive pacing below 20% budget, global
429 backoff honouring `Retry-After` with exactly one retry, and a session price cache
(one fetch per type id, nulls cached too; cleared on each deliberate Calculate click).
Market reads filter to station 60003760 (Jita 4-4) with region fallback. Fetches are
batched 8-wide against the ~200-token/15-min bucket. Per-goal ESI call budgets are pinned
in fixtures (`maxCallsProfit: 100`, etc.).

---

## 3. Documented flaws, mistakes, and known issues

### The mistake inventory (23 shipped bugs in 8 patterns — `docs/MISTAKE-INVENTORY.md`)

- **A. Binary conditional over a non-binary set** (3×): `goalOutput.checked ? 'output' :
  'profit'`; a 3-way save/load ternary; a 2-way empty-results message. Always failed
  silently toward the last branch.
- **B. Selector/identifier resolving to nothing** (4×): `.planet-list` queried while the
  markup said `.system-planets` (import silently aborted); `perCharListEl` never defined
  (load threw and wiped state); `JITA_REGION_ID` redeclared; `window.getAltProduct` not a
  real global.
- **C. Load-order/scope violations** (2×): module 09c reading module-10 data (TDZ crash);
  lifting nested functions removed their closures and killed two modes while every check
  stayed green.
- **D. Falsy-zero / unguarded numerics** (3×): `densities[r] || 50` turned a real 0% into
  50%; unguarded `.toLocaleString()` throw; unclamped density (1000% → 10× physical max).
- **E. Wrong end / off-by-one** (2×): consolidated template read the LAST hop of output
  routes when the facility is FIRST; 0-based `factoryIdx` compared to 1-based pin numbers
  (both live in `21-templates.js` history — 21 cross-contaminated routes on mixed planets).
- **F. Tests that asserted the bug** (5×): a density check that permitted exactly the
  buggy 10× value; "k=1 is always optimal" encoded as a fixture (cost up to 7% of output);
  a transit hop counted as consumption; 24 label-wrapped controls flagged "anonymous";
  a runtime-built id flagged as dead.
- **G. Dist edited without src** (1×): a null guard lived only in the built artifact and
  vanished on the next clean rebuild. Found only by diffing rebuilt output line-by-line.
- **H. Scripted edits corrupting files** (4+×): regexes eating closing quotes, cutting
  four function bodies short, a CSS append reporting success while writing nothing.

### Economics bugs that shipped (CHANGELOG 8.1.0 / HANDOFF / PROGRESS)

- **Customs computed on market value** instead of EVE's fixed per-tier base cost — a P4 at
  a 10% POCO overstated by ~60% (and understated where market < base); imports not charged
  at all. Fixed to `base × rate` export, `base × rate × 0.5` import.
- **Customs and broker never charged at all**: the adapter sent `customsTaxPct` /
  `otherTaxPct`; the engine reads `customsPct` / `brokerPct`. Unknown cost keys are
  silently ignored, two of four costs matched by luck, so the total still moved and the
  bug looked cosmetic. (This *pattern* is still alive elsewhere — see §5.)
- **Fuel-block volume 100× error**: fuel block volume was 0.05 m³, corrected to 5 m³
  (PROGRESS: "Fuel block volume corrected 0.05 → 5 m³; non-PI inputs now cost freight").
- **A second `volumeOf()`** in a later module shadowed the correct one, so every non-PI
  input (990 units of ice per 40 fuel blocks) shipped for free. Now a build-gated
  "one definition per lookup" rule.
- **Taxes charged on (gross − customs − freight)** instead of transaction value — fixed in
  v3.1.0; overstated profit up to 2.9%, error grew with volume, biasing the ranking toward
  bulky goods.
- **Old profit mode ranked only the 8 P4s** while measured ISK/slot was P3 35.5m vs P4
  35.1m (`ECONOMICS-FINDINGS.md`) — "Maximize Profitability" confidently returned the
  second-best answer. v8's `profitStage1` fixed this by ranking all 83 + composites.

### Template/data bugs that shipped

- Parsed-then-reserialised templates destroyed `"Diam": 8160.0` → `8160` (JS has one
  Number type) and reshaped EVE's own layout; every copied template subtly wrong. Fix:
  store community templates as **verbatim file text**; generated ones use a custom
  serialiser that forces `.0` on Diam/La/Lo.
- Dashboard copy buttons serialised the wrapper object → templates with no pins.
- Barren Launchpad id 2544 was an *icon* id; the real community convention is 2552
  (technically Ice's launchpad; CCP auto-converts on import).
- Ice planets carried Suspended Plasma instead of Planktic Colonies — made Biomass look
  impossible from Ice and offered Plasmoids from a planet that cannot produce them; four
  fixture values recalibrated when fixed.
- Colony split cards showed "0 extraction + 0 P2 = 168 of 168 slots" — the split was
  hardcoded zeros at **three separate handoffs** while the data sat in `placements`.
- `[object Object]` in the hauling table (endpoint arrays through `escapeHtml`).
- The density-substitution warning **could never fire**: the adapter never passed
  `densitySources`, and when fixed the map was keyed on the wrong id format — the tool's
  core honesty promise silently broken twice-over (CHANGELOG 8.2.0).

### OCR bugs that shipped (validated against 53 real screenshots)

- 100% reference found by scanning right for the first *bright* pixel — but the unfilled
  track is dark, so the reference became the fill itself; a true 25% bar read 102%. Every
  density reading was meaningless in early versions.
- Track detection overshot to the bright planet render on uncropped shots (x=1251 vs true
  430) — densities divided by a track 9× too wide. Fixed with edge-voting + cluster
  cross-check (span variance 1042px → 11px).
- System name took the first system-shaped token = the player's *current location*, not
  the surveyed system (planet header minus roman numeral is correct).
- `Tesseract.recognize(...).data.words` was always undefined in v4+ (blocks must be
  requested) → OCR failed 100% of the time while looking like "no resources recognised".
- Low-density resources dropped entirely by a fill-based row finder; bars are ~10 discrete
  segments needing gap tolerance; planet rings defeat single-strategy edge detection.

### Process failures (REBUILD-BRIEF Part 4 — the owner's own post-mortem)

1. **Patched instead of designed** — `runCalculation` reached 685 lines / 11 nested
   functions because every mode was added inside it; the allocator went through three
   generations, each a repair of the last.
2. Binary conditionals over growing enums (3 separate bugs).
3. Tests asserting assumptions instead of requirements (5 times).
4. **Tested parts, assumed the whole** — a behaviour-hash snapshot exercised the engine
   directly and never called `runCalculation`; a refactor shipped with 2 of 5 modes dead
   and 38 checks + 22 suites + a byte-identical hash all green.
5. Regex edits corrupting files repeatedly.
6. Trusting implausible tool output ("0 try/catch blocks" in a codebase with 19).
7. Not knowing when to stop — churn past usefulness, chasing self-introduced bugs in
   unrequested refactors.

### Known open items at hand-off (PROGRESS)

- No real browser click-through has ever been done for v8 (test-DOM only — spacing,
  wrapping, theming unverified by a human).
- ESI never exercised against the live API (all tests use a mocked fetch).
- The known duplicate renderer was resolved (fallback console deleted after evidence it
  overwrote truthful refusals with unjudged grids).
- Narrow-viewport behaviour unverified; page renders at fixed 1280px on phones by design.

---

## 4. Design principles worth keeping — and where the implementation fell short

| Principle | Evidence in code | Where it fell short |
|---|---|---|
| **Proposer/judge separation.** The allocator proposes; `validatePlan` alone decides legality; every emitted plan is judged before rendering. Exists because a self-judging allocator once over-reported 3.1×. | `04-world.js`, `05-allocator.js` header, `27-engine-adapter.js` buildMixPlan ("JUDGE THE PLAN BEFORE SHOWING IT") | For most of the project's life `validatePlan` was **dead code** — present but never invoked ("rules that are not enforced are documentation"). The build gate now checks invocation, which is the right fix. |
| **No silent failures; unknown enum values throw.** Mode dispatch throws on unknown mode; price bases refuse by name; `resolveBuyPrice` refuses a 13-day average rather than averaging less. | `09-modes.js`, `06-economics.js` | `computeEconomics` still silently ignores unknown *cost keys* — the exact mechanism of the customs/broker bug — mitigated only by tests pinning names from both sides. Options objects generally ignore unknown keys (see §5 for two live instances). |
| **Zero-cost identity: net === gross when every cost is zero, exactly.** One-click "Zero costs" preset to verify it. | `06-economics.js` header, `14-finance.js` | Held. But there are **two** economics implementations (engine `computeEconomics` + legacy `computeNetRevenue`) that must both hold it. |
| **Say why, not just the number.** `limitedBy`/`why` on every allocation ("ran out of Barren/Temperate planet capacity for P4 assembly"); no-result screens diagnose the actual cause (slots vs. resources vs. prices). | `05-allocator.js`, `17-sourcing.js` | The no-result diagnostics still contain dead branches for modes that no longer exist (`alt`, `allpi`) — unreachable "why" text. |
| **Every game figure sourced; estimates labelled.** `DATA-SOURCES.md` etc.; unverified volumes flagged `*` in the UI; freight presets say ESTIMATE; quota answers lead with the density *range*. | throughout | Doc drift undermines it: FINANCE-SOURCES freight figures (500/900/1200/1500) contradict the engine's own presets (10/400/600/900) — see §7. FIRST-PRINCIPLES says composite ME is deliberately *not* applied; `chainDemand` applies ME10 + 5.99% structure bonus **by default**. |
| **Refuse to overstate.** No order-book-depth pretence; bought inputs never free; unpriced items report "unavailable"; verified vs. extrapolated templates are different promises (later re-expressed as source attribution — better: a source is checkable, "byte-verified" is not). | `COMPOSITE-RECIPES.md`, `21/22-templates` | The OCR path *clamps* density to 100 while the rest of the app insists >100% readings are real — one honesty rule not applied uniformly. |
| **User's real numbers, never padded.** Per-character planet counts summed, not max×count; slots capped by distinct planets available (C3). | `04-world.js makeWorld`, `17-sourcing.js` | The character-dealing and convenience passes still use the uniform max per character (§5.4) — capacity honoured in totals but not in assignment. |
| **OCR is user-confirmed, never auto-accepted.** Stated in README and OWNER-RULES. | `23-screenshot.js` | Batch import *adds planets directly* with `densitiesSet='1'` and only tells the user to "check every density before calculating" — disclosure, not confirmation. The claim outruns the implementation. |
| **One canonical implementation per computation.** "tierUnitsFor … is the only implementation — it used to be written out six times." | `03-mechanics.js` | There are still **three** recipe walks (`p1Requirements`, `chainDemand`, `traceAnyCommodity`) plus the verifier's deliberate oracle copy; and two economics paths; and two preset tables. |
| **Tests assert requirements, measured expected values, fixture-blame-first.** Retired suites documented with what covers their ground now. | `tools/fixtures.js`, `RETIRED-TESTS.md` | The pattern-F failure ("my test asserted the bug") recurred on the v8 branch more than any other, per HANDOFF. |
| **The mistake inventory as an executable suite** — test the pattern, not the instance. | `docs/MISTAKE-INVENTORY.md` | The suite (`test-regressionclasses.js`) it references no longer exists in `tools/` — the doc outlived the code. |
| **Explain Every Detail panels asserted against the engine** so explanations cannot drift from code. | CHANGELOG 8.1.0 | Good idea, worth carrying: derived prose numbers should be computed, not typed. |

Also worth keeping: the ESI citizenship layer (§2), verbatim-text template storage, the
progressive UI (sections gate/collapse; sticky Calculate only when the real button is
off-screen), invalidation of stale results on any input that changes the answer, the
session-only setup ticks keyed on stable ids, and the quota calculator's inverse-direction
framing with density ranges instead of a single number.

---

## 5. Ordering / sequencing problems and iterative-design scar tissue (found in the code)

These are things a rebuild should design out, mostly **not** documented anywhere in docs/:

1. **Module numbers no longer match module headers.** `06-economics.js` announces itself
   as "07-economics.js", `09-modes.js` as "08-modes.js", `07-manufacturing.js` as
   "09-manufacturing.js". Whole comment blocks exist solely to explain historical
   renumbering ("loaded as 10b, AFTER 10-templates.js…"). Roughly a third of `01-data.js`
   and `15-engine.js` is tombstone comments for constants that moved to `01-data.js`
   because the v8 engine loads at 03 — the load-order constraint forced data placement by
   *load position*, not by ownership.

2. **The adapter passes options the engine silently drops — the customs-key bug shape,
   still live.** `rankProfitV8` passes `isBought: readIsBought()` into `profitStage1`, but
   `profitStage1`'s signature destructures only `{programHours, market, costs, sellSpec,
   buySpec, manufacturing}` — the buy-input checkboxes do nothing in Profit mode.
   `buildMixPlan` passes `isBought` into `allocateMix`, which destructures only
   `{programHours}` and never forwards it to its internal `allocateMax` calls — bought
   inputs are also ignored in the mix path. Only `rankProductV8` and `dashboardFor`
   actually honour it. Same silent-ignored-key mechanism that once zeroed customs and
   broker (`27-engine-adapter.js:205`, `:315` vs `09-modes.js:60`, `:119`).

3. **Buy prices are fetched from the wrong side of the book on the main paths.**
   `fetchJitaPrice` returns the max Jita **buy** order; the adapter then builds
   `market[name] = { buy: price, sell: price }` (`27-engine-adapter.js:201,411,781`), so
   the engine's `buySpec {basis:'jitaSell'}` resolves purchases at the *buy* price —
   systematically understating the cost of bought inputs everywhere the v8 economics runs.
   (The separate legacy `computeInputCosts` path walks the real sell book — but it feeds
   only the dead legacy ranking.)

4. **Character assignment ignores per-character caps that the world model honours.**
   `makeWorld` sums `perCharacterPlanets` for `totalSlots` and the judge checks each
   character's own cap, but `assignCharacters` (`05-allocator.js:331`) and
   `improveAssignment` (`08-convenience.js:47`) both deal colonies against a uniform
   `world.planetsPerChar` (which is the *max* of the array). On an uneven operation
   (6/2/1) the dealer can hand a 1-slot alt several colonies; the judge then refuses the
   whole plan. Right total, wrong distribution — computed at the wrong layer.

5. **The legacy world and the v8 world are both still computed on every run.**
   `runCalculation` (`17-sourcing.js`) still builds `extractionCandidates`,
   `candidatesByP1`, `p1Supply`, fetches all P1 prices, and constructs a legacy `world`
   object — feeding only fallback paths that trigger when "the world cannot be read". The
   legacy candidates call `weeklyP1PerColony(pct)` **without program hours**, so the
   fallback silently assumes a 6-hour program regardless of the user's setting.
   `withPrices` and `fullyRanked` survive as permanently-empty named bindings with
   comments explaining why. The no-result message chain still branches on goal modes
   `'alt'`, `'allpi'`, `'lazy'` that the enum (`profit|product|qol`) can never produce.

6. **Two finance systems, two preset tables, two economics functions.** The engine has
   `SPACE_PRESETS` + `computeEconomics` (`06-economics.js`); the UI has
   `FINANCE_SETTINGS`/`FINANCE_PRESETS` + `computeNetRevenue` (`14-finance.js`), with
   different key names (`customsTax` vs `customsPct`…) bridged by hand in the adapter, and
   **contradictory values** (highsec freight 10 vs 500 ISK/m³; lowsec customs 8 vs 5;
   wormhole customs 5 vs 0). `SPACE_PRESETS` appears to be unreachable from the UI — dead
   data that a future change could wire in wrongly. The live finance readout and QOL/lazy
   fallback still price through `computeNetRevenue`, so two ledgers must agree forever.

7. **Three recipe walks, one "only implementation" claim.** `p1Requirements`
   (03-mechanics, cached), `chainDemand` (05-allocator, the real one), and
   `traceAnyCommodity` (17-sourcing, feeding the result-card `p1Needed`) all encode the
   40/qty, 10/qty, /150 ratios independently — the exact "written out six times and they
   drifted" failure the docs claim was fixed, at smaller scale.

8. **The result-card shape is the v7 shape with v8 data mapped into it** (`p4name` for
   any-tier products, `alloc.perPlanet:{} byResource:{} bought:{}` stubs kept because the
   renderer reads them). The renderer's tooltip math text, loss-labelling, leftover fields
   (`leftoverNet`, `leftoverVolume`) date from the deleted leftover-valuation model and
   are mostly zero/undefined on v8 paths — prose promising "incl. overflow" over numbers
   that no longer include it.

9. **Quota calculator drifted from the engine it borrows from.** It re-implements colony
   math instead of calling the allocator: its factory table wires **P3 throughput to the
   P2 constant** (`28-quota.js:144` — a real bug, see formulas doc §11.1), and returns
   `demand.purchases` when `chainDemand` returns `demand.bought` (`:193` — purchases
   always empty). It also *rejects* densities >100 that the rest of the app deliberately
   accepts.

10. **CHANGELOG version discontinuity** — 1.0.0→2.1.0 (Aug 20–21) then jumps to 8.1.0
    (Aug 24): the version was renumbered mid-project to match the "v8 engine" branding.
    Anyone mining history should not assume v3–v7 changelog entries exist (they are
    referenced — "fixed in v3.1.0" — but not recorded here).

11. **Docs describe at least three different eras simultaneously.** ARCHITECTURE.md still
    documents the snapshot/behaviour-hash system and 19 modules; IMPROVEMENTS.md
    recommends changes already made (profit-mode ranking) and names files by old numbers
    (`16-screenshot.js`); HANDOFF says "this branch has not merged to master" while
    PROGRESS says the merge is done; PROGRESS itself states both "47 checks" and "69
    checks" in different sections; FIRST-PRINCIPLES' recipe-ladder summary ("P3→P4:
    3 P3 inputs → 1") disagrees with DATA-SOURCES ("6+6+6→1") and with the actual data
    (6 each, some with 40×P1). The read-order docs (HANDOFF first) are the only reliable
    entry point; everything else needs a freshness check.

---

## 6. What to explicitly NOT carry forward

**Code and architecture:**
- The filename-prefix load-order scheme and the classic-script/no-module constraint that
  forces it. It caused the largest single class of production breakage ("alive but
  unwired") and forced data to live where load order demands, not where it belongs. A
  rebuild can keep the *shipped* artifact dependency-free while using real modules at
  build time.
- The v7-shaped result-card contract and the adapter that back-maps v8 results into it
  (`p4name`, stub `alloc` fields, leftover fields). Design the render model fresh.
- All legacy fallback machinery in `runCalculation`: the second world model, the
  no-program-hours candidate pool, `withPrices`/`fullyRanked` empty bindings, dead mode
  branches. "Better a P4-only answer than none" kept an entire shadow engine alive.
- Duplicate implementations: `computeNetRevenue` + `FINANCE_PRESETS` vs the engine ledger;
  `traceAnyCommodity`/`p1Requirements` vs `chainDemand`; `SPACE_PRESETS` (unreachable).
- Silent options objects. Any function taking an options bag should reject unknown keys
  (or the build should diff caller keys against callee reads) — this one mechanism
  produced the costliest shipped bug and two still-live ones.
- The greedy-inside-binary-search allocator as inherited shape. REBUILD-BRIEF Part 2 is
  explicit: restate it as the constrained integer optimisation it is; keep the *verified
  guarantees* (maximality vs units+1, monotone feasibility, conservation, the Y-1918
  3,712/3,822 reconciliation as a drift guard — never recalibrated against real scans),
  not the code. Buying inputs should be a supply source with a cost, not a threaded
  predicate; a profit objective should optimise ISK, not units-then-price.
- Character assignment that ignores per-character capacities (rebuild it against the
  actual `perCharacterPlanets` array from day one).
- The uncapped-density decision applied *inconsistently* (OCR clamps, quota rejects,
  mechanics floors-only). Pick one rule and enforce it at one chokepoint.

**Process:**
- Regex/string-surgery edits to source files (pattern H; whole-file writes with an
  immediate parse check, per OWNER-RULES).
- Carrying fixture numbers, constants, or tests forward without re-measuring
  (WORKING-AGREEMENT rule 7; the deleted-allocator fixture episode).
- Confidence self-grading language ("byte-verified") — attribute sources instead.
- Behaviour-hash snapshots as the sole regression net without at least one test that
  drives the real user entry point (the two-dead-modes incident).
- Hand-maintained version strings anywhere (two separate stale-version bugs; derive from
  the tag with one shared fallback, not two).

**Docs:**
- Keeping stale docs alongside current ones with no freshness marker. The rebuild should
  either regenerate reference docs in CI (the FUNCTION-REFERENCE idea in IMPROVEMENTS §4)
  or delete what it will not maintain.

---

## 7. Cross-checkable doc-vs-code contradictions (inventory for the rebuild)

| Claim in docs | What the code does |
|---|---|
| FINANCE-SOURCES / 14-finance presets: freight 500/900/1200/1500 ISK/m³ | 06-economics `SPACE_PRESETS`: 10/400/600/900, with a comment citing Red Frog at "roughly 5–15 ISK/m³ — NOT hundreds" (checked 2026-08-22). The two tables also disagree on lowsec/wormhole customs. |
| FIRST-PRINCIPLES §8: "Material efficiency research on composite recipes … Base values are used deliberately" | `chainDemand` defaults `compositeMePct = 10` **and** `compositeStructMatPct = 5.99` (best-possible rigged nullsec complex), i.e. ~15.4% material reduction applied to fuel-block/paste chains unless overridden. |
| DATA-SOURCES: "1,152,000 ÷ 290,112 = exactly 4 cycles/day" | 290,112 × 4 = 1,160,448; the ratio is ≈3.97. `15-engine.js` more honestly says "matches … to 0.7%". Both figures ship in comments. |
| README/OWNER-RULES: "every OCR read user-confirmed … never auto-accepted, at any confidence" | Batch import creates planets and sets `densitiesSet='1'` immediately; the user is *told* to check, not asked to confirm. |
| MISTAKE-INVENTORY: "tested for" by `tools/test-regressionclasses.js` | No such file exists in `tools/` on this branch. |
| PROGRESS "Build gate 69 checks" | Same file, lower section: "build gate 47"; README says 47; verify.js is the authority. |
| README: "Profit … ranks everything you can build by net ISK/week" and REBUILD-BRIEF: "rank all 83 by net ISK per slot and return the top 10" | profitStage1 ranks by total `netISK`, not ISK **per slot** (`iskPerSlot` is computed and carried but not the sort key) — the two formulations give different orders when slot usage differs. |
