# PI Extraction Mechanics (Ground Truth)

Researched August 2026. Primary sources: CCP official developer docs
(https://developers.eveonline.com/docs/guides/pi/), CCP dev blog "Planetary Interaction changes
brought with Incursion 1.1.0" (https://www.eveonline.com/news/view/planetary-interaction-changes-brought-with-incursion-1.1.0-1),
EVE University wiki (https://wiki.eveuniversity.org/Planetary_Industry,
https://wiki.eveuniversity.org/Colony_management).

## Extractor Control Unit (ECU) programs

- An ECU runs an **extraction program** targeting exactly one P0 resource at a time.
- Program duration is chosen by the player: **minimum 1 hour, maximum 14 days**
  (UniWiki Planetary Industry; also thonky.com/eve-online-guide/planetary-industry).
- The ECU has **up to 10 extractor heads**. The first head is included in the ECU's base
  CPU/PG cost; **each head costs 110 tf CPU and 550 MW powergrid** (UniWiki Planetary Industry /
  Planetary Buildings). Heads themselves cost no ISK.
- Heads must be placed within the ECU's area of influence (the circle shown at ECU placement).
  Longer program duration = **larger uptake (drill) area per head** — CCP: "Longer lifetime equals
  a larger uptake area around the extractor heads" (Incursion 1.1.0 dev blog). So short programs
  sample small, precisely-placed areas; long programs sweep big areas coarsely.

### Cycle time vs program length

Program output is delivered in discrete cycles. Cycle time is a step function of program length.
UniWiki (Planetary Industry): cycle time "doubles at 25 hours (1d1h) to 30 min, 50 hours (2d2h)
to 1hr, 4d4h to 2hr, 8d8h to 4hr". Combined with CCP's developer docs, where all cycle math is in
multiples of 900 s (15 min), the mapping is:

| Program length | Cycle time |
|---|---|
| 1 h – 25 h (1d1h) | 15 min |
| >25 h – 50 h (2d2h) | 30 min |
| >50 h – 100 h (4d4h) | 1 h |
| >100 h – 200 h (8d8h) | 2 h |
| >200 h – 14 d | 4 h |

**UNCERTAINTY:** the exact boundary behavior (whether a program of exactly 25h uses 15-min or
30-min cycles) is not published; the table above interprets the UniWiki wording. Treat boundaries
as approximate; the in-game survey window is authoritative for any concrete program.

## The exact published extraction yield formula

Source: **CCP official third-party developer documentation**, "Planetary Industry" guide,
https://developers.eveonline.com/docs/guides/pi/ (formerly hosted at docs.esi.evetech.net; the old
`/docs/pi.html` URL is dead). Code quoted verbatim from that page:

```python
import math

# These constants are the defaults in dgmAttributeTypes. They may change.
decay_factor = 0.012  # Dogma attribute 1683 for this pin typeID
noise_factor = 0.8  # Dogma attribute 1687 for this pin typeID

def calculateExtractorValues(total_cycles = 30, cycle_time = 30 * 60, qty_per_cycle = 6965):
    """
    :param int total_cycles: End time in seconds - start time in seconds / cycle_time
    :param int cycle_time: Cycle time, in seconds
    :returns Generator[int]: A generaotr that iterates over all values
    """
    bar_width = float(cycle_time) / 900.0

    for cycle in range(0, total_cycles):
        t = (cycle + 0.5) * bar_width
        decay_value = qty_per_cycle / (1 + t * decay_factor)
        phase_shift = pow(qty_per_cycle, 0.7)

        sin_a = math.cos(phase_shift + t * (1 / 12))
        sin_b = math.cos(phase_shift / 2 + t * 0.2)
        sin_c = math.cos(t * 0.5)

        sin_stuff = max((sin_a + sin_b + sin_c) / 3, 0)

        bar_height = decay_value * (1 + noise_factor * sin_stuff)

        yield bar_width * bar_height
```

Reading of the formula, with **w = `qty_per_cycle`** (the base per-cycle value the server assigns
from head placement over the resource distribution — the "initial value"):

- Time is measured in **units of 15 minutes**: `bar_width = cycle_time / 900` (so a 30-min cycle
  has bar_width 2), and `t` is the midpoint of the cycle in those units.
- **Decay term:** `w / (1 + 0.012·t)` — hyperbolic (not exponential) decay of the base yield over
  the program. Constants are dogma attributes and could in principle be changed by CCP
  (decayFactor = attribute 1683 = 0.012; noiseFactor = attribute 1687 = 0.8).
- **Noise term:** mean of three cosines with frequencies 1/12, 1/5 (0.2) and 1/2 per 15-min unit,
  phase-shifted by `w^0.7`, clamped at ≥0, scaled by noiseFactor 0.8. This produces the spiky
  "nuggets" in the survey graph; a cycle can pay up to 1.8× its decay value.
- Yield of cycle i = `bar_width * bar_height` — i.e. yield scales linearly with cycle length, so
  the cycle-time doubling for long programs does not itself reduce total yield; the decay term does.

**UNCERTAINTY (flagged):** the published generator yields floats; the game reports integer
quantities per cycle. Community implementations (e.g. PI planner tools) truncate each cycle's
yield to an integer, matching in-game numbers, but the truncation step is not stated in CCP's
docs. Also note `1 / 12` in the sample is Python-3 true division (≈0.0833); older mirrors of this
code wrote `f1 = 1.0/12`.

### Why short programs yield more per hour

Because `decay_value = w / (1 + 0.012·t)`, the average rate falls monotonically with elapsed
program time: at t = 96 (1 day) the base rate is ~46% of initial; at t = 672 (7 days) ~11%; at
t = 1344 (14 days) ~6%. Restarting a program resets t to 0 at the current w, so frequently
restarted short programs extract far more per hour than one long program — the trade-off CCP and
UniWiki describe ("Extraction Area Size/Duration is a trade-off of varying total amount, cycle
time…"). Note the decay is *program clock decay* in the formula, distinct from (and in addition
to) physical hotspot depletion below.

## Head placement, overlap, hotspots

Official statements from the Incursion 1.1.0 dev blog:

- Yield is driven by "resource pressure": "The resource pressure depends on how much of the
  resource is available for the extractor heads to suck up." Placing heads on rich (white/red on
  the heatmap) areas raises w.
- **Overlap penalty (official):** "If the uptake area of an extractor head overlaps another uptake
  area, this overlap creates an interference zone", shown visually and "as a negative percentage
  in the ECU's extractor head list." Overlapping heads share the same resources — overlaps
  diminish yield. Practical rule (all-out.github.io/guides/planetary-interaction/): do not let
  heads overlap.
- **Depletion & regeneration (official):** "Depleted resources regenerate so moving extractor
  heads off a hotspot will allow it to grow back." Equilibrium is possible by "extracting at the
  same pace as it regenerates." Long programs on one spot deplete it: "there tends to be a
  significant drop-off of resources if you use a long duration … you are continually depleting a
  resource without letting it regenerate" (thonky.com).
- **UNVERIFIED:** the regeneration rate, the depletion function, and how planetwide resource
  distributions shift over time are not published anywhere (CCP has never released the server-side
  model). Any planner must treat hotspot density and its evolution as unknowable a priori.

### Restart / reset behavior

- When a program expires (or is stopped), the ECU and heads remain; the player re-surveys and
  installs a new program. Heads keep their positions and can be moved before restart.
- UniWiki practical note: predicted yield shown at restart can be stale — "after you move your
  extractor heads and click start, DO NOT submit yet. Instead, click on the 'Install Program'
  button again" to refresh the estimate against current (depleted) resource values.
- Restarting on the same spot restarts the decay clock at the *current* local resource value,
  which is typically lower than last time if the spot was being drained.

## What a planner can and cannot know

- **In client only:** the planet resource heatmap (quality gated by Planetology skills — see file
  12) and the survey window's predicted per-cycle graph / program total for a candidate head
  layout. These predictions come from the same formula above given the server's w.
- **Via ESI (authenticated, own colonies only):** `GET /characters/{character_id}/planets/` and
  `GET /characters/{character_id}/planets/{planet_id}/` return each ECU pin's
  `extractor_details`: `qty_per_cycle` (w), `cycle_time`, `product_type_id`, `head_radius`, and
  head coordinates, plus `install_time`/`expiry_time` (https://esi.evetech.net/ui/, see also
  https://developers.eveonline.com/docs/guides/pi/). So a third-party tool can *exactly* reproduce
  the yield schedule of an already-installed program using the formula above.
- **Not available anywhere:** planetary resource distribution maps, hotspot values, depletion
  state, or regeneration — there is no ESI endpoint for planet resources. A planner therefore
  cannot predict w for a hypothetical head placement; it can only take w as user input or from ESI
  after installation. Survey-scan accuracy itself is skill-dependent and qualitative (no published
  numeric accuracy formula).
