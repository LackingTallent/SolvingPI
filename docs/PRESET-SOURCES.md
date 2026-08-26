# Preset sources — the defense of every typical value

The planner ships two preset families. Both are EDITABLE PREFILLS and
STAND-INS, never silent constants: applying one is disclosed in the UI, and
every result built on one carries the ESTIMATE label until the user replaces
or confirms the values. This document is the audit trail for the figures.
Code: `src/ui/presets.ts` (the single source of truth — v8 shipped two
disagreeing preset tables; only the 06-economics one, which carried anchors,
was carried forward, corrected as noted below).

## 1. Space-type cost presets (section 4 prefills)

| Band | Customs (owner) | NPC portion | Sales tax | Broker | Freight ISK/m³ |
|---|---|---|---|---|---|
| High sec | 5% | modeled (flag on) | 3.375% | 1.5% | 10 |
| Low sec | 8% | none | 3.375% | 1.5% | 400 |
| Null sec | 5% | none | 3.375% | 1.5% | 600 |
| Wormhole | 5% | none | 3.375% | 1.5% | 900 |

**Customs.** Only high-sec POCOs carry an NPC tax portion, reduced by Customs
Code Expertise; elsewhere solely the structure owner's rate applies
(FIRST-PRINCIPLES §7 in the v8 library; restated in
`docs/library/15-logistics-costs.md`). v8 flattened high sec to "10% total";
v9 improves on that: the preset sets the typical player-owner rate (5%) and
turns the NPC flag on, letting the engine compute the NPC portion from the
character's actual skill instead of assuming Customs Code V. The 5%/8%/5%/5%
owner rates are typical player-set rates, not game constants — that is
exactly why they are presets.

**Sales tax 3.375%** = the 7.5% base halved by Accounting V (game skill math,
`src/spec/constants.ts`, cited there). **Broker 1.5%** assumes Broker
Relations V with decent standings — typical, not universal.

**Freight.** High sec is anchored: Red Frog hauls up to 845,000 m³ per
high-sec freighter trip for a reward in the single-digit millions of ISK
(checked 2026-08-22, v8 audit trail), putting real courier freight at roughly
5–15 ISK/m³ — NOT hundreds. Low/null/wormhole are jump-freighter-class
estimates: risk-priced services vary widely, so these deserve replacement
with a real quote more than any other preset figure, and the UI says so.

## 2. Quick-estimate densities (per security band)

| Band | Assumed density |
|---|---|
| High sec | 30% |
| Low sec | 60% |
| Null sec | 90% |
| Wormhole | 100% |

**What 100% means.** This build's % convention is calibrated:
100% = `DENSITY_REFERENCE_W` = 13,277.2694 raw units — the deposit that makes
one extractor produce exactly 290,112 units over a 6-hour program (the
community "Miner - 00" template; see `docs/library/10-extraction-mechanics.md`
and `02-legacy-formulas.md` §1.5). That template describes a healthy
null-class planet, which is why Wormhole sits at the reference and Null sec
just under it.

**Why these ratios.** CCP publishes NO density table — planet richness is
scan-only data, procedurally varied per planet. What is defensible is the
*relative* spread: community-reported yields consistently put null-sec and
wormhole planets at roughly 2–5× comparable high-sec planets. The ladder
30/60/90/100 places null ≈ 3× high — inside that consensus band — and rises
monotonically with the danger of the space, which is the game's design intent
for PI (riskier space, richer planets).

**What they are for.** Solely to stand in for scans the user has not entered
at the Quick detail level (and as one-tap fills in the flat-density panel).
They are never written into saved planet data by the Quick level, never used
at Refined/Exact, and every result computed from them is labeled an ESTIMATE
naming the count of assumed values and the band. A user's single real scan of
a planet always beats these numbers; the UI directs them there.

## 3. Where the disclosure is enforced

- `src/ui/app.ts` `estimateBanner()` — the ESTIMATE banner and its
  assumption list; `(estimate)` tag on the results summary.
- `src/ui/app.ts` `costsSourceLabel()` — the standing costs-provenance line
  in section 4 ("preset — typical values, not yours" / "your own rates").
- `src/ui/readiness.ts` — the Exact detail level refuses to solve until the
  cost rates are the user's own (edited or explicitly confirmed).
- `tests/goal-refinement.test.ts` — asserts the tables' invariants (NPC flag
  only in high sec, freight monotone with risk, density ladder monotone,
  null = 3× high, wormhole at the calibrated reference).
