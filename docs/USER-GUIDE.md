# Solving PI v9 — User Guide

This is the support document for the planner as shipped. It mirrors the
in-site help (the **? Help** button) and adds the detail that does not fit in
a modal. Section numbers below are the numbers on the page.

## The idea in one paragraph

You state a **goal**; the planner does the rest. It suggests where every input
should come from, can stand in defensible typical values for anything you have
not measured yet, and labels every number built on a stand-in as an estimate —
so you can get a useful answer in under a minute, then tighten it to exact as
you feed it your real scans, prices and rates. Nothing is ever assumed
silently: every assumption is named, on screen, next to the number it touched.

## Section 1 — Your Goal

**Pick a product and a goal.** Four goals:

| Goal | Question it answers | Needs prices? |
|---|---|---|
| Maximum output | "How much of X can my operation make?" | Optional (net shown when priced) |
| Weekly quota | "Fewest colonies to hit N per week?" | Optional |
| Login budget | "Best net within my sessions per week?" | Whole chain |
| Compare everything | "What SHOULD I be making?" | At least one |

Compare is a two-step flow: first the ranked list of every viable product
(with the excluded ones named, each with its reason), then you pick one —
**Plan this** — and get its full best path: per-character colonies, build
sheet and analytics. Your goal switches to that product so the choice stays
visible in section 1 and you can re-solve or adjust it.

Until a goal is picked, the rest of the section stays hidden — the goal is the
only thing the tool cannot suggest.

**Sourcing is suggested, not demanded.** Each input can be *extracted* (mined
on your planets), *refined* (buy ore, 150:1), or *bought* finished. By default
every input is on **Suggested (auto)**: the heuristic extracts what you have
scanned and buys what you lack; when prices are loaded, the tool re-solves all
three alternatives per input through the full engine and ledger and takes the
best settled net. The result names every choice and its reason, including the
ISK/week the losing alternatives were worth. Pin an input under *Adjust
sourcing* only to overrule the tool — pins are never second-guessed. On very
large worlds the interactive price comparison is skipped (and says so); the
Deep analytics button remains the thorough path.

**Detail level — the accuracy-for-convenience dial.**

- **Quick estimate** — answers immediately. Unscanned densities assume your
  security band's typical value (High sec 30%, Low sec 60%, Null sec 90%,
  Wormhole 100% — see `docs/PRESET-SOURCES.md` for the defense of those
  figures) and typical costs are prefilled into section 4. Every result built
  on a stand-in carries an amber **ESTIMATE** banner listing exactly what was
  assumed.
- **Refined** — your real scans are required for every extract-sourced input;
  typical cost presets are still allowed (results stay labeled).
- **Exact** — everything is yours: scans entered, and the cost rates either
  edited by you or confirmed with *These are my real rates* in section 4.
  Only Exact prints unlabeled numbers.

**Reset.** Every planner section has a ⟲ Reset button that clears only that
section back to defaults, after a confirm that names what will go.

## Section 2 — Your Operation

Each character is modeled individually — own skills, own planet budget (max 6
with Interplanetary Consolidation V). The tool sums what you tell it, never
multiplies one character by N. One **extraction program length** applies to
the whole operation; shorter programs yield more per week but cost more
logins (6h is full pace; 24h ≈ 81.5% of it; a week ≈ 34%).

## Section 3 — Your Systems & Planets

- **System search** loads a solar system's planets from ESI — names and types
  are game facts. Every planet of a given type carries the same fixed set of
  five raw resources, so those load too. What ESI does NOT publish is density:
  scan values are yours to enter (or Quick estimate stands them in).
- **Scan values** are the raw per-cycle number your survey window shows; the
  familiar % appears alongside (100% = the calibrated reference). Values above
  100% are real and never capped — but output never exceeds what the buildings
  can physically process.
- **Screenshot batch import** reads survey screenshots in your browser (up to
  20, or a zip). Check its work — it is a convenience, not a data source.
- **Flat density** applies one density to everything for a ballpark; the
  band buttons fill the same typical values the Quick level uses. Undo
  restores what you had.
- A planet's resource list is capped at its type's five legal resources — the
  game's rule, enforced.

## Section 4 — Costs & Market

- **Space-type presets** — one tap fills typical High/Low/Null/Wormhole rates
  (each button's tooltip carries its rationale; full sourcing in
  `docs/PRESET-SOURCES.md`). Presets are typical values, not yours: results
  stay labeled as estimates until you edit a field or press *These are my
  real rates*.
- **Customs** — the game taxes fixed base values per tier, not market price.
  High sec adds an NPC portion computed from your Customs Code Expertise;
  everywhere else only the POCO owner's rate applies.
- **Prices** — fetch live Jita order books, or type quotes. *Instant* hits
  existing orders (no broker fee, worse price); *patient* lists orders
  (broker fee, better price, if they fill). Both are priced honestly.
- **Freight** — ISK per m³ on real cargo volume, both directions.

## Section 5 — Results

Every solve reports: output/week, **answer quality** (exact for small
operations, or a measured "within X% of the best possible" bound), the
colonies used, and — when priced — net/week reconciled to a single ledger you
can open line by line. Losses show with a minus sign.

Additional honesty on every result:

- The **Sourcing — chosen for you** card names each suggested choice with its
  reason, and whether the choice was price-compared or heuristic.
- The **ESTIMATE banner** appears whenever any number rests on a stand-in
  (assumed densities, preset/default costs) and lists each assumption with
  where to replace it. No banner = no assumptions.
- **Plan by character** — a dashboard of cards, one per character, each colony
  listed planet by planet: extractors (resource, program, density), factories,
  launchpads/storage, imports — plus the weekly shopping list for bought inputs.
- **Build sheet** — the same plan as copy-paste text.
- **Insights** — bottleneck (add capacity there first), runway, optimality.
- **Deep analytics** — marginal character/skill value, buy-vs-make per input
  (all three alternatives fully re-solved), market saturation, patience
  premium, cadence (ISK/week vs ISK/login), and the sell-raw-P1 baseline.

## Saving, resetting, reporting

Autosaves to your browser as you type; **Save My Data** downloads a file,
**Load My Data** restores it. Nothing is uploaded anywhere and the tool never
asks for your EVE login. **Report a bug** pre-fills your build version, mode
and detail level. Reference sections (Market Reference, Price History, PI
Templates, System Status) are lookups, not steps.
