# Solving PI — Legacy Formula & Constant Extraction

Every formula and hardcoded game constant the current code actually uses, quoted verbatim
from `/root/solvingpi-old/solving-pi/src/` (and `build.js`/`tools/` where relevant), with
`file:line` references (line numbers as read from this checkout). **⚠ flags** mark items
that look suspicious, inconsistent between modules, or unsourced — for cross-checking
against the owner's formula list and authoritative game data. Judgement is deliberately
minimal; precision first.

Suspicious-item quick index: §1.4 (fixed 30-min sub-cycles), §1.5 (calibrated qty base),
§2.6 (no BIF-throughput cap on efficiency>1 or density>100), §5.1 (PI tier volumes = half
of the commonly cited SDE values), §6.4/§6.5 (two disagreeing preset tables), §7
(duplicate economics path), §8.2 (buy prices taken from the buy side), §9.3 (fuel-block
item/BP type-id assignments), §11.1 (quota P3 throughput uses the P2 constant), §11.2
(quota `demand.purchases` never exists), §12 (three parallel recipe walks), §13 (OCR
clamps density at 100).

---

## 1. Extraction / ECU decay model

### 1.1 The decay function (CCP's published algorithm, as coded)

`src/js/03-mechanics.js:98-115`:

```js
function extractorTotalOutput(programHours, qtyPerCycle = PI_QTY_PER_CYCLE_BASE) {
  // Invalid input yields zero, never a phantom one-cycle run.
  if (!isFinite(programHours) || programHours <= 0) return 0;
  const totalCycles = Math.max(1, Math.round(programHours * 3600 / PI_SUB_CYCLE_SEC));
  const barWidth = PI_SUB_CYCLE_SEC / 900.0;
  let total = 0;
  for (let cycle = 0; cycle < totalCycles; cycle++) {
    const t = (cycle + 0.5) * barWidth;
    const decayValue = qtyPerCycle / (1 + t * PI_DECAY_FACTOR);
    const phaseShift = Math.pow(qtyPerCycle, 0.7);
    const sinA = Math.cos(phaseShift + t * (1 / 12));
    const sinB = Math.cos(phaseShift / 2 + t * 0.2);
    const sinC = Math.cos(t * 0.5);
    const sinStuff = Math.max((sinA + sinB + sinC) / 3, 0);
    total += barWidth * (decayValue * (1 + PI_NOISE_FACTOR * sinStuff));
  }
  return total;
}
```

Sourcing claim (comment `03-mechanics.js:80-82`): developers.eveonline.com/docs/guides/pi/,
"Dogma attributes: decay_factor = 1683, noise_factor = 1687" (those are attribute *IDs*;
the values used are §1.3). The trig structure matches CCP's published pseudocode
(t in 15-minute units via `/900`; cos terms at t/12, t/5, t/2; phaseShift = q^0.7).

### 1.2 Derived rates and efficiency

`src/js/03-mechanics.js:117-133`:

```js
function p0PerDayForProgram(programHours) {
  if (!isFinite(programHours) || programHours <= 0) return 0;
  return extractorTotalOutput(programHours) / (programHours / 24);
}
...
function extractionEfficiency(programHours) {
  return p0PerDayForProgram(programHours) / P0_PER_DAY_BASELINE;
}
```

`P0_PER_DAY_BASELINE = p0PerDayForProgram(6)` — `src/js/01-data.js:963`.
Efficiency **deliberately exceeds 1.0 below 6 hours** (comment 03-mechanics.js:126-130:
"DO NOT CLAMP THIS TO 1. It has been 'fixed' wrongly before"). Measured points quoted in
docs/PROGRESS.md:127: 6h→100%, 24h→81%, 168h→34%, 336h→22%.

### 1.3 Decay constants

`src/js/01-data.js:959-962`:

```js
const PI_DECAY_FACTOR = 0.012;
const PI_NOISE_FACTOR = 0.8;
const PI_QTY_PER_CYCLE_BASE = 13277.2694; // exact-solved; integer 13277 was 0.05% low
const PI_SUB_CYCLE_SEC = 1800; // 30-minute extractor sub-cycles
```

### 1.4 ⚠ Fixed 30-minute sub-cycles for every program length

The model always iterates 30-minute cycles (`PI_SUB_CYCLE_SEC = 1800`) with a fixed
`qtyPerCycle`, regardless of program length. In the game, longer ECU programs switch to
longer cycle times (1h/2h) with proportionally larger per-cycle quantities, and CCP's
algorithm takes cycle duration as an input. For programs whose in-game cycle time is not
30 min, this model's totals will deviate from the client's; nothing in code or docs
records that this was checked past 6h. The 24h/48h/7d percentages
(docs/DATA-SOURCES.md:74-75: "roughly 100% / 81% / 65% / 34%") come from this same model,
not from in-game measurements.

### 1.5 ⚠ Calibrated, not sourced: the per-cycle base quantity

`PI_QTY_PER_CYCLE_BASE = 13277.2694` is solved so that `extractorTotalOutput(6) === 290112`
exactly (asserted live in `tools/verify.js:492-504`, and `tools/fixtures.js:99`). 290,112
is the extractor route quantity in the community "Miner - 00" template
(docs/DATA-SOURCES.md:66-72). In-game, qty/cycle depends on head count, planetology
skills, and density — so this constant bakes in one specific template's configuration as
"100%". Any rebuild cross-check should confirm what head/skill configuration 290,112
corresponds to.

### 1.6 Cross-check arithmetic that doesn't quite close (⚠ documented as exact)

`src/js/03-mechanics.js:39-44` and docs/DATA-SOURCES.md:69 claim
"1,152,000 / 290,112 = exactly 4 cycles/day". Actually 290,112 × 4 = 1,160,448
(ratio ≈ 3.971). `src/js/15-engine.js:68-70` states the honest version: "matches the
README's independently stated 1,152,000 P0/day to 0.7%."

---

## 2. Extraction-colony weekly yield

### 2.1 The load-bearing constant

`src/js/01-data.js:953`:

```js
const P1_PER_EXTRACTION_COLONY = 53760;  // 7,680/day x 7, at 100% density (6hr program baseline)
```

Derivation (comment `03-mechanics.js:39-44`): one extractor feeding 8 Basic Industry
Facilities 24/7 needs 1,152,000 P0/day (8 × 3,000 per 30-min cycle × 48 cycles); at 150:1
that is 7,680 P1/day → 53,760/week. Source claimed: DalShooth README
(docs/DATA-SOURCES.md:44).

Related: `src/js/03-mechanics.js:44` `const BIF_DRAW_PER_DAY = 1152000;` (also re-declared
locally in `src/js/12-extraction.js:19`), `03-mechanics.js:53`
`const BASIC_FACILITIES_PER_COLONY = 8;`.

### 2.2 Weekly P1 per colony (density & program scaling)

`src/js/03-mechanics.js:139-148`:

```js
function weeklyP1PerColony(densityPct, programHours) {
  const d = Number(densityPct);
  /* No upper clamp. EVE's own scan reports above 100% ... Floor at 0 only. */
  const pct = isFinite(d) ? Math.max(0, d) : 0;
  const h = (isFinite(programHours) && programHours > 0)
    ? Math.min(programHours, PROGRAM_HOURS_MAX) : PROGRAM_HOURS_DEFAULT;
  return P1_PER_EXTRACTION_COLONY * (pct / 100) * extractionEfficiency(h);
}
```

`PROGRAM_HOURS_DEFAULT = 6`, `PROGRAM_HOURS_MAX = 336` — `03-mechanics.js:95-96`.
Density scaling is **linear** and unclamped above 100.

### 2.3 Multi-resource colonies (k ECU lines share the 8 BIFs)

Per-line yield is `base ÷ k`. In the validator (`src/js/04-world.js:171-174`):

```js
if (k > 0) {
  const p1 = P0_TO_P1[l.p0];
  flow(p1).produced += weeklyP1PerColony(dens, programHours) * (l.ecus / k);
}
```

In the allocator (`src/js/05-allocator.js:211`): `const perSlice = cand.weeklyP1 / k;`
`MAX_RESOURCES_PER_COLONY = 5` — `01-data.js:964`.

### 2.4 Program-hours readers

`src/js/15-engine.js:86-94` (`getProgramHours`: default 6, clamp ≤336) and the v8-side
duplicate `src/js/27-engine-adapter.js:170-174` (`readProgramHours`). QOL uses its own
`readQolInterval` (`27-engine-adapter.js:733-739`), defaulting to **24** rather than 6.

### 2.5 ⚠ Legacy candidate pool ignores program hours

`src/js/17-sourcing.js:455` builds extraction candidates with
`weeklyP1: weeklyP1PerColony(pct)` — no `programHours` argument, so the legacy/fallback
world always assumes the 6-hour baseline whatever the user set.

### 2.6 ⚠ No BIF-throughput ceiling

`weeklyP1PerColony` multiplies 53,760 by `eff` and by unclamped density. 53,760/week is
exactly what 8 saturated BIFs can refine; with `eff > 1` (short programs) and/or density
> 100 the model claims P1 above the facilities' processing capacity. Nothing caps it.

---

## 3. Factory / schematic cycle math

### 3.1 Cycle and per-facility throughput constants

`src/js/01-data.js:952-958`:

```js
const CYCLES_PER_WEEK = 24 * 7;          // 1-hour industry facility cycles
...
const ADV_FACILITIES_PER_COLONY = 24;    // CCU5: 2 factories x 12 Advanced
const HITECH_FACILITIES_PER_COLONY = 16; // CCU5: 2 factories x 8 High-Tech
const P2_OUT_PER_ADV  = CYCLES_PER_WEEK * 5;   // 840
const P3_OUT_PER_ADV  = CYCLES_PER_WEEK * 3;   // 504
const P4_OUT_PER_HITECH = CYCLES_PER_WEEK * 1; // 168
```

Also `src/js/03-mechanics.js:71`:
`const P1_DRAW_PER_ADV_WEEK = CYCLES_PER_WEEK * 80;` (comment: "One Advanced facility
consumes 80 P1-equivalents per cycle = 13,440/week" — defined but the allocator folds the
figure in rather than reading it).

⚠ Note there are **no CPU/powergrid constants anywhere in the codebase.** Colony capacity
is expressed purely as facility-count constants (8 Basic / 24 Advanced / 16 High-Tech at
CCU V), sourced to the DalShooth README (docs/DATA-SOURCES.md:46-47). Upgrade levels below
CCU V are not modelled at all (CC IV templates were deliberately dropped; CHANGELOG 8.1.0).
A rebuild wanting real CPU/PG budgets starts from zero here.

### 3.2 Facility/colony counts for a target rate (allocator)

`src/js/05-allocator.js:167-174` (P4):

```js
const facilities = Math.ceil(units / P4_OUT_PER_HITECH);
...
const colonies = Math.ceil(totalFac / HITECH_FACILITIES_PER_COLONY);
```

`src/js/05-allocator.js:251-258` (P3/P2):

```js
const outPer = tier === 'p3' ? P3_OUT_PER_ADV : P2_OUT_PER_ADV;
...
jobs.push({ product, facilities: Math.ceil(perUnit * unitsPerWeek / outPer) });
...
const colonies = Math.ceil(totalFac / ADV_FACILITIES_PER_COLONY);
```

Job capacity check in the judge (`src/js/04-world.js:203-212`):

```js
const capUnits = f * (tier === 'p2' ? P2_OUT_PER_ADV
                    : tier === 'p3' ? P3_OUT_PER_ADV
                    : P4_OUT_PER_HITECH);
const units = (j.unitsPerWeek == null) ? capUnits : Number(j.unitsPerWeek);
...
if (units > capUnits + WORLD_EPS) { err('job-overload', ...); }
```

`WORLD_EPS = 1e-6` — `04-world.js:28`.

### 3.3 Chain ratio validation cross-check

docs/DATA-SOURCES.md:49-54: EVE Uni's "two P2 factories per P3 input" rule reproduced:
1,680 P2 needed ÷ 840 per facility = exactly 2.0. Full saturated P4 line quoted as
1 P4 + 4 P3 + 16 P2 + 96 extraction = **117 colonies**.

---

## 4. The recipe ladder (chain ratios)

### 4.1 Recipe data

- `RECIPES_P2` — `src/js/01-data.js:131-300`: 24 products, each
  `{ inputs: [two P1 names], qty: 5 }` (all `qty: 5`).
- `RECIPES_P3` — `01-data.js:301-455`: 21 products, `{ inputs: [2 or 3 P2 names], qty: 3 }`
  (all `qty: 3`; six have 3 inputs).
- `RECIPES_P4` — `01-data.js:459-620`: 8 products, explicit
  `inputs: [[name, qty], ...]` — 6 of each P3 input; three recipes additionally take a
  **P1 at qty 40** (OMA: Bacteria 40; Sterile Conduits: Water 40; Nano-Factory:
  Reactive Metals 40). Every P4 carries `planetTypes: ["Barren","Temperate"]`.
- `P0_TO_P1` — `01-data.js:22-38` (15 pairs); `P1_TO_P0` inverse built at `01-data.js:965`.
- `TYPE_IDS` — `01-data.js:42-126`, all 83 commodities.
- `PLANET_RESOURCES` — `01-data.js:3-21` (note Ice = Planktic Colonies, the fixed bug).

### 4.2 Ratios as used in the canonical walk

`src/js/05-allocator.js:70-88` (`chainDemand`):

```js
if (tier === 'p1') { add(mined, name, units); return; }
if (tier === 'p0') { add(mined, P0_TO_P1[name], units / 150); return; }
if (tier === 'p2') {
  add(factory.p2, name, units);
  for (const input of RECIPES_P2[name].inputs)
    walk(input, units * 40 / RECIPES_P2[name].qty);   // 40 in per input, per 5 out → 8 P1/unit
  ...
if (tier === 'p3') {
  ...
    walk(input, units * 10 / RECIPES_P3[name].qty);   // 10 in per input, per 3 out
  ...
if (tier === 'p4') {
  ...
  for (const [input, qty] of RECIPES_P4[name].inputs)
    walk(input, units * qty);                          // 6 per P3 input (or 40 for the P1)
```

Same ratios in `p1Requirements` (`03-mechanics.js:176-197`: `40 / RECIPES_P2[name].qty`,
`10 / RECIPES_P3[name].qty`, `1 / 150` for P0), in the judge's consumption accounting
(`04-world.js:215-224`: `units * 40 / …qty`, `units * 10 / …qty`, `units * qty`), and in
`traceAnyCommodity` (`17-sourcing.js:106-132`, with
`const P0_PER_P1 = 3000 / 20;` at :106). The 3,000 P0 → 20 P1 basic-facility ratio (150:1)
is stated at `03-mechanics.js:179` ("// 3,000 P0 -> 20 P1").

Worked-example anchor: OMA = 1,320 P1 per unit (docs/FIRST-PRINCIPLES.md:67-70) — the
recipe data reproduces this exactly (6×~106.67 + 6×~106.67 + 40).

### 4.3 Lazy / self-contained P0→P2 math

`src/js/20-lazy-p2.js:38-53`:

```js
function lazyP2Throughput(option, densities){
  const P1_HALF = P1_PER_EXTRACTION_COLONY / 2;
  const lines = option.p0s.map((p0, i)=>{
    ...
    const pct = Math.max(0, Number(raw) || 0);   // see 03-mechanics: no upper clamp
    return { p0, p1: option.p1s[i], density: pct, weeklyP1: P1_HALF * (pct/100) };
  });
  // 40 of each input per cycle produces 5 output => 8 input units per output.
  const limiting = Math.min(...lines.map(l=>l.weeklyP1));
  const weeklyP2 = Math.floor(limiting / 8);
```

⚠ Note `lazyP2Throughput` ignores program hours entirely (always the 6h baseline),
whereas the engine-side equivalents scale by interval:
`src/js/09-modes.js:235-237` (`lazyPlan`):

```js
const perLine = p0s.map(p0 => weeklyP1PerColony(pl.resources[p0], h) / 2);
const weeklyP2 = Math.floor(Math.min(...perLine) / 8);
```

and the judge's lazy rule (`04-world.js:240-243`):

```js
const perLine = p0s.map(p0 =>
  weeklyP1PerColony((pl.resources || {})[p0], programHours) / 2);
const capUnits = Math.floor(Math.min(...perLine) / 8);
```

Lazy surplus & storage (`09-modes.js:239, 263-266`):

```js
const surplusP1 = Math.max(...perLine) - Math.min(...perLine);
...
const m3PerWeek = best.weeklyP2 * TIER_VOLUMES.p2 + best.surplusP1 * TIER_VOLUMES.p1;
const m3PerInterval = m3PerWeek * (h / (24 * 7));
const launchpadFillsIn = m3PerWeek > 0 ? (LAUNCHPAD_M3 / m3PerWeek) * 7 * 24 : Infinity; // hours
...
storageOk: m3PerInterval <= LAUNCHPAD_M3,
```

---

## 5. Volumes (m³ per unit)

### 5.1 PI tier volumes

`src/js/14-finance.js:101`:

```js
const TIER_VOLUMES = { p0:0.005, p1:0.19, p2:0.75, p3:3, p4:50 };
```

Claimed verification (comment 14-finance.js:86-100 and docs/DATA-SOURCES.md:10-25):
direct SDE/EVE-Ref fetches — P0 on 2 items, P1 on Water only, P2 on 2, P3 on 4, P4 on all
8; `INDIVIDUALLY_VERIFIED_VOLUME` set at `14-finance.js:114-122`; cross-check
12,000 ÷ 0.005 = exactly 2,400,000 P0 per Storage. A "community wiki page claiming
100 m³ [for P4] was checked and rejected as an outlier" (DATA-SOURCES.md:18).

⚠ **Cross-check priority.** These are exactly **half** of the long-standing commonly
cited PI volumes (P0 0.01 / P1 0.38 / P2 1.5 / P3 6 / P4 100). Either CCP halved PI
volumes at some point and the doc's "outlier" rejection of 100 m³ was rejecting the older
correct value's descendants, or the whole tier table is uniformly ½ of truth — which
would scale every freight cost and storage-fill figure by 2 in one direction. The
DalShooth cross-check (2,400,000 P0 per 12,000 m³ storage) is consistent with 0.005, so
the two sources at least agree with each other. Verify against the current SDE before
reuse; it silently rescales shipping on every product.

### 5.2 Facility storage volumes

`src/js/01-data.js:951` `const STORAGE_M3 = 12000;`
`src/js/03-mechanics.js:77` `const LAUNCHPAD_M3 = 10000;`
`src/js/15-engine.js:99` `const P0_VOLUME_M3 = 0.005;` (⚠ redundant with
`TIER_VOLUMES.p0`; used by the storage-fill readout `12-extraction.js:20`
`const capUnits = STORAGE_M3 / P0_VOLUME_M3;`).

### 5.3 Non-PI volumes (bought inputs)

`src/js/02-composites.js:112-118`:

```js
const NON_PI_VOLUMES = {
  'Heavy Water': 0.4, 'Liquid Ozone': 0.4, 'Strontium Clathrates': 3,
  'Nitrogen Isotopes': 0.03, 'Hydrogen Isotopes': 0.03,
  'Oxygen Isotopes': 0.03, 'Helium Isotopes': 0.03,
  'Tritanium': 0.01, 'Pyerite': 0.01, 'Zydrine': 0.01,
  'Small Tractor Beam I': 5,
};
```

Composite product volumes on the recipes (`02-composites.js`): fuel blocks `volume: 5`
(:35-57 — historic 100× bug was 0.05), Mobile Depot `50` (:66), Mobile Tractor Unit `100`
(:78), Nanite Repair Paste `0.01` (:83).

### 5.4 Volume resolution

`src/js/06-economics.js:116-124`:

```js
function volumeOf(name) {
  const tier = tierOf(name);
  if (tier) return TIER_VOLUMES[tier];
  if (typeof COMPOSITE_RECIPES !== 'undefined' && COMPOSITE_RECIPES[name] != null)
    return COMPOSITE_RECIPES[name].volume;
  if (typeof NON_PI_VOLUMES !== 'undefined' && NON_PI_VOLUMES[name] != null)
    return NON_PI_VOLUMES[name];
  return null;   // refuses rather than guessing
}
```

(The historical shadowing second `volumeOf` that made bought inputs ship free is deleted;
`14-finance.js:102-110` documents it.)

---

## 6. Customs / POCO, sales tax, broker fee, freight

### 6.1 Customs base costs and multipliers

`src/js/01-data.js:1010-1018`:

```js
const TIER_BASE_COSTS = { p0: 5, p1: 400, p2: 7200, p3: 60000, p4: 1200000 };
/* Import is charged at half the export rate. */
const CUSTOMS_IMPORT_MULTIPLIER = 0.5;
/* Launching from a Command Center instead of a Launchpad costs 1.5x. Not
 * applied automatically ... Exposed so a caller can opt in. */
const CUSTOMS_COMMAND_CENTER_MULTIPLIER = 1.5;
```

Formula (comment `01-data.js:994-995` and docs/DATA-SOURCES.md:169-172):
`Export fee = base cost × tax rate (×1.5 if via Command Center)`;
`Import fee = base cost × tax rate × 0.5`.
Source: EVE University Colony management → Tax Rates; cross-checked against two player
reports (1 Biomass @10% = 40 ISK; 70 Coolant @12% = 60,480 ISK), asserted in
`tools/test-engine.js` per the doc. `baseCostOf(name)` returns **null** (not 0) for
composites/non-PI (`01-data.js:1026-1029`).

⚠ `CUSTOMS_COMMAND_CENTER_MULTIPLIER` is defined but nothing ever applies it (grep: only
the declaration).

### 6.2 The engine ledger

`src/js/06-economics.js:126-193` (`computeEconomics`) — the load-bearing lines:

```js
const baseOut = baseCostOf(s.name);
if (baseOut != null) customsBase += s.unitsPerWeek * baseOut;                    // :151-152
...
const baseIn = baseCostOf(p.name);
if (baseIn != null) customsBase += p.unitsPerWeek * baseIn * CUSTOMS_IMPORT_MULTIPLIER; // :167-168
...
const customs = customsBase * (c.customsPct / 100);        // :175
const salesTax = gross * (c.salesTaxPct / 100);            // :176
const broker = gross * (c.brokerPct / 100);                // :177
const freightOut = volumeOutM3 * c.freightPerM3;           // :178
const freightIn = volumeInM3 * c.freightPerM3;             // :179
...
const net = gross - customs - salesTax - broker - freightOut - freightIn - purchaseCost - feesISK; // :188
```

Percentages act on transaction value (never compounding); freight charged both directions
at the same rate; identity `net === gross` when all costs are zero (header contract,
`06-economics.js:5-10`).

⚠ The import-customs charge is applied to **every purchase**, including a `buyall`/hybrid
plan's P1s (correct: they land on a factory planet) — but also to any purchased item with
a tier even if the plan might consume it off-planet; and conversely `customsPct` is a
single knob covering both export and import legs at the same rate (real POCOs can differ
per structure). Modeling choice, not a bug — but note it for the formula comparison.

### 6.3 Skill-derived rates (documented, encoded only in presets/help text)

`src/js/14-finance.js:7-16` (comment): sales tax "base 7.5%, reduced 11% per Accounting
level → 3.375% at V"; broker "base 3%, reduced 0.3 points per Broker Relations level →
1.5% at V, 1% with maximum standings; charged ONLY when you create a sell order"; customs
"Highsec NPC 10% export, reduced 10% per level of Customs Code Expertise → 5% at V, PLUS
the POCO owner's rate; the skill does NOTHING in low/null/wormhole".
docs/FINANCE-SOURCES.md:12 gives the sales-tax formula
`7.5% × (1 − 0.11 × Accounting)`. **No skill-based computation exists in code** — the
user enters final percentages; presets embed the level-V values.

### 6.4 ⚠ Preset table #1 (engine — appears unreachable from the UI)

`src/js/06-economics.js:44-50`:

```js
const SPACE_PRESETS = {
  none:     { label: 'No costs (default)', customsPct: 0,  salesTaxPct: 0,    brokerPct: 0,   freightPerM3: 0 },
  highsec:  { label: 'High sec (typical)', customsPct: 10, salesTaxPct: 3.37, brokerPct: 1.5, freightPerM3: 10 },
  lowsec:   { label: 'Low sec (typical)',  customsPct: 8,  salesTaxPct: 3.37, brokerPct: 1.5, freightPerM3: 400 },
  nullsec:  { label: 'Null sec (typical)', customsPct: 5,  salesTaxPct: 3.37, brokerPct: 1.5, freightPerM3: 600 },
  wormhole: { label: 'Wormhole (typical)', customsPct: 5,  salesTaxPct: 3.37, brokerPct: 1.5, freightPerM3: 900 },
};
```

Comment at :34-38 anchors highsec freight at "roughly 5-15 ISK/m3 — NOT hundreds"
(Red Frog, checked 2026-08-22).

### 6.5 ⚠ Preset table #2 (the one the UI actually uses) — disagrees with #1

`src/js/14-finance.js:39-58` (`FINANCE_PRESETS`), values field only:

```js
zero:     { jitaPct:100, shipCost:0,    customsTax:0,  salesTax:0,   otherTax:0 }
highsec:  { jitaPct:95,  shipCost:500,  customsTax:10, salesTax:3.4, otherTax:0 }
lowsec:   { jitaPct:95,  shipCost:900,  customsTax:5,  salesTax:3.4, otherTax:0 }
nullsec:  { jitaPct:95,  shipCost:1200, customsTax:5,  salesTax:3.4, otherTax:1.5 }
wormhole: { jitaPct:90,  shipCost:1500, customsTax:0,  salesTax:3.4, otherTax:0 }
```

Discrepancies vs §6.4: freight 500 vs 10 (highsec), 900 vs 400, 1200 vs 600, 1500 vs 900;
customs lowsec 5 vs 8; wormhole 0 vs 5; sales tax 3.4 vs 3.37. docs/FINANCE-SOURCES.md
matches table #2. Two "typical cost" truths ship in one artifact.

### 6.6 Finance defaults and input ranges

`src/js/14-finance.js:26-35` (`FINANCE_SETTINGS`): `jitaPct` 0–100 step 1 default **100**;
`shipCost` 0–5000 step 10 default 0; `customsTax` 0–50 step **0.01** default 0
(step was 0.5 — rejected a real 0.2% rate; CHANGELOG 8.2.0); `salesTax` 0–15 step 0.01
default 0; `otherTax` 0–25 step 0.5 default 0. All-zero default = zero-cost identity.

### 6.7 Adapter mapping (UI keys → engine keys)

`src/js/27-engine-adapter.js:142-156`:

```js
costs: {
  customsPct: Number(fin.customsTax) || 0,
  salesTaxPct: Number(fin.salesTax) || 0,
  brokerPct: Number(fin.otherTax) || 0,
  freightPerM3: Number(fin.shipCost) || 0,
},
sellSpec: { basis: 'pctJBV', pct: Number(fin.jitaPct) || 100 },
buySpec: { basis: 'jitaSell' },
```

(The historical `customsTaxPct`/`otherTaxPct` mismatch — customs & broker silently never
charged — is documented at :130-141.)

---

## 7. ⚠ The second economics implementation (still live)

`src/js/14-finance.js:135-170` (`computeNetRevenue`) — used by the live finance readout
(`updateFinanceReadout`, :124-132) and the QOL/lazy fallback (`rankLazy`,
`17-sourcing.js:355`):

```js
const units = Math.floor(r.maxUnits);
const vol = volumeOf(r.p4name) || 0;
const gross = (r.price!=null) ? units * r.price * (fin.jitaPct/100) : null;
const totalM3 = units * vol;
const shipping = totalM3 * fin.shipCost;
...
const baseEach = (typeof baseCostOf === 'function') ? baseCostOf(r.p4name) : null;
const customsTaxAmt = (baseEach != null) ? units * baseEach * (fin.customsTax/100) : 0;
...
const salesTaxAmt = gross!=null ? gross * (fin.salesTax/100) : null;
const otherTaxAmt = gross!=null ? gross * (fin.otherTax/100) : null;
const afterCustoms = gross!=null ? gross - customsTaxAmt : null;
const afterShipping = afterCustoms!=null ? afterCustoms - shipping : null;
const net = afterShipping!=null ? afterShipping - salesTaxAmt - otherTaxAmt : null;
```

Same intended semantics as §6.2 (taxes on gross; customs on base cost) but: no purchase
cost, no inbound freight, no fee lines, `|| 0` on volume (a missing volume ships free here
where the engine refuses), and `Math.floor(r.maxUnits)`. Two ledgers must be kept in
agreement by hand.

---

## 8. Price bases and market math

### 8.1 Price-basis resolution (engine)

`src/js/06-economics.js:60-100`:

```js
// sell 'pctJBV':  return { ok: true, isk: mkt.buy * (pct / 100), ... }        // :67
// sell 'split':   return { ok: true, isk: (mkt.buy + mkt.sell) / 2, ... }     // :72
// sell 'target':  user ISK verbatim                                            // :74-78
// buy 'jitaSell': return { ok: true, isk: mkt.sell, ... }                      // :84-86
// buy 'defined':  user ISK verbatim                                            // :88-91
// buy 'avg14':    requires mkt.avg14Days >= 14, else refuses                   // :93-97
```

⚠ `split`/`avg14` are dead in practice: no caller ever supplies `avg14`, and the adapter
always sends `pctJBV` + `jitaSell`.

### 8.2 ⚠ The market snapshot feeds the same number to both sides

`src/js/15-engine.js:149-165` (`fetchJitaPriceUncached`) fetches **buy** orders only and
returns the max, filtered to Jita 4-4 (`JITA_STATION_ID = 60003760`, :120; region
fallback if no station orders). The adapter then builds
`market[name] = { buy: price, sell: price }` (`27-engine-adapter.js:201`, :411, :781).
Consequence: `buySpec {basis:'jitaSell'}` prices purchased inputs at the **Jita buy**
price — understating acquisition cost wherever the v8 economics path runs (profit,
product, QOL modes).

### 8.3 Order-book depth math (legacy buy path — walks the real sell book)

`src/js/15-engine.js:209-242`:

```js
function costToAcquire(depth, qty){
  ...
  for(const o of depth.sellOrders){
    if(remaining <= 0) break;
    const take = Math.min(remaining, o.volume);
    total += take * o.price;
    worstPrice = o.price;
    filled += take; remaining -= take;
  }
  return { total, filled, shortfall: remaining,
    avgPrice: filled > 0 ? total/filled : 0, worstPrice };
}
function buyOrderTargets(depth, qty){
  ...
  const min = depth.bestBuy != null ? depth.bestBuy + 0.01 : null;  // top bid + 0.01 ISK
  const max = depth.bestSell;                                      // above this, instant-buy
  return { min, max, target: acq.filled > 0 ? acq.avgPrice : null,
    instantBuyTotal: acq.total, shortfall: acq.shortfall,
    availableVolume: depth.totalSellVolume };
}
```

⚠ Reachable only from `computeInputCosts` (`17-sourcing.js:587-599`), which serves the
now-empty legacy ranking — depth-priced purchasing effectively dead on v8 paths.

### 8.4 ESI request/limit constants

`01-data.js:621` `const JITA_REGION_ID = 10000002;` · `:697` `ESI_UA` string · `:721`
`const ESI_COMPATIBILITY_DATE = '2026-08-01';` · `:726` `ESI_BASE` ·
pacing threshold `(remaining/total) < 0.2 → slowed` (:802), extra 250 ms delay when slowed
(:821), single 429 retry with `Retry-After` capped 60 s (:828-834). Price fetch batching
`BATCH = 8` (`27-engine-adapter.js:194`, :775; `22-panels.js:67`). Session price cache
(`15-engine.js:138-147`), cleared per Calculate click (`17-sourcing.js:138-141`).
Per-goal ESI budgets pinned in `tools/fixtures.js:140-142`
(`maxCallsProfit: 100, maxCallsProduct: 25, maxCallsQol: 40`).

---

## 9. Composites & industry manufacturing

### 9.1 Composite recipes

`src/js/02-composites.js:33-87` — per run: fuel blocks output 40 from
`pi: {Robotics:1, 'Enriched Uranium':4, 'Mechanical Parts':4, Coolant:9, Oxygen:22}`,
`nonPi: {'Strontium Clathrates':20, 'Heavy Water':170, 'Liquid Ozone':350, <Isotope>:450}`;
Nanite Repair Paste output 10 from `{'Gel-Matrix Biopaste':1, Nanites:4, 'Data Chips':1}`;
Mobile Depot 1 from `{'Smartfab Units':3, 'Nuclear Reactors':1, 'Guidance Systems':3,
'High-Tech Transmitters':1}` + `{Tritanium:5556, Pyerite:222, Zydrine:444}`;
Mobile Tractor Unit 1 from `{'Organic Mortar Applicators':2, 'Wetware Mainframe':1,
'Ukomi Superconductors':2}` + `{Zydrine:948, 'Small Tractor Beam I':1}`.
Sources claimed: Skoli + Grokipedia + EVEInfo for fuel blocks (EVEInfo's 167/167/444
identified as ME-adjusted and rejected); EVE Ref/SDE for the rest.

### 9.2 Composite demand scaling (ME applied in the chain walk)

`src/js/05-allocator.js:46-48, 61-67`:

```js
const me = opts.compositeMePct != null ? opts.compositeMePct : 10;
const structMat = opts.compositeStructMatPct != null ? opts.compositeStructMatPct : 5.99;
const compositeMult = (1 - me / 100) * (1 - structMat / 100);
...
for (const [item, qty] of Object.entries(comp.pi))
  walk(item, units * qty * compositeMult / comp.output);
for (const [item, qty] of Object.entries(comp.nonPi || {}))
  add(bought, item, units * qty * compositeMult / comp.output);
```

⚠ Defaults assume ME 10 **and** the best possible structure bonus (5.99%) — contradicting
docs/FIRST-PRINCIPLES.md §8 ("Base values are used deliberately"). Continuous (non-ceiled)
view, acknowledged in the comment (:39-45) as differing from per-job ceil by ≤1 unit per
material per job.

### 9.3 Manufacturing blueprints & type IDs

`src/js/07-manufacturing.js:33-39`:

```js
const MANUFACTURING_BLUEPRINTS = {
  'Nitrogen Fuel Block':  { bpTypeId: 4314, baseTimeSec: 900, runOutput: 40 },
  'Hydrogen Fuel Block':  { bpTypeId: 4316, baseTimeSec: 900, runOutput: 40 },
  'Helium Fuel Block':    { bpTypeId: 4315, baseTimeSec: 900, runOutput: 40 },
  'Oxygen Fuel Block':    { bpTypeId: 4313, baseTimeSec: 900, runOutput: 40 },
  'Nanite Repair Paste':  { bpTypeId: 2739, baseTimeSec: 300, runOutput: 10 },
};
```

Item type IDs (`02-composites.js`): Nitrogen FB **4051**, Hydrogen FB **4312**, Helium FB
**4247**, Oxygen FB **4246**; paste 28668; depot 33474; MTU 33475.
`NON_PI_TYPE_IDS` (`02-composites.js:90-96`): Tritanium 34, Pyerite 35, Zydrine 39,
Small Tractor Beam I 24348, Heavy Water 16272, Liquid Ozone 16273, Strontium 16275,
isotopes 17888/17889/17887/16274.

⚠ **Cross-check the fuel-block item IDs**: commonly cited SDE values are 4051 Nitrogen,
4246 **Hydrogen**, 4247 Helium, 4312 **Oxygen** — the code assigns 4312→Hydrogen and
4246→Oxygen, i.e. possibly swapped (would swap the two blocks' live prices/icons, not the
identical planet plan). The comment block (07-manufacturing.js:26-29) claims a live
EVE-Ref verification on 2026-08-22 for the BP ids; the paste BP id 2739 and the
4313–4316 BP assignments deserve the same swap-check. Isotope IDs also worth confirming
(17887 vs 17888 assignments — same swap risk class).

### 9.4 Industry time & materials

`src/js/07-manufacturing.js:44-46, 56-57`:

```js
const TIME_MULT_INDUSTRY_V = 0.80;        // Industry V: -4%/level
const TIME_MULT_ADV_INDUSTRY_V = 0.85;    // Advanced Industry V: -3%/level
const TIME_MULT_BEST_IMPLANT = 0.96;      // Zainou 'Beancounter' BX-804: -4%
...
const STRUCTURE_TIME_BONUS_MAX_PCT = 65.28;     // Sotiyo 30% + T2 time rig in null/WH
const STRUCTURE_MATERIAL_BONUS_MAX_PCT = 5.99;  // EC hull 1% + T2 rig w/ 25% EC boost
```

`materialsForJob` — EVE's per-job material formula (`07-manufacturing.js:81-85`):

```js
function materialsForJob(baseQty, runs, mePct, structureMaterialBonusPct) {
  const modifier = (1 - (mePct || 0) / 100) * (1 - (structureMaterialBonusPct || 0) / 100);
  const raw = Math.round(baseQty * runs * modifier * 100) / 100;
  return Math.max(runs, Math.ceil(raw - 1e-9));
}
```

(Comment states the game rule: `max(runs, ceil(round(base * runs * materialModifier, 2)))`.)

`timePerRunSec` (`:87-94`):

```js
return baseTimeSec * (1 - (tePct || 0) / 100)
  * TIME_MULT_INDUSTRY_V * TIME_MULT_ADV_INDUSTRY_V * TIME_MULT_BEST_IMPLANT
  * (1 - (structureTimeBonusPct || 0) / 100);
```

Plan (`:99-134`): `runsPerWeek = Math.ceil(unitsPerWeek / bp.runOutput)`;
`hoursPerWeek = runsPerWeek * perRunSec / 3600`;
`slotsNeeded = Math.max(1, Math.ceil(hoursPerWeek / (24 * 7)))`;
`feesISK = jobFeePerRunISK * runsPerWeek` only when the user entered a fee
(`jobFeePerRunISK: null` default = "not entered; NEVER treated as zero silently", :63).
Defaults ME 10 / TE 20 / max structure bonuses (`MANUFACTURING_DEFAULTS`, :59-64).

⚠ The **time** side assumes max skills + best implant unconditionally (not user-editable
in the settings object beyond structure/TE), while the **material** side is user-editable
— asymmetric assumption, disclosed in `MANUFACTURING_DISCLOSURE` (:66-76).

---

## 10. The allocator's numeric machinery

### 10.1 Search

`src/js/05-allocator.js:358-381`:

```js
function maxUnitsAtK(ctx, k) {
  if (!placeUnits(ctx, 1, k).ok) return 0;
  let lo = 1, hi = 2;
  const CEIL = 1e9;
  while (hi < CEIL && placeUnits(ctx, hi, k).ok) hi *= 2;
  hi = Math.min(hi, CEIL);
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (placeUnits(ctx, mid, k).ok) lo = mid; else hi = mid - 1;
  }
  return lo;
}
function maxUnits(ctx) {
  let best = { units: 0, k: 1 };
  for (let k = 1; k <= MAX_RESOURCES_PER_COLONY; k++) { ... }
}
```

Binary search on integer units over a greedy scarcest-resource-first feasibility test,
best of k = 1..5; maximality asserted by testing `units + 1` unplaceable
(`allocateMax`, :399). Explicitly labelled a heuristic with empirical guarantees
(header :10-17).

### 10.2 Extraction placement arithmetic

`src/js/05-allocator.js:206-244` — the slice ledger:

```js
const needed = demand.mined.get(p1) * unitsPerWeek;
...
const perSlice = cand.weeklyP1 / k;
const wantSlices = Math.ceil((needed - supplied) / perSlice - 1e-9);
const maxSlices = Math.floor(room * k + 1e-9);
const take = Math.min(wantSlices, maxSlices);
...
fracUsed[cand.planetId] = used + take / k;
supplied += take * perSlice;
...
const whole = Math.ceil((fracUsed[planetId] || 0) - 1e-9);   // whole colonies charged
```

Conservative bias documented in the header (:24-27): a partially-filled multi-ECU colony
actually spreads 8 BIFs across fewer lines, so emitted colonies may slightly
**out-produce** the accounting; never under.

### 10.3 Mix allocation (profit stage 2 / product goals)

`src/js/09-modes.js:137-184`: pass 1 gives each pick
`slotBudget = Math.floor(world.totalSlots * share)` with `share = pct / totalPct` on a
shared depleting `reserved` map; pass 2 offers leftover slots back to picks in order;
achieved mix reported as `100 * e.slotsUsed / usedTotal` (:204).

### 10.4 Slot capping by distinct planets (C3)

`src/js/17-sourcing.js:402-405`:

```js
const rawSlots = perCharCounts.reduce((a,b)=>a+b,0);
const uniquePlanetCount = new Set(planets.map(pl=>pl.system+'|'+pl.name)).size;
const totalSlots = perCharCounts.reduce(
  (sum,n)=> sum + Math.min(n, uniquePlanetCount || 0), 0);
```

### 10.5 World totals

`src/js/04-world.js:95`:
`totalSlots: perChar ? perChar.reduce((a, b) => a + b, 0) : charCount * planetsPerChar`
(per-character array authoritative when present; `planetsPerChar = Math.max(...perChar)`
at :63). ⚠ `assignCharacters` (`05-allocator.js:332-334`) and `improveAssignment`
(`08-convenience.js:47`) both use uniform `world.planetsPerChar` per character — see
lessons doc §5.4.

---

## 11. Quota calculator

`src/js/28-quota.js:80-194` (`quotaPlan`):

```js
const perWeek = quantity / days * 7;                                        // :107
const eff = extractionEfficiency(programHours);                             // :108
const p1PerColony = P1_PER_EXTRACTION_COLONY * eff * (densityPct / 100);    // :109
...
const colonies = Math.ceil(need / p1PerColony);                             // :120 (per P1 line)
```

Utilisation: `need / capacity` per line (:138, :158); whole-plan utilisation summed
(:187-192); `charactersNeeded: Math.ceil(totalColonies / MAX_PLANETS_PER_CHARACTER)`
(:182). Density presets `poor 40 / typical 65 / rich 85` (:30-34); `QUOTA_MAX_DAYS = 30`
(:36); defaults days 7, programHours 6 (UI feeds 30 days / 24h — `readQuotaInputs`,
:262-265).

### 11.1 ⚠ BUG: P3 factory throughput uses the P2 constant

`src/js/28-quota.js:144-145`:

```js
[['p2', adv, P2_OUT_PER_ADV], ['p3', adv, P2_OUT_PER_ADV],
 ['p4', hiTech, P4_OUT_PER_HITECH]].forEach(([tier, count, per]) => {
```

The `'p3'` row should use `P3_OUT_PER_ADV` (504) but uses `P2_OUT_PER_ADV` (840) —
per-facility P3 throughput overstated 1.667×, so **quota answers under-count P3 factory
colonies** (`fColonies = Math.ceil(need / throughput)` at :152 with
`throughput = count * per`). Not documented anywhere.

### 11.2 ⚠ BUG: purchases key mismatch (pattern B, again)

`src/js/28-quota.js:193`: `purchases: demand.purchases || {}` — but `chainDemand` returns
`{ factory, mined, bought }` (`05-allocator.js:92`). `demand.purchases` is always
undefined, so a quota for a composite silently omits its bought-input list.

### 11.3 ⚠ Density rule inconsistency

`28-quota.js:91-92` refuses `densityPct > 100` ("density must be between 1 and 100
percent") while `weeklyP1PerColony` and the world reader deliberately accept >100.

---

## 12. ⚠ Three parallel recipe-walk implementations

Despite the "only implementation" doctrine, three walks encode the ladder independently
(plus the verifier's deliberate oracle copy in `tools/verify.js`):

1. `p1Requirements` — `03-mechanics.js:171-197` (cached Map; used by nothing load-bearing
   on the main path).
2. `chainDemand` — `05-allocator.js:39-93` (the engine's real one; handles composites and
   bought-termination).
3. `traceAnyCommodity` — `17-sourcing.js:108-132` (feeds result-card `p1Needed`; its own
   `P0_PER_P1 = 3000 / 20` at :106; no composite handling — returns null for them, callers
   `|| {}`).

Same ratios today; three places for them to drift.

---

## 13. OCR / screenshot math (for completeness)

- Luminance: `p[i]*0.299 + p[i+1]*0.587 + p[i+2]*0.114` (`23-screenshot.js:123`, and
  `makeLum` :317-325).
- Otsu threshold maximising between-class variance `wB*wF*(mB-mF)²` (:95-107); bar-region
  Otsu floored at 60, fallback 140 (:250).
- Bar percentage (`measureBars`, :261-267):

```js
const fill = Math.max(0, p.fillEnd - medLeft);
return { name: p.row.name,
         pct: Math.max(0, Math.min(100, Math.round((fill / span) * 100))), ... };
```

  ⚠ clamped to ≤100 while the rest of the app treats >100% densities as real and
  refuses to clamp them.
- Track-right detection: per-row background floor = mean of the rightmost `max(6, iw*0.03)`
  pixels + 12, min 28 (:330-334); sustained-gap end `gapNeeded = max(10, round(iw*0.007))`
  (:283); edge voting `here - after > 18 && here > 30 && after < here*0.6` with quorum
  `max(2, rows-1)` (:343-353); cluster median with tolerance `max(3, span*0.03)` and 60%
  quorum (:372-385); edge distrusted if `> cluster*1.15` (:360).
- Fill scan: 5 scanlines per row, median; gap tolerance `max(2, round(iw*0.01))` (:213-237).
- Name matching: Levenshtein with tolerance `max(2, floor(len*0.3))`, confidence
  `1 - dist/len` (:55-69); planet type = best resource-overlap ≥ 3 (:71-79).
- Preprocess upscale ×2 below 1400 px wide, else ×1.5 (:520).

---

## 14. Template route quantities (game-facing numbers)

`src/js/21-templates.js` — generated templates carry the real schematic transfer amounts:

- Miner template routes: `Q: 3000` P0 into each Basic facility, `Q: 20` P1 out
  (:84-91), extractor route `{"P": [5, 8], "Q": 290112, "T": entry.p0}` (:92) — the 6-hour
  program quantity, `CmdCtrLv: 5`, `Diam: 8160.0`.
- P2 factory: inputs `Q:40` per slot, output `Q:5` (:122-131); P3 variant rewrites input
  routes to `Q:10` and output to `recipe.qty` (:181-185: "real P2->P3 ratio is 10:10->qty");
  P4 assembly routes use the recipe's own `[input, q]` and output `Q:1` (:269-272).
- Building IDs: miner Storm `{basic:2483, storage:2561, launchpad:2557, ecu:3067, pln:2017}`,
  Temperate `{basic:2481, storage:2562, launchpad:2256, ecu:3068, pln:11}` (:58-61);
  factory Barren `{cc:2524, adv:2474, hightech:2475, pln:2016, hub:2552}`, Temperate
  `{cc:2254, adv:2480, hightech:2482, pln:11, hub:2256}` (:211-219). Barren hub 2552 is
  knowingly "Ice's Launchpad" replicating the community convention (comment :108-112);
  the old 2544 was an icon id (bug, fixed).
- Serialisation forces `.0` on `Diam/La/Lo` (`eveNumber`/`eveSerialize`, :430-469).

---

## 15. Scale & misc constants

`01-data.js:985-987`: `MAX_CHARACTERS = 50; MAX_PLANETS = 300;
MAX_PLANETS_PER_CHARACTER = 6;` (support ceilings, never padding — asserted by
`test-scale.js`; slot cases pinned in `tools/fixtures.js:189-204`).
`09-modes.js:38` `MAX_GOAL_PRODUCTS = 10` (and `15-engine.js:331`
`MAX_GOAL_SELECTIONS = 10` — ⚠ duplicate constant). Density slider: min 0, **max 500**,
step 0.1, seeded at 50 (`11-ui-systems.js:297`). `50%` is also the substitution stand-in
(`readWorldFromPage({ substitutePct: 50 })`, `27-engine-adapter.js:184` et al.). Save
format `SAVE_FORMAT_VERSION = 1`, magic `'solving-pi-save'` (`24-saveload.js:19-20`).
Reference-world regression anchors (`tools/fixtures.js:71-93`): e.g. OMA 3,057/wk, k=1,
135 slots, limitedBy `extraction:Electrolytes` on the 11-planet 65% world — measured
values, drift guards only; the older Y-1918 3,712/3,822 pair survives only as prose in
REBUILD-BRIEF/OWNER-RULES.

---

## 16. Consolidated ⚠ list for cross-checking

1. **PI tier volumes are half the commonly cited SDE values** (P1 0.19 vs 0.38 etc.) —
   §5.1. Highest-impact single check: scales all freight and storage math.
2. **Quota P3 throughput wired to the P2 constant** (840 vs 504) — §11.1. Real bug.
3. **Quota `demand.purchases` never exists** (`bought` is the key) — §11.2. Real bug.
4. **Buy prices resolved from the buy side of the book** (`{buy: price, sell: price}`) —
   §8.2. Understates purchase costs on all v8 paths.
5. **`isBought` silently dropped** by `profitStage1` and `allocateMix` — buy-input
   checkboxes ineffective in profit and mix planning (lessons doc §5.2).
6. **Two disagreeing preset tables** (freight 10/400/600/900 vs 500/900/1200/1500;
   customs differences) — §6.4/§6.5; docs match the UI table, engine table unreachable.
7. **Two economics ledgers** that must agree by convention — §7.
8. **Composite ME 10 + 5.99% structure bonus applied by default** while FIRST-PRINCIPLES
   claims base values are used — §9.2.
9. **Fuel-block item type-id assignments possibly swapped** (Hydrogen 4312 / Oxygen 4246
   vs commonly cited 4246/4312); BP ids 4313-4316 and paste BP 2739 unverified here; same
   check for isotope IDs — §9.3.
10. **Fixed 30-min sub-cycle decay model for all program lengths** — §1.4; and the
    calibrated `13277.2694` base — §1.5.
11. **No BIF-throughput cap** when efficiency > 1 or density > 100 — §2.6.
12. **Density >100 handling inconsistent** (mechanics accept, OCR clamps at 100, quota
    rejects) — §2.2, §13, §11.3.
13. **Legacy candidate pool ignores program hours** — §2.5; `lazyP2Throughput` (display
    panel) also fixed at 6h while the engine's lazy path scales — §4.3.
14. **`CUSTOMS_COMMAND_CENTER_MULTIPLIER` defined, never applied** — §6.1.
15. **Three recipe walks + oracle** — §12.
16. **"Exactly 4 cycles/day" claim is arithmetically false** (≈3.97; 0.7% slack) — §1.6.
17. **Character dealing ignores per-character caps** the judge enforces — §10.5.
18. Sales tax preset value drift: 3.37 vs 3.4 between the two preset tables (base 7.5%,
    −11%/level ⇒ 3.3750% at V) — §6.3-6.5.
