# 03 — Owner's Formula Reference ("Every formula, in words")

STATUS: VERIFIED 2026-08-25. Verdicts below, produced by (1) independent reimplementation of
CCP's published extraction formula from library file 10 — never their code — in
/home/claude/rebuild/verify/verify-owner-formulas.py, (2) arithmetic recomputation of every
figure, (3) CPU/PG feasibility from library file 11 constants, (4) code audit of the v8.3 build
(see 05-v8.3-state.md). The original document follows the verdict section verbatim.

## VERDICTS

**CONFIRMED (exact):**
- All throughput arithmetic: 53,760 P1/wk (20×48×8×7), 34,944 @65%, 36,180.48 @67.3%,
  150:1 raw ratio, 8,064,000 ore/wk, 840/facility-wk advanced, 20,160 @24, 168/facility-wk
  high-tech, 2,688 @16. Cycle counts match ground truth (30-min basic, 1-h adv/HT cycles).
- Decay table 6h=100% / 24h=81.5% / 168h=34.0% / 336h=21.9% and the 290,112 6h total:
  reproduce EXACTLY from CCP's published formula with w=13277.2694 and 30-min sub-cycles.
  The claim "from CCP's published decay curve, not an estimate" is true.
- Storage 2,400,000 raw units; per-tier volumes 0.005/0.19/0.75/3/50 m³ (SDE-verified,
  post-Viridian halved set — many guides still carry doubled values; ours are right).
- Customs: base-cost basis, base values 5/400/7,200/60,000/1,200,000, export = base×rate,
  import ×0.5, CC launch ×1.5, P4@10% = 120,000. Both player reports recompute exactly
  (Biomass 40 ISK; 70 Coolant @12% = 60,480 ISK). Matches CCP Rubicon + UniWiki.
- Refining comparison: 37.50 vs 20.00 ISK customs (1.875×, stated "about 1.9×" — fair) and
  0.75 vs 0.19 m³ freight (3.95×, stated "nearly 4×" — fair).
- Colony slots: 6/char at Interplanetary Consolidation V, sum-not-multiply, one colony per
  char per planet. Matches ground truth.
- CPU/PG feasibility at CC level 5: all three colony archetypes fit (extraction 81% PG,
  24-adv+pad+storage 97% PG, 16-HT 84-86% CPU).

**CORRECTED (right idea, needs adjustment in the rebuild):**
1. 30-min sub-cycles are a simplification. The game steps cycle time with program length
   (15 min ≤25h; 30 min ≤50h; 1h ≤100h; 2h ≤200h; 4h to 14d). Error is small — 290,238 vs
   290,112 at 6h (+0.04%); 22.1% vs 21.9% at 336h (~1% off) — but the rebuild should use the
   real step function since it's free to do so. Per-cycle integer truncation (community-
   observed, not in CCP docs) shifts totals by a few units at most.
2. Linear density scaling has a physical cap the model ignores. Output is computed as
   53,760 × density × decay-efficiency with no min() against what 8 basic facilities can
   process (48,000 P0/h → 53,760 P1/wk hard cap). At 100% density and 6h programs, supply
   (48,352/h) ≈ demand (48,000/h) so the approximation is nearly exact — that is what makes
   the current tool work. But at density >100% the engine claims P1 the facilities cannot
   make (and test-matrix asserts the unbounded scaling as intended). Densities over 100 ARE
   real as survey values; the excess P0 is real too — but turning it into P1 requires more
   basic industry (9-12 fit in CPU/PG) or storing/exporting raw. Rebuild rule:
   output = min(facility capacity, extractor supply ÷ 150), with layout as a variable.
3. "8 basic / 24 advanced / 16 high-tech" are conventions, not maxima. 25 advanced + pad
   fits CC5 (26 does not); 19 HT + pad fits (20 does not); 9+ basics fit alongside a
   10-head ECU. The archetypes are sane, logistics-friendly defaults — the rebuild should
   derive layouts from CPU/PG/route constraints and offer these as presets, not physics.
4. Sales-tax context: presets use 3.37% (Accounting V) — consistent with the 2025 patch
   raising base sales tax to 7.5%. Keep as user-editable parameter, never a constant; and
   v8.3 ships two disagreeing preset tables (3.37 vs 3.4) — one source of truth in rebuild.

**CLAIMED-BUT-NOT-INDEPENDENTLY-REPRODUCED (plausible, re-measure during rebuild):**
- Planner optimality: exact for single P1 (18 cases), gaps up to 33/20/14% at 4/6/8 slots,
  halving with scale. Their measurement scripts exist and the methodology (including two
  broken-oracle episodes caught honestly) is sound, but we did not re-run the exhaustive
  search. Rebuild plan: replace projection with an ILP/branch-and-bound reference solver —
  this also closes their own "still open" item.
- The 36-rule checker and its shared-constants limitation: accurately self-described.

**IMPORTANT CAVEAT — the doc describes the engine faithfully, but the v8.3 engine itself
still has wiring bugs** (see 05-v8.3-state.md): quota P3 throughput wired to the P2 constant;
quota shopping list always empty (purchases/bought key mismatch); purchases priced off the
Jita BUY side everywhere (understates input costs, flatters buy/refine strategies); Product
and QOL result cards hardcode customs/shipping/sales-tax to 0; primary QOL path ignores
sourcing; character dealer ignores per-char planet caps in uneven worlds (judge then rejects);
ME10+structure-bonus applied to composites by default against stated first principles. The
prose is more correct than the code — which is exactly why the rebuild starts from the math.

---

---

# Every formula, in words

What the planner actually calculates and where each number comes from. Written
so you can check our working rather than take it on trust — if a figure here
disagrees with what the tool shows you, one of them is wrong and we want to
know.

Every number below is asserted against the engine in `tools/test-engine.js`, so
the code and this page cannot drift apart silently.

---

## Extraction

**One extraction colony** is one extractor feeding eight basic industry
facilities. At full density it produces:

```
20 P1 per cycle × 48 cycles per day × 8 facilities × 7 days
= 53,760 P1 per week
```

Density scales that in a straight line. A planet at 65% gives 65% of it:

```
53,760 × 0.65 = 34,944 P1 per week
```

**Above 100% is real.** EVE's own survey reports densities over 100, and the
tool takes the number you type rather than capping it.

### Raw material per unit

A basic facility turns 3,000 raw units into 20 refined:

```
3,000 ÷ 20 = 150 raw units per 1 refined unit
```

That ratio matters far more than it looks — see *Sourcing* below.

### Extraction cycle length

An extractor's output decays over its program. A short cycle keeps you near
peak yield; a long one trades yield for not logging in.

| Program | You get |
|---|---|
| 6 hours | 100% of peak |
| 24 hours | 81.5% |
| 168 hours (weekly) | 34.0% |
| 336 hours (14 days, the cap) | 21.9% |

A 6-hour program on one extractor yields **290,112 units** in total. These come
from CCP's published decay curve, not an estimate.

---

## Factories

```
24 advanced factories × 840 per week = 20,160 P2 or P3 per week
16 high-tech factories × 168 per week =  2,688 P4 per week
```

---

## Storage

```
12,000 m³ ÷ 0.005 m³ per raw unit = 2,400,000 raw units
```

Per-unit volumes:

| Tier | m³ |
|---|---|
| P0 | 0.005 |
| P1 | 0.19 |
| P2 | 0.75 |
| P3 | 3 |
| P4 | 50 |

---

## Sourcing — three ways to get each input

Every P1 your chain needs can come from one of three places. You choose per
input, and they cost different things.

### Extract it

Mine it yourself. Costs a colony **with** an extractor, and only works on a
planet carrying that resource. Output depends on density, as above.

### Buy the ore and refine it

Same eight facilities, no extractor, and **density stops mattering** — the ore
is hauled in rather than pulled out of the ground, so a barren rock at 0% works
as well as anything. Still costs a colony slot.

```
a full refining colony imports 53,760 × 150 = 8,064,000 units of ore a week
```

### Buy the finished product

Costs no colony at all. Every slot you own becomes a factory.

---

## Why refining is usually the worse deal

It looks like the cheap middle option. Two costs work against it.

**Customs is charged per unit**, and you are importing 150 units instead of 1:

```
buy the finished P1    400 × 10% × 0.5       = 20.00 ISK tax
buy 150 units of ore     5 × 10% × 0.5 × 150 = 37.50 ISK tax
```

That is about **1.9× the customs**.

**Freight is worse**, because ore is bulkier for what it makes:

```
1 finished P1      0.19 m³
150 units of ore   0.005 × 150 = 0.75 m³
```

Nearly **4× the cargo** to haul.

So refining costs more tax, more freight, **and** a colony slot that buying the
finished product does not need. It only wins when ore is dramatically cheaper
than the refined goods — which does happen, which is why the tool warns rather
than refuses.

---

## Customs tax

EVE does **not** tax the market value. It taxes a fixed **base cost** per tier,
set by CCP and unmoved by price swings.

| Tier | Base cost |
|---|---|
| R0 (raw) | 5 ISK |
| P1 | 400 ISK |
| P2 | 7,200 ISK |
| P3 | 60,000 ISK |
| P4 | 1,200,000 ISK |

```
export fee = base cost × tax rate       (×1.5 if launched from a Command Center)
import fee = base cost × tax rate × 0.5
```

So a P4 at a 10% customs office costs **120,000 ISK** to export — not 10% of its
roughly 1.9M market price:

```
1,200,000 × 0.10 = 120,000   correct
1,900,000 × 0.10 = 190,000   wrong
```

**Source:** [EVE University — Colony management, Tax
Rates](https://wiki.eveuniversity.org/Colony_management#Tax_Rates). Cross-checked
against two independent player reports: one Biomass at 10% costs 40 ISK, and 70
Coolant at 12% cost 60,480 ISK. Both are asserted in the test suite.

---

## What you keep

```
net = gross − customs − sales tax − broker − freight − purchases − fees
```

Shipping is charged on real cargo volume, not per unit:

```
freight = cubic metres × your ISK-per-m³ rate
```

With every cost set to zero, **net equals gross exactly**. That identity is
asserted in the tests, so a rounding error cannot creep in unnoticed.

Losses are reported as negative numbers rather than floored at zero. A plan that
cannot pay for its inputs should say so.

---

## Colony slots

One character runs at most **6 planets**, and that needs Interplanetary
Consolidation V. One colony per character per planet — a second character can use
the same planet, the same character cannot.

```
total slots = the sum of each character's planet count
```

The tool adds up what you tell it rather than multiplying by the maximum. A main
with 6 and two alts with 1 each is **8 slots**, not 18.

---

## How the planner decides — and how good the answer is

The planner works out how much you can make by **trying a number, checking it
fits, and adjusting** — doubling until it fails, then narrowing down. For each
attempt it places colonies greedily: best planet first for each material, and
the scarcest material handled first so it claims the planets it needs before
anything else takes them.

It repeats that for every allowed number of extractor slices per colony (1 to
5) and keeps whichever gives the most, because *more per colony* is not the
same as *more in total* when planets rather than slots are the limit.

### Is that the best possible answer?

**For a single refined material, yes — exactly.** There is only one decision
(which planets to mine), so the best is simply the highest-yield planets, and
that is measured as an exact match across 18 cases.

**For anything further up the chain, very close but not provably exact.**
Deciding how many slots go to mining versus how many go to factories is a
harder problem, and the planner uses a good rule rather than an exhaustive
search.

Measured against a genuinely exhaustive search on small worlds:

| Colony slots | How much was left behind |
|---|---|
| 4 | up to 33% |
| 6 | up to 20% |
| 8 | up to 14% |

The gap **halves roughly every time the operation doubles in size** — it is a
rounding effect, worst when one misplaced colony out of four is a quarter of
everything. Real operations run far more than eight colonies, where the trend
points to a fraction of a percent.

That last part is a projection, not a measurement: worlds bigger than about
eight colonies cannot be exhaustively searched in any reasonable time. What is
measured is that the gap shrinks steadily with scale, and that the alarming
small numbers are the worst case rather than the normal one.

---

## What the plan checker does and does not prove

Every plan is checked by a separate piece of code before you see it, against
**36 distinct rules** — one colony per character per planet, six planets per
character, five extractor slices per colony, no mining a resource the planet
lacks, P4 assembly only on Barren or Temperate, no facility claiming more than
it can make, and nothing consumed that was not produced or bought.

The planner cannot approve its own work. An illegal plan is worse than no
plan, because you would go and build it.

**The limit, stated plainly:** the checker uses the same physics numbers the
planner does. If one of those numbers were wrong, both would agree and the
plan would pass. It proves a plan is **legal**, not that the physics behind it
is **right**.

Those numbers are checked a different way — against EVE University, against
real player reports, and against the test suite. Every one of them is on this
page so you can check them yourself.

---

## Rounding

Rounding is a last resort here, and it is disclosed where it happens.

**Where the tool rounds, it must:** facilities and colonies are whole things —
you cannot build 0.6 of a factory — and EVE's extraction cycles are discrete.

**Everywhere else it does not.** Yield keeps its fractions: 67.3% density gives
36,180.48 P1 per week, not 36,180. Tax and freight figures carry their decimals
through the whole calculation and are only rounded for display.

If a number looks suspiciously round, it is because the game made it that way,
not because we tidied it.
