# Project notes for AI sessions

## Hosting topology — do not get this wrong
- **solvingpi.com (production) is hosted on CLOUDFLARE.** Deploys happen by
  uploading the static site (dist/ contents: index.html, favicon.svg, css/,
  js/, legacy/) to Cloudflare — the owner does this via the dashboard.
- The **Netlify project `solvingpi`** does NOT serve the site: it only
  REDIRECTS to solvingpi.com. Never deploy to it.
- The **Netlify project `prototype-solvingpi`** (v9protofull / prototype URLs)
  is the v9 prototype target; the owner deploys there manually (drag-drop of
  the dist zip, or repo link using netlify.toml).

## Build
- `node tools/build.mjs` → dist/ (static, no server); `npm run gate7` for the
  full gate; `npm run matrix` + `node tools/ui-matrix.mjs` for the deep sweeps.
- Adversarial gates: `npx tsx tools/edge-matrix.ts` (engine/state edges) and
  `node tools/ui-edge.mjs` (browser edge attacks; also regenerates the
  design-review screenshots into ../shots/review/). `node tools/modes-sweep.mjs`
  drives every goal to its FINAL step (singles + blends + compare-pick on a
  cut-ranked product + profit) in a trap world with no Temperate planet.
  `npx tsx tools/diag-allocator.ts` is the ALLOCATOR QUALITY GATE (see the
  greedy/quota invariant below) — it exits 1 on regression.
  `npx tsx tools/honesty-audit.ts` is the MODE HONESTY AUDIT (owner ask
  2026-09-03): 176 checks that every mode does what its UI copy claims —
  compare ranks by net with nothing silently dropped and greedy order
  surviving exact re-solves; qol picks the best in-budget cadence; quota
  plans every reachable target and its refusals name an achievable rate
  that ITSELF plans; mixes hit their share targets with characters
  partitioned and no cross-line leakage; pins survive everywhere except
  the documented self-row buy→refine flip; certificates hold on
  degenerate worlds (1 planet, 50 chars, 6h/336h programs). Exits 1 on
  any broken claim. Run ALL suites before shipping zips.

## UX invariants (owner-approved, keep true)
- Refusals render as plain sentences via friendlyRefusal(); raw engine text
  stays behind the "Engine detail" disclosure. Quota refusals with an
  achievable rate offer one-click "Set target to N/wk".
- Starter roster is EMPTY — zero characters (owner spec 2026-09-01), and
  section 2 earns its ✓ only when the user presses “✓ Done adding
  characters” (charactersDone flag; reversible via “Edit characters”;
  legacy saves with characters migrate to done in sanitizeState).
- Starter world is EMPTY — zero planets (owner decision 2026-08-28,
  reversing the earlier 3-planet starter). The solve gate must name the fix
  ("Add at least one planet, section 3"); added planets arrive expanded
  with a labeled "✕ remove planet" chip and a "Complete" collapse checkbox,
  and with NO density until a space type is chosen (see ROUND-3 BUILD-OUT —
  the old 70% default is gone).
- Duplicate planet names flag inline (.v9-dup-tag) as typed.
- Resource input is DENSITY % (owner spec 2026-08-31): the % is the number
  users actually have (scan bar / screenshot reader), it converts to w via
  wFromDensityPct exactly once at the input, and that exact figure drives
  every calculation. The engine still runs on raw w internally — never make
  the UI ask for qty_per_cycle again, and never cap % above 100.
- Planet removal is a confirmed ✕ (title "Remove this planet"), never a
  labeled pill.
- Quick detail demands the security band only for ores the chosen goal can
  use (Compare: any zero counts).
- rerender() is re-entrancy-guarded — do not call render functions directly
  from event handlers; always go through rerender().
- The Adjust-sourcing <details> keeps its open state across rerenders
  (sourcingOpen module flag) — every pin change rerenders, and without the
  flag the panel collapsed on each choice (owner report 2026-08-31).
- Section 1 is "START HERE — What You Want" / "Select a Goal", and NO goal
  is pre-selected (owner 2026-09-02, reversing the pre-selected Compare):
  the user picks a radio, then presses Next →. autoAdvance never folds a
  section on FORWARD progress any more — Next buttons drive progression;
  it still opens a section when something newly missing points backward,
  and boot still opens the first incomplete step only. Section 2 has NO
  characters subhead (owner 2026-09-02): the empty state leads with a plain
  h3 "How many characters do you have?" (same size/color as "Select a
  Goal"), and the systems subhead is a plain h3 "Where? Either add your
  systems or scout a region." above the two "Where?" banners. The planets
  note teaches the band-first rule (no default density until the user picks
  their type of space — see ROUND-3 BUILD-OUT).
- STREAMLINE batch (owner-approved 2026-09-02): FOUR steps — 1 Goal (sec3),
  2 What You Have (sec1, with the characters editor nested as #sec0Body),
  3 Market (sec2), 4 Results (sec4). Simple/Advanced switch in the top
  cluster (state.advancedMode): Simple hides the How-exact radios, sourcing
  pins, blend builder, More tools, program length, price/cost tables (folded
  under "Edit prices & costs by hand") and deep analytics. Accuracy is
  INFERRED (state.autoDetail, inferDetailLevel — Advanced can force a
  level). "Where do you operate?" in Market sets costs AND spaceBand in one
  tap (applyCostPreset). Planets render as chip cards, one editor open at a
  time (planetEditing); the confirmed roster folds to one line. Every open
  step carries a Next → button, and the results verdict carries tweak chips
  ("Adjust where parts come from" / "+ Add a second product") that reveal
  those controls even in Simple (revealSourcing/revealMix).
- UI-review batch (owner-approved 2026-09-01): ONE STEP OPEN at a time
  (autoAdvance in renderStepChips — forward transitions fold the finished
  section and open the next; never fight a manual reopen), five step DOTS in
  the sticky bar, prices AUTO-FETCH on load (fillOnly — typed quotes never
  touched), empty section 2 offers quick-add ("How many characters?"),
  the "Where?" banners stay visible in EVERY state (only the tool panels
  below them appear on demand; power tools folded under "More tools"),
  results lead with a VERDICT card
  then Plan/Money/Why tabs, quickstart carries "Try an example" (fictional
  sample world only), and PLANNER/REFERENCE are two lenses on one page
  (body.v9-view-ref; jumps into reference cards switch the lens).
- Visible UI text stays SHORT — one line of guidance, details live in the
  Help guide. Resist re-growing section subs and explainer paragraphs.
- THEME (owner 2026-09-02, second pass): the owner tried the Flight Deck
  palette and REVERTED it — the carbon theme keeps the ORIGINAL neon
  palette (#22e8ff cyan, #ffc233 amber, #ff93e0 magenta, #4dffa0 green,
  glowing buttons). Do not re-mute it. What SURVIVED from Flight Deck is
  layout only: the .v9-mode goal rows (padded selectable rows, cyan
  selected highlight), cyan-filled .v9-next buttons, and the verdict tint
  — all expressed in the old palette at the end of static/css/03-v9.css.
  Daylight theme untouched. Visible text is sentence-cased with proper
  punctuation — keep new strings that way.
- SECTION 1+2 LOOK (owner pick 2026-09-02, from the "Ten Looks" canvas):
  section 1 uses the GOAL GRID — goals are selectable icon cards in a
  2-column grid (.v9-goalgrid/.v9-gcard, real radio kept visible in each
  card, stroke-SVG icon per goal, dashed hint card "Not sure? Compare
  finds the money for you.", single column under 700px). Section 2's
  "Where?" choices are the BANNERS described in the Region Scout note.
  Icons are inline stroke SVGs (stroke="currentColor"), never emoji.
- TYPE SCALE (owner 2026-09-02): three tiers, keep every new string on one.
  Titles = .section-title 30px (reference sections 26px, 02-app.css).
  Subtitles = in-section h3 via the .sec-body h3 rule at the end of
  03-v9.css (25px display face) — "Select a Goal", "How exact?", "Where?
  Either add your systems or scout a region.", etc. Subtext = .section-sub
  / .v9-muted at ~.9rem. Section 2's empty state puts "How many characters
  do you have?" + the count field + Create my roster on ONE row
  (.v9-quickadd-row).
- Multi-tier sourcing (owner spec 2026-08-30): intermediates (P2/P3) accept
  'make'|'buy' in sourcing — 'buy' cuts the chain there (subtree pruned,
  commodity imported+priced). Five goals incl. 'profit' (Maximize profits:
  auto product + sourcing). Compare/profit show global P1 preferences and
  respect pins; comparative() retries unfittable chains with a direct-input
  buy cut before excluding. Pins are NEVER overruled.
- Compare's "Plan this →" seeds sourcing from the ranked row's OWN
  result.sourcing (world-aware ore defaults beneath, user pins on top) so a
  product that ranked via a buy cut can always reproduce its plan — never
  reset the pick to extract/make-everything defaults (2026-08-31 sweep bug).
- Product mix (blend): percentages ALWAYS total exactly 100 — editing one
  line rebalances the others (normalizeMix), loads are normalized in
  sanitizeState, and the editor shows color dots + share bar + "Total: 100% ✓".
- ONE solve button: the sticky-bar SOLVE is the only solve control (the Goal
  section carries a breadcrumb, never a second button). The sticky info line
  is the next-step pilot light ("Next → Step N: …" / "Ready — press SOLVE")
  and section headers carry ✓/→ .v9-step-chip progress markers driven by
  updateSolveGate() — keep readiness messages naming their "(section N)" so
  stepOfMissing() can route them.
- Chains visualizer icons: REAL CCP icons at runtime via the legacy globals
  iconUrl()/TYPE_IDS (and planetIconUrl()/PLANET_TYPE_IDS) from
  static/legacy/01-data.js — the one type-id source of truth, shared with
  Market Reference. Drawn glyphs are the instant/offline fallback; never
  remove them, and never restate type ids elsewhere.

- Region Scout (owner spec 2026-08-31; switch reworked 2026-09-02): lives
  INSIDE section 2's "Where?" area. The old SPECIFIC SYSTEMS / SCOUT A
  REGION toggle is GONE — the two always-visible BANNERS are the switch
  (#chooseSearch "I know my system" / #chooseScout "Find me a home",
  .v9-banner with stroke-SVG icons, stacked full width, arrow at right;
  Load planets flips back to the systems view via showScoutView(false)). Ranks a region's systems for the
  current goal with phantom worlds — real planet types + security (baked
  static/map/universe-map.json from tools/gen-map.mjs when present, else
  live ESI crawl cached in localStorage), densities ASSUMED at band
  typicals. Scout output is ALWAYS labeled an estimate; the traffic column
  (ESI system_kills/system_jumps) stays separate from the ISK ranking; the
  scout never invents planet types (unknown ids skipped and disclosed).
  gen-map.mjs needs network — run it on the owner's machine, never fake
  its output. It reads CCP's OFFICIAL post-2025 SDE (the JSON-Lines zip
  from developers.eveonline.com/static-data; the old Fuzzwork CSV tables
  no longer exist — both .csv and .csv.bz2 404, owner-verified 2026-08-31).
  Zip is unpacked with plain Node zlib; planet names are the game's own
  "<system> <roman celestialIndex>" convention with uniqueName.en verbatim
  when CCP provides one. `node tools/gen-map-e2e.mjs` is its offline gate
  (mock SDE zip; needs the zip CLI, dev environments only).

- TRUTH-AUDIT MODEL FIXES (owner approved 2026-09-03, all built): T-06
  links are priced at DEFAULT_LINK_KM (700 km, constants.ts) and the
  archetype caps are DERIVED from what fits CC5 (maxThatFits in
  allocator.ts — currently extraction 10 basics, refinery 8, advanced 21,
  HT 16); never hardcode a facility cap again. T-07 extraction sizing is
  BUFFER-AWARE (bufferAwareExtraction, cached): the real cycle series is
  simulated against the launchpad buffer, overflow is charged, and the
  basics count maximizes DELIVERED P1. T-08 contested-deposit haircut:
  SolveWorld.stackingPenalty (engine default 0; the UI passes
  state.stackPenaltyPct, default 10%, dial in More tools) makes the k-th
  colony on the same (planet, resource) yield (1-penalty)^k — applied in
  countsFor, builtExtractFrom, and upperBound. T-09 slippage: quotes carry
  order-book depth (bids/asks, top 15 levels, prices.ts) and 'immediate'
  trades WALK the book for the weekly quantity (walkBook in modes.ts),
  with a slippage note past 0.5%. T-10 the "Where do you operate?" tap
  derives sales tax/broker from the ROSTER'S best Accounting/Broker
  Relations (tax.ts fns; presets only fill in with no roster). T-11
  customs is charged PER COLONY at its owner's Customs Code Expertise.
  T-12 bestPlacement tries stacked/spread x both input-priority orders
  (realized-sorted, dealer-certified) and the hill-climb includes -1/+1
  SWAP moves; solveQuota falls back to the max-rate build when target
  sizing lands short but capacity exists.
- BAND LIVES IN SECTION 2 (owner 2026-09-03): "Where do you operate?" sits
  at the BOTTOM of What You Have (after + Add planet). ONE tap sets
  fees/freight (skill-derived, see T-10), spaceBand, AND re-bands every
  ASSUMED density to the band typical. UiResource.assumed marks
  default/band values (~ on chips, dashed amber .v9-reschip-assumed);
  typing a density clears it; flat-rate and loaded/scouted planets set it.
  Assumed counts as UNSCANNED for detail inference and readiness. The
  "These are my real rates" button is RETIRED — editing any fee field
  owns the rates. Market (section 3) keeps prices + edit-by-hand only.
- GREEDY/QUOTA QUALITY (user-reported defects, fixed 2026-09-03 after the
  Reddit thread): (a) countsFor sizes extraction against a SHARED planet
  capacity ledger in the same scarcest-first/best-planet order place() uses
  (with matching localeCompare tiebreaks) — before, per-input independent
  sizing let placement starve the losing input and greedy bottomed out at
  ~36% of the fractional bound; (b) the greedy branch ends with a +1
  hill-climb over role counts (≤25 rounds) to close integrality gaps;
  (c) solveQuota ESCALATES the sizing rate (1.5× doubling + binary search
  for the smallest rate whose BUILT plan reaches the target) instead of
  refusing after one attempt — quotas at ≤ the solver's own max must NEVER
  refuse. tools/diag-allocator.ts enforces all three with hard floors; keep
  it green and keep the floors honest (raise them only with new measured
  headroom, never lower them to pass). Ranking was and stays by NET
  ISK/week (economics), not volume; within a fixed chain the two coincide.
- Footer credit "Fenris Creations (formerly CCP Games)" is CORRECT and
  deliberate — never change it.
- No code or fixture may be based on the owner's personal colony data.
- RECIPE CALCULATOR (owner ask 2026-09-03): reference section #secRecipe /
  src/ui/recipe.ts — pure SCHEMATICS math, no allocator: recipe lines
  (commodity + units + factories each), Direct-inputs vs Everything-from-
  raw-P0 breakdown, shopping list with ask-priced costs + m³ (unpriced
  named, never zeroed), intermediates with factory-hours, and a build-time
  estimate (ceil(cycles/factories) × cycleSeconds — final step only, and
  the copy says so). Quotes come from the same state.prices as the rest of
  the site (refreshRecipe() in rerender keeps them in step). Its
  "What can I build from my materials?" paste box (owner ask, same day)
  parses the game's inventory clipboard format (tabs; EU and US thousand
  separators both) plus plain "Name qty" lines, names unrecognized lines
  (never silently drops), and ranks every buildable product by
  instant-sell value — max units per product computed with a crafting
  CLOSURE (stocked intermediates spent first, remainder crafted from
  lower tiers; the per-row max assumes materials spent on that product
  alone, and the copy says so). "Plan batch ↑" loads a row into the
  calculator lines.
- SCOUT RANKING TRUTH (owner report 2026-09-03 — "rankings look
  alphabetical"): the alphabet was the TIEBREAK showing through. Two causes,
  both fixed in scout.ts: (1) comparative's second-chance buy-everything
  assembly cut let ANY system with one factory planet tie at the identical
  pure-assembly net (a 2-planet system tied an 8-planet one at 3.47B) —
  the scout now passes {secondChance:false} and only scores plans whose
  builtExtractP1 is non-empty ("ground unused" note otherwise); planner
  compare KEEPS its buy cuts (owner spec). (2) sort order is now feasible →
  net → headroomPerWeek (the plan's upper bound — more/better ground) →
  planet count → name-last-resort. scoutSystem/sortScoutRows are the API;
  the app scores ONE SYSTEM PER TICK with a live "Scoring X (i/n)…" counter
  (a whole-region compare scout is ~0.5s of solver per system — the old
  single synchronous call froze the page and read as a timeout). Scout
  worlds now carry the stackingPenalty. ui-matrix guards the planner
  ranking (strictly by net, never alphabetical, mostly distinct).

- ROUND-2 CRITICAL REVIEW (owner ask 2026-09-03, "critically examine our
  logic and algorithms"; three-lens audit — math, engineering, design):
  * UPPER BOUND VALIDITY (CRITICAL, fixed): upperBound() used to drain one
    planet's decayed colony stack fully before touching the next planet's
    fresh deposit — NOT a valid relaxation once stackingPenalty > 0 (the
    shipped default 10% already produced realized = 105% of "bound"; up to
    ~200% at high settings). Now each input's per-colony yields are pooled
    ACROSS planets and taken globally best-first; per-planet series are
    decreasing, so the global top-n is prefix-closed and dominates every
    integer placement. diag-allocator section 4 + two solver.test.ts tests
    guard it (worst realized/UB must stay ≤ 100%). Never re-introduce a
    per-planet drain walk in the bound.
  * walkBook overflow past the visible 15 levels no longer fills at the
    LAST level (was ~28% optimistic on thin books despite a "conservative"
    comment): the book's own price-vs-quantity slope is extrapolated
    linearly through the overflow — pessimistic on both sides (bids fall,
    asks rise) by construction.
  * Hill-climb skips +1 variants when totalColonies == slots (dead moves;
    swaps are the only reachable improvements there).
  * COMPARE/PROFIT ARE ASYNC: comparativeChunked() in app.ts solves 6
    candidates per tick with a "Ranking products… (i/n)" paint and yields
    between chunks (the old single synchronous comparative froze the tab
    8.5s at 50 characters). Test harnesses' solve-wait predicates must
    treat /^(Solving|Ranking products)/ as still-in-flight.
  * saveState() returns boolean; persist() says "Autosave FAILED" instead
    of lying "Autosaved" when localStorage is unavailable.
  * Price fetch carries an AbortController + 20s watchdog and clears
    priceFetchInFlight on BOTH exits — a hung ESI request can no longer
    wedge refresh until reload.
  * CACHE BUSTING: build.mjs stamps ?v=<sha> on index.html's script/CSS
    URLs AND on every relative import inside emitted modules. Local static
    servers (smoke/ui-*/walkthrough/modes-sweep) must strip query strings
    when resolving files.
  * DESIGN TRUTH: economics eco.notes (slippage/surplus/customs) render in
    the Money tab above the ledger; the bare "Answer quality" card is GONE
    (it duplicated optimalityInsight's % without its context — don't bring
    it back); the estimate banner discloses the stacking-interference dial
    and the 700 km link default; Help's "How exact are the numbers?" lists
    all model assumptions; the scout table shows a Headroom/wk column with
    a tie-note when nets tie; recipe headers carry their caveats ("Build
    time (final step only)" in p0 mode, "Max units (exclusive)").
  * Recipe paste parsing is capped at 2,000 lines (reported, not silent).
  * UiQuote declares bids?/asks? (depth persists with quotes; ~100KB).

- ROUND-3 BUILD-OUT (owner approved 2026-09-03 "lets go with whats worth
  doing next" + band-first densities):
  * NO DEFAULT DENSITY ("the type of space means a lot"): the blanket 70%
    default is GONE. defaultResources(type, band) — band null → w=0 blank
    resources (chips show "?", editor says "no density yet"), assumed:true;
    band chosen → that band's typical, marked ~. Selecting a space type
    (the "Where do you operate?" presets OR the data-band buttons) ALWAYS
    calls applyBandDensities(band): every assumed-or-blank density takes
    the band typical; typed scans never move. The solve gate (readiness
    quick rung) already demands the band while anything relevant is
    unscanned — a band-less blank world cannot solve.
  * SYSTEM'S OWN SPACE WINS: importSystem() now returns security +
    wormhole (J-space = id 31xxxxxx); bandOfSecurity(sec, wh) in
    presets.ts maps security→band (≥0.45 high, >0 low, else null; wh
    flag → wormhole). ESI system import and scout "Load planets" seed
    that system's planets at ITS OWN band typical, and when no space type
    was chosen yet they define it (applyCostPreset) with a status note.
  * SOLVE WORKER: src/ui/solve-worker.ts (module worker, engine imports
    only — the engine must STAY DOM-free). compare/profit rankings run
    off-thread with { id, progress/total } → { id, done, ranked,
    excluded } messages; comparativeChunked falls back to the Round-2
    main-thread chunk loop when workers are unavailable (identical
    results/order). build.mjs cache-busts `new URL('./x.js',
    import.meta.url)` worker entries too.
  * UNCERTAINTY BRACKETS: QUICK_DENSITY_RANGE_PCT (presets.ts) holds
    low/high anchors per band (high 20–45, low 40–85, null 60–125, WH
    70–140). uncertaintyLine() re-solves greedy at lo/hi with
    toWorld(state, assumedScale) — scaling ONLY assumed densities — and
    the verdict extras show "Range on this estimate: … lands between X
    and Y units/wk (A to B ISK/wk net)". Wired into max/quota/qol and
    profit; hidden when no assumed densities or no band.
  * BOUND TIGHTENED (still provably a relaxation): upperBound also
    enforces total per-planet command-center capacity (planets × chars —
    matches place()'s ledger) and the Barren/Temperate cap on high-tech
    colonies. The joint cross-input LP bound stays on the backlog (T-13).
  * Harness truths: a fresh added planet asserts EMPTY density inputs
    (ui-edge/ui-matrix); smoke asserts the "NO density until you pick
    your type of space" explainer; scout-load asserts assumed:true at
    the system's own band.

- ROUND-4 FULL VERIFICATION (owner ask 2026-09-03 "test for problems we
  have seen before… no mistakes"; three fresh adversarial agents, every
  finding fixed + regression-tested same day):
  * RANKING TRUTH ROOT CAUSE (the big one): defaultSourcing is
    availability-blind ("ore exists → extract") and comparative ranked on
    it alone — measured: Synthetic Oil reported at 25M when 318M was
    reachable by buying its P1s (a 44-place ranking error), and scout
    dominance broke again (a strict-superset system scored 11% of a worse
    one). comparative() now ranks every candidate at the BEST of three
    whole-chain postures (heuristic / buy-all-P1s / final-step-cut) and
    runs a per-input improvement sweep (sweepRankedRow, exported) on the
    top rows (sweepTop, default 20). Pins are never overruled; keepGround
    (scout) only admits plans that extract something; scout passes
    {keepGround:true, sweepTop:5}. CHUNKED ≡ WHOLE-RUN is load-bearing:
    worker and fallback chunk with {sweepTop:0}, merge, sort, then sweep
    the merged top rows — verified byte-identical to one comparative()
    call. Guarded by a solver.test.ts regression test. Economic compare is
    ~2s off-thread (was 0.5s) — truth over speed, and the worker absorbs it.
  * MIX subWorld dropped stackingPenalty/extraction (blend lines solved in
    a rosier world than the user's — a line could "meet" a target that is
    provably unreachable at the real penalty). Now { ...world, operation }
    so NO SolveWorld field can ever be silently dropped again. Regression
    test in solver.test.ts.
  * HAND-EDITED PRICES WERE A NO-OP once depth existed: sellPrice/buyPrice
    prefer bids/asks over bid/ask, so editing a quote changed nothing
    (measured: exactly 0 ISK delta). Editing bid/ask now DROPS the stale
    depth for that commodity; the next refresh brings both back fresh.
    ui-edge guards it.
  * ASYNC RACE GUARDS: solveRun (bumped per runSolve) — a superseded
    compare/profit completion or progress tick paints NOTHING; inputRev
    (bumped per persist) — a completion whose inputs changed mid-run
    renders WITH the stale banner. Both raced live in a browser before the
    fix (stale results posing as current; an abandoned compare stomping a
    newer max verdict). ui-edge has both race checks.
  * PRICE-FETCH WATCHDOG re-scoped PER REQUEST (20s each): the old
    whole-sequence 20s timer would spuriously abort ordinary full fetches
    (68 commodities ≈ 2 requests each ≈ 20s+ at normal latency).
  * SANITIZE hardening: prices must be an object of finite-bid/ask quotes;
    bids/asks must be arrays of finite positive {price, qty} in the right
    order (bids descending, asks ascending) or the depth is dropped;
    sellPrice/buyPrice use Array.isArray, never !== undefined. A corrupted
    save used to reach walkBook and die as "levels is not iterable".
    edge-matrix cell guards it.
  * estimateBanner: assumed densities with NO band chosen (legacy saves)
    now disclose as "unconfirmed stand-ins" — they used to slip through
    with no estimate labeling at the refined rung.
  * DOCS SYNC: the stale "70% default" claims in this file's UX-invariants
    were corrected (band-first is the truth); walkthrough.mjs captions
    updated (scout loads at the system's OWN band; the band scene is an
    "adjust any time", not a first-time setup — Load planets already set
    it). KNOWN OPERATIONAL CAVEAT: ?v= cache busting requires the host to
    ignore query strings on static assets (Cloudflare does; a host that
    treats them as part of the path serves a white page — smoke-test after
    any host migration).
  * VERIFIED SOUND under fresh attack: upperBound across 864 combos (worst
    realized/UB = 100.0000%), chunk determinism, second-chance economics
    honesty, greedy-order survival under exact re-solves, uncertainty
    brackets (76 checks, lo ≤ base ≤ hi), recipe closure, band re-banding,
    batch/ESI/scout assumed flags, Help/quickstart accuracy.

- ROUND-5 BACKLOG BUILD-OUT (owner order 2026-09-03 "fix t 13 14 16 17 18…
  not disclosure of a broken mechanic — fix it"; T-15 deliberately NOT in
  scope and stays disclosed):
  * T-13 JOINT UPPER BOUND: upperBound() now runs a LAGRANGIAN DUAL on the
    per-planet command-center caps. For any λ_p ≥ 0, colonies on planet p
    are priced (1+λ_p) and L(λ,x) = minCost − Σλ_p·chars lower-bounds the
    colonies any real plan needs (real plans have c_p ≤ chars), so
    L > slots proves x infeasible — VALID for every λ, λ=0 IS the Round-2/3
    bound, and the dual is searched (subgradient, ≤2 rounds × 30 iters)
    only when the λ=0 optimum oversubscribes a planet. Verified: 0
    violations over the 864-combo sweep + repro-stack-bound; measured
    certificates rose (Robotics 76→85%, Coolant →97-99%, 2-planet
    contention worlds 85-99.5%). diag-allocator gained section 5
    (contention floors) and its product FLOORS WERE RAISED (BN .80,
    RCM .78, OMA .78, Coolant .90, Robotics .80) — never lower them.
    Every λ the search visits yields a valid cut; looseness is the only
    failure mode, never invalidity. Do not "optimize" the dual in a way
    that uses a non-optimal primal allocation as if it were a bound.
  * T-14 CAPITAL + PAYBACK: src/engine/capital.ts computes one-time setup
    ISK from the ACTUAL plan (CC purchase 81,000 ISK NPC seed — VERIFIED
    vs EVE University 2026-09-03, constants.ts updated from null;
    cumulative CC_LEVELS upgrades to each colony's ccLevel; facilities at
    FACILITY prices; links/heads free). Money tab renders "Setup capital
    (one-time)" with payback days and a breakdown <details>. Ledger stays
    steady-state — capital is presented beside it, never mixed into
    weekly net. ui-matrix guards the card.
  * T-16 CCU-AWARE MIX PARTITION: partition() tries 4 deterministic
    dealings (slots-then-CCU / CCU-then-slots × hardest-first/reversed
    line order); every grouping is still subsetCarries-verified and
    judge-checked — extra attempts can only rescue feasible blends.
  * T-17 CONTINUOUS SCOUT DENSITIES: densityPctOfSecurity(sec, wormhole)
    in presets.ts interpolates the band typicals piecewise-linearly across
    EXACT security (anchors: 1.0→22, 0.7→30, 0.45→45, 0.25→60, 0.0→75,
    −0.5→90, −1.0→100; WH flat 100). Scout scoring AND Load-planets use
    it (loaded chips carry the per-system %); same-type systems tie only
    at identical security. Monotone-rising-as-sec-falls is unit-tested.
  * T-18 PAGED BOOKS + VENUE-CONSISTENT VOLUME: fetchPrices reads every
    x-pages page (cap 20; ESI pages are NOT price-ordered, so page 1
    alone could even misreport best bid/ask); app.ts fetchJson now
    forwards the x-pages header (it returned {} before). dailyVolume =
    regional 7-day average × the hub's share of the standing book
    (clamped 0.05..1) when a locationId is set; saturation copy says
    "your trade hub's estimated daily volume". data.test.ts has a paging
    test + the venue-scaled volume assertion.

- LIVE INFRA PRICES (owner ask 2026-09-04 "have the prices from eve uni
  pulled directly from the esi"): Command Centers are the ONLY capital
  component that trades on the market — facility placement fees and CC
  upgrade charges are FIXED game costs deducted on placement (no
  endpoint prices them; they stay spec constants). src/data/infra.ts
  holds the 8 CC names + type ids (VERIFIED vs EVE Ref market group
  1322, spot-checked per type page: Barren 2524, Gas 2534, Ice 2533,
  Lava 2549, Oceanic 2525, Plasma 2551, Storm 2550, Temperate 2254).
  refreshJitaPrices fetches their Jita 4-4 asks after every commodity
  refresh (fetchPrices {history:false} — new config flag) into
  state.infraPrices (sanitized like prices, kept APART from
  state.prices so commodity-only code — tierOf labels, chains — never
  meets a non-commodity name). capitalCost(plan, ccAskOf?) uses the
  live ask per colony's planet type, falls back to the 81,000 ISK NPC
  seed per colony, and reports ccLivePriced so the Money card says
  which it showed. Unit test guards the exact per-colony delta.
- LOOKBOOK "Plan Breakdown Lookbook" (owner ask 2026-09-04): design
  canvas artifact with 22 concepts for the character-by-character,
  planet-by-planet breakdown (cover + Options 01-22: RosterMatrix,
  CharacterCards, PlanetLedger, OutputHeatmap, Kanban, LedgerTable,
  CycleTimeline, CommandTree, FlowRibbons, OrbitMap, SparkStrip,
  BuildSheets, ColonyTickets, MasterDetail, Sunburst, FleetManifest,
  SwipeDeck, ChainFlow, SmallMultiples, SetupTracker, PilotDossier,
  OpsConsole). Working files in ../lookbook-breakdowns/. All sample
  data FICTIONAL (Ajax/Briar/Cinder in Vale/Rift) — owner colony data
  stays out per the standing rule. Each board names its strength and
  tradeoff; site's exact carbon tokens and type.
- SCREENSHOT IMPORT SURFACED (owner report 2026-09-04 "what happened to
  the screenshot import function"): the v8 OCR batch importer
  (static/legacy/23-screenshot.js + the __v9 deliverBatch/readPlanets
  bridge in app.ts) was never removed — the 2026-09-02 streamline hid
  it because the whole More-tools details was gated Advanced-only
  (`more.hidden = !showTools || !state.advancedMode`). Per owner's
  picked option ("Own button in Simple"): the batch panel now lives in
  its own `<div id="batchWrap" hidden>` OUTSIDE details#moreTools
  (panel head "Screenshot import"), and renderPlanets adds a
  #openBatchImport button ("Import scans from screenshots", camera
  SVG) beside + Add planet in BOTH Simple and Advanced; clicking it
  unhides #batchWrap and opens the #batchInput file picker. More-tools
  summary renamed "⚙ More tools — space presets & dials"; the rest of
  More tools stays Advanced-only. Help teaches the button. INVARIANT:
  the screenshot importer must stay reachable in Simple mode —
  ui-matrix check "simple mode: screenshot import has its own visible
  door" guards #openBatchImport + #batchWrap + #batchInput. Do not
  fold the batch panel back inside #moreTools.
