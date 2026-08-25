# Findings and learnings

Written for whoever picks this up next — including a future me. Not a changelog;
the changelog says *what* changed. This says **what we got wrong, how we found
out, and what it cost**, because the mistakes are more useful than the fixes.

Everything here happened. The numbers are measured, not illustrative.

---

## The single most expensive pattern

**Five separate values were lost at the same kind of handoff.**

`isBought`. The colony split. The cost lines. The shipped volume. `sourceOf`,
twice.

Every one had an identical shape:

```js
// a call site hand-writes the options object
allocateMax(world, name, { programHours, isBought, compositeMePct: ... });
//                                                  ^ sourceOf silently absent
```

Nothing throws. The engine reads `undefined`, falls back to a default, and the
user's setting is discarded **in silence**. The plan is wrong in a way that
looks completely fine.

That is not five mistakes. It is one design choice producing the same failure
repeatedly.

**The fix that mattered** was not fixing the five. It was `engineOpts()` — one
function that assembles the whole set — plus a build check that fails if a call
site hand-rolls the object again. Adding an option now reaches every caller, and
no call site is in a position to forget one.

**If you take one thing from this page:** when you see an options object built
by naming fields individually, treat it as a suspect. It is where this codebase
loses things.

---

## "Does it crash?" is the wrong question

Eleven suites and sixty-odd build checks were green while `buy all inputs` was
being **ignored entirely**. Identical output whether you turned it on or off.

Of course they were green. A setting that does nothing still returns valid,
non-null, renderable output. It passes every check of that shape.

The suite that caught it asks a different question: **does this input change the
answer?** Run the same world twice, vary one setting, fail if the output is
byte-identical. That is `tools/test-matrix.js`, and it found the bug on its
first run.

It later found a second one the same way — the quality-of-life planner ignored
sourcing completely, returning nothing at 0% density for a user who had said
they were buying their inputs.

**A control that does nothing looks exactly like a control that works.** Only an
influence check can tell them apart.

---

## Things that were quietly wrong for a long time

Worth knowing these existed, because they are the flavour of bug this project
produces.

| What | How wrong | How it presented |
|---|---|---|
| Customs tax | Charged on market value, not base cost — overstated a P4 POCO by ~60% | Numbers that looked plausible |
| Customs and broker | **Never charged at all** — `customsTaxPct` vs `customsPct` | Two of four costs worked, so the total still moved |
| Ice planets | Listed Suspended Plasma where the game has Planktic Colonies | Biomass looked impossible from Ice |
| Colony split | Hardcoded to zero at three separate handoffs | "0 extraction + 0 P2 = 168 of 168 slots" |
| Density | Capped at 100 and truncated by `parseInt` | 58.4 became 58, silently, everywhere |
| Favicon | Invalid XML — a `--` inside an XML comment | No icon, no error |
| Viewport | A fixed width scaled *desktop* up to fill the window | "Mobile looks right, desktop looks zoomed" |

The pattern in most of these: **the engine was correct and the wiring between
layers was not.** The maths in this project is generally right. The handoffs are
where it goes wrong.

---

## Comments describing markup break the markup

This happened **four times** before it sank in.

- A comment containing a literal `<div>` and `<table>` broke the tag-balance
  check — it counts tags and cannot tell prose from markup
- A comment containing a literal `<p>` did it again
- A comment explaining that pinch-zoom is deliberately enabled matched a
  document-wide search for `user-scalable`
- A comment explaining why CSS variables cannot be used in a standalone favicon
  contained `var(--cyan)` — and `--` is illegal inside an XML comment, which
  invalidated the entire file

**Write about syntax in words.** "Built from divs rather than a table element",
not the tags themselves.

---

## How good is the planner, actually?

This was a guess until it was measured. It is now measured.

**For a single refined material: exactly optimal.** There is only one decision —
which planets to mine — so the best answer is calculable directly. Matched
exactly across 18 cases.

**For anything further up the chain: close, and provably not exact.** Measured
against an exhaustive search of every legal arrangement:

| Colony slots | Left on the table |
|---|---|
| 4 | up to 33% |
| 6 | up to 20% |
| 8 | up to 14% |

The gap roughly **halves every time the operation doubles**. It is a rounding
effect — worst when one misplaced colony out of four is a quarter of everything.

**What is not proven:** that the trend continues to a real 168-slot operation.
Worlds past about eight colonies cannot be exhaustively searched in any
reasonable time. The honest claim is that the gap shrinks with scale and small
worlds are the worst case, not the typical one.

Tools: `measure-greedy-gap.js`, `-p2.js`, `-scale.js`. They are measurements,
not tests — not in CI, they assert nothing.

### The oracle was wrong twice before it was right

Both times it reported the greedy **beating** the optimum, which is impossible.
That is the tell: when your reference implementation says the thing it is
checking is better than perfect, **the reference is broken**.

1. `P2_OUT_PER_ADV` is 840 per *facility*; a colony holds 24 of them. Using the
   bare constant made a factory colony look 24× weaker than it is.
2. A colony has *k* extractor slices and **several may share one resource** —
   the planner builds `Ionic Solutions x5`. Modelling a colony as a set of
   distinct resources cannot express that.

Flagging that failure mode *before* writing the code is the only reason those
runs were read as "my bug" rather than "a discovery".

---

## Invariants that hold up large numbers

Three properties the allocator depends on that nothing checked:

**Candidates sorted by yield, best first.** Comment out that one `sort` line and
every suite stays green while output drops by up to **74%** — Broadcast Node
falls from 638 units a week to 164. No crash, no warning, just less ISK.

**Placement is monotonic in units.** The binary search assumes success at *n*
implies success at every *m < n*. Verified across 275 points. If it ever stops
holding, the search silently under-reports.

**The chosen k is the best of the five.** Not the first one that worked.

All three are asserted now, each verified by deliberately breaking it.

---

## What the plan checker does and does not prove

It checks **36 distinct rules** and is stronger than it looks — it rejects a
factory claiming a thousand times its capacity, not just malformed shapes.

**But it reads the same physics constants the planner does.** Doubling
`P1_PER_EXTRACTION_COLONY` produces a physically impossible plan that the
checker passes as legal. Both sides agree, so there is nothing to disagree
about.

**Do not "fix" this by duplicating the constants.** Two copies drift, and a
disagreement then tells you only that they differ — not which is right. That is
worse than one verified copy. The constants are checked against EVE University,
against published player reports, and in `test-engine.js`.

It proves a plan is **legal**, not that the physics is **right**.

---

## Working practices that earned their keep

**Verify a fix by breaking it again.** Every assertion added here was checked by
reintroducing the bug and confirming it fails *by name*. An assertion that has
never failed is a guess.

Twice, a check I wrote passed against deliberately broken code. Both times the
check was wrong, not the code.

**A test that fails too broadly hides the fault.** Setting finance fields the
wrong way made *everything* read zero, which looked like total breakage. Setting
them correctly narrowed it to customs alone — and that is what made the key-name
mismatch findable.

**When the code and the test disagree, find out which is wrong before fixing
either.** The density-disclosure assertions failed while the same checks passed
standalone. `addSystem` creates one empty starter card, and the test was slicing
from index 1 — so every *real* planet got scanned and there was nothing to
disclose. The code was right.

**Recalibrating a fixture is sometimes correct, but justify the direction.**
When the Ice fix moved four fixture values, the moves were checked for sense
first: Sterile Conduits needs Biomass and went *up*; Nano-Factory needs
Plasmoids and went *down*. Recalibrating to whatever the code now prints is how
a test stops meaning anything.

**Published maths rots.** Every figure in `FORMULAS.md` and on the page is
asserted against the engine that produces it. Verified by changing a constant
and watching the prose fail. A page that shows its working is trusted more, so
it has to earn that.

---

## Practical notes

**The combination matrix takes minutes.** Shard it if it times out:

```
MATRIX_CHARS=1,5  node tools/test-matrix.js
MATRIX_CHARS=10,20 node tools/test-matrix.js
```

A background run does not outlive the shell that starts it — a killed run looks
exactly like a hang. If progress stops mid-way, check whether the process is
still alive before assuming a deadlock.

**Deploy `index.html` and `favicon.svg` together.** The page references the icon
by name; uploading one without the other breaks the tab icon silently.

**Zip archives here exclude `.git` deliberately.** Extracting one containing a
`.git` folder repeatedly wiped the GitHub remote.

---

## Still open

- **The greedy gap at realistic scale** is projected, not measured. Anyone with
  a smarter exhaustive search — branch and bound, or an integer programming
  solver — could close that.
- **`allocateMax` is named for a guarantee it does not provide.** The header
  states the honest claim rather than renaming and churning every call site.
  A rename is still the cleaner answer.
- **`placeUnits` is large** and called ~150 times per target. Splitting it was
  considered and **rejected**: none of the bugs found were caused by its size,
  it is correct across 768 combinations, and refactoring correct hot-path code
  is risk without user benefit. If you split it, have a better reason than
  tidiness.
