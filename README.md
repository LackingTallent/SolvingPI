# Solving PI v9

Ground-up rebuild of [solvingpi.com](https://solvingpi.com) — an EVE Online
Planetary Industry planner. Fresh repo, fresh engine: verified game physics,
one universal ledger, judge-validated plans, analytics derived from economic
first principles.

## Why a rebuild

The v7/v8 line worked, but iterative design left scar tissue: settings silently
dropped at handoffs, duplicate ledgers, constants wired to the wrong tier, and
a planner whose claims outran its physics in places. The full case lives in
`docs/library/` (16 reference documents: verified game mechanics with sources,
the audited history of the old code, and the plan this repo follows —
`30-rebuild-plan-outline.md`).

## Principles (enforced, not aspirational)

- **Truth before math, math before optimization, optimization before UI.**
  Phases are gated; a phase does not start until the previous gate is green.
- **One source of truth per concept.** Game numbers live ONLY in `src/spec/`;
  every constant carries a source citation. Nothing restates a number.
- **Units are types.** ISK, m³, tf, MW are branded types; passing one where
  another belongs is a compile error (`tests/types.test-d.ts` proves it).
- **No silent failures.** Strict constructors throw on unknown keys; the engine
  refuses by name what it cannot price (see `docs/OPEN-QUESTIONS.md`).
- **Scale is first-class.** Accurate for 1..50 characters, each modeled
  individually (own skills, own planet budget). Sum, never multiply.

## Layout

```
src/units.ts          branded unit types + the only legal cross-unit ops
src/spec/             constants.ts (every game number, cited)
                      schematics.ts (full P0→P4 chains; regenerable via tools/gen-sde)
src/world/            planets, facilities+CPU/PG, characters, tax/fees,
                      extraction (CCP formula, verbatim), density (% ↔ raw w)
tests/                Gate 1: 45 assertions incl. the v8.3 golden oracle
docs/library/         the 16-document reference library (sourced)
docs/OPEN-QUESTIONS.md  numbers the engine refuses to guess + measurement recipes
```

## Running

```
npm install               # typescript + tsx (+ @types/node)
npm test                  # unit suites (157)
npx tsx tools/matrix.ts   # engine matrix (148 cells)
npx tsx tools/edge-matrix.ts   # adversarial engine/state edges (27 cells)
node tools/build.mjs      # → dist/ (static site)
node tools/smoke.mjs      # headless-browser smoke (24 checks)
node tools/ui-matrix.mjs  # full UI flow sweep (45 checks)
node tools/ui-edge.mjs    # UI edge attacks + review screenshots (20 checks)
```

## Status

- [x] Phase 0 — verification foundation (formula verdicts in docs/library/03)
- [x] Phase 1 — world model (this commit; Gate 1 green)
- [x] Phase 2 — universal math core (flow network + one ledger; Gate 2 green)
- [x] Phase 3 — feasibility judge (Gate 3 adversarial suite green, 26 named rules, 100% rule coverage)
- [x] Phase 4 — solvers (Gate 4 green: hybrid exhaustive/greedy + fractional UB certificates, exact matching dealer, four modes)
- [x] Phase 5 — analytics (Gate 5 green: marginal, buy-vs-make, saturation, cadence, baseline, bottleneck/runway — all re-solved, all cited)
- [x] Phase 6 — data layer (Gate 6 green: id registry + generator, order-book price service, PKCE SSO with JWT validation, ESI colony importer)
- [x] Phase 7 — UI + prototype deploy (Gate 7: build with module-graph check + headless-browser self-test smoke)
- [x] Goal refinement — goal-first progressive disclosure, suggested sourcing
      (heuristic + full-re-solve price comparison, every choice disclosed with
      its reason), the Quick/Refined/Exact accuracy ladder with per-security-band
      density stand-ins, space-type cost presets, per-section resets
- [x] Design-review hardening — refusals in plain English with one-click
      achievable-target, sticky bar reserves its real height, inline
      duplicate-name flagging, band demanded only for ores the goal uses,
      confirmed ✕ planet removal, a three-planet starter world that solves
      out of the box, rerender re-entrancy guard; two adversarial suites
      added (tools/edge-matrix.ts, tools/ui-edge.mjs)

## Support documentation

- `docs/USER-GUIDE.md` — the full user-facing guide (mirrors the in-site help)
- `docs/PRESET-SOURCES.md` — the audit trail defending every preset figure
  (cost presets and the per-band Quick-estimate densities)
- In-site: the **? Help** modal, the hero quickstart, and per-control hints —
  all kept in step with the flow above
