# Open questions — in-game measurements needed

Each of these is a number the engine refuses to guess. Until measured, the code
either uses a documented interpretation (flagged inline) or throws by name.
Measurement recipes are written for Ryan to run in the client in minutes.

## 1. Cycle-time boundary inclusivity (interpretation in use, low impact)

The cycle time steps at 25h / 50h / 100h / 200h. Unknown: does a program of
EXACTLY 25h use 15-min or 30-min cycles? Engine currently assumes the boundary
keeps the shorter cycle.

**Recipe:** install (or preview) a 25h0m program on any extractor. The survey
window's bar graph shows the cycles: count the bars (100 bars = 15-min cycles,
50 = 30-min). Repeat at 50h if convenient. Do not submit the program — the
preview is enough.

**Impact if wrong:** yields at exact boundaries shift by well under 1%. Cosmetic.

## 2. Per-cycle integer truncation (option exists, default analytic)

Community implementations floor each cycle's yield to an integer to match
in-game numbers; CCP's published generator yields floats. Engine default is
analytic (float); `truncatePerCycle: true` is available.

**Recipe:** read any installed program's per-cycle values from the survey
window (or ESI extractor_details + our formula) and compare one cycle's shown
value against the float formula: if the game shows 13,205 where the formula
gives 13,205.83, truncation is confirmed.

**Impact if wrong:** a few units per cycle; invisible at weekly scale. The
default stays analytic either way for smooth analytics; truncation matters only
for exact ESI reconciliation.

## 3. Link upgrade CPU/PG scaling (engine refuses to price, medium impact)

Base links cost 15 tf / 10 MW + per-km. The CPU/PG cost of UPGRADED links
(levels 1-10, capacity 500-256,000 m³) is unverified. `linkCpuTf`/`linkPgMw`
THROW for level > 0 rather than guess.

**Recipe:** in a colony, upgrade one link level by level and note the CPU/PG
readout change at each step (planet mode shows totals). Six data points nail
the curve; two confirm linearity or doubling.

**Impact if wrong:** layouts moving big volume (high-tech colonies importing
864 m³/h of P3) may need upgraded links; until measured, the layout optimizer
treats link level 0 as the only priceable option.

## 4. Command center purchase price (priced as null)

~90,000 ISK per UniWiki but unconfirmed this pass. Setup-cost analytics carry
`null` until someone reads the market price in-game.

## 5. Reagent production rates (Equinox; empirical by design)

CCP has never published Magmatic Gas / Superionic Ice extraction rates. These
are treated as user-observed inputs (like density), never constants. No recipe
can close this — the model is built expecting per-skyhook observed rates.

## 6. Boundary of exactly-336h programs

PROGRAM_MAX_HOURS = 336 (14 days). Whether the client permits fractionally
longer is irrelevant to planning; flagged only for completeness.
