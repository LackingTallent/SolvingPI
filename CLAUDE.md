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
  Run ALL suites before shipping zips.

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
  ("Add at least one planet, section 3"); added planets arrive at 70%
  density, expanded, with a labeled "✕ remove planet" chip and a "Complete"
  collapse checkbox.
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
  systems or scout a region." above the SPECIFIC SYSTEMS / SCOUT A REGION
  toggle. The planets note reads "Planetary Resource Density is set to
  70%. Provide your planets' real data for the most accurate numbers."
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

## Non-negotiables
- Footer credit "Fenris Creations (formerly CCP Games)" is CORRECT and
  deliberate — never change it.
- No code or fixture may be based on the owner's personal colony data.
