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

**"What do you want?" comes first.** Goals are listed A to Z with **Compare
pre-selected**, and the answer dictates what appears next: Max output, Quota
and Login budget ask for a product; **Compare shows no product dropdown at
all** — it ranks every product itself. Four goals:

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

Change the goal at any time — the section reshapes itself around your answer,
showing only what that goal needs.

**Sourcing defaults to mine-it.** Each input can be *extracted* (mined on
your planets), *refined* (buy ore, 150:1), or *bought* finished — and every
input starts pinned to **extract (mine it)**. Switch any input to **Suggested
(auto)** under Adjust sourcing and the tool picks for it: the heuristic
extracts what you have scanned and buys what you lack; when prices are
loaded, it re-solves all three alternatives per input through the full engine
and ledger and takes the best settled net. The result names every choice and its reason, including the
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
  assumed. The band is only demanded when an unscanned resource is one your
  chosen goal can actually use — a zero on an ore your product's chain never
  touches doesn't gate the solve. (Compare considers every product, so there
  any unscanned resource counts.)
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
- **The starter world is three planets** — Storm, Gas and Barren — because
  one character places only one colony per planet, and even a small chain
  needs three colonies (two extractors and a factory). A fresh visit can
  therefore Solve out of the box; swap the starters for your real planets as
  you go.
- **Planets load at a 70% default density** on every resource, so plans work
  the moment a planet exists; replace the defaults with real scans for real
  numbers. Each planet has a **Complete & Collapse** checkbox on the right
  that minimizes just that card — planets load minimized except the first,
  and each system header has a **Complete & Collapse All**.
- **Duplicate names are flagged as you type.** Two planets with the same name
  make a plan ambiguous, so the offending cards get an amber ⚠ tag the moment
  it happens instead of a refusal at solve time.
- **Removing a planet** is the small ✕ on its header row; it asks first and
  names the planet, since scans go with it.
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

**When the answer is no, it's a sentence, not a code.** A goal the engine
cannot meet is refused in plain English — what doesn't fit and why, e.g.
"This target needs 12 colonies, but your characters have 6 colony slots
between them." Placement refusals teach the rule behind them (one character,
one colony per planet). A quota refusal that knows your best achievable rate
says so and offers a one-click **Set target to N/wk** that re-solves
immediately. The raw engine text stays one click away under *Engine detail*
for bug reports.

Additional honesty on every result:

- The **Sourcing — chosen for you** card names each suggested choice with its
  reason, and whether the choice was price-compared or heuristic.
- The **ESTIMATE banner** appears whenever any number rests on a stand-in
  (assumed densities, preset/default costs) and lists each assumption with
  where to replace it. No banner = no assumptions.
- **Plan by character** — a dashboard of cards, one per character, each colony
  listed planet by planet: extractors (resource, program, density), factories,
  launchpads/storage, imports — plus the weekly shopping list for bought inputs.
  Every colony card carries a one-click **Copy template**: a byte-exact
  community template from the PI Templates library when one matches that
  planet type and product (shown with its name and credit), otherwise a
  layout generated by the same builders the Templates section uses — anything
  generated is flagged **⚠ generated — verify in game before trusting**.
  Every difference between template and plan (facility count, command-center
  level, encoded planet type) is listed under the button; nothing is silently
  "close enough". Refinery colonies have no template format to generate from
  and say so, with the by-hand build listed.
- **Build sheet** — the same plan as copy-paste text.
- **Insights** — bottleneck (add capacity there first), runway, optimality.
- **Deep analytics** — marginal character/skill value, buy-vs-make per input
  (all three alternatives fully re-solved), market saturation, patience
  premium, cadence (ISK/week vs ISK/login), and the sell-raw-P1 baseline.

## Saving, resetting, reporting

Autosaves to your browser as you type; **Save My Data** downloads a file,
**Load My Data** restores it. Nothing is uploaded anywhere and the tool never
asks for your EVE login. **Report a bug** pre-fills your build version, mode
and detail level. Reference sections are lookups, not steps: the **All PI
Chains Flow Visualization Tool** (pick any commodity → its full P0→P4 chain
drawn in four switchable layouts — Ladder, River, Radial, Planet lanes —
with the smallest planet-type set covering its ores; click any node to
re-root; nodes and planet chips wear the real in-game icons, fetched live
from CCP's image server via the same verified type-ID table the Market
Reference uses, with schematic-style glyphs standing in while they load or
offline), Market Reference, Price History, PI Templates, and System Status.
