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
npm install        # typescript + tsx (+ @types/node)
npm run gate1      # typecheck + all tests — must be green before Phase 2 work
```

## Status

- [x] Phase 0 — verification foundation (formula verdicts in docs/library/03)
- [x] Phase 1 — world model (this commit; Gate 1 green)
- [x] Phase 2 — universal math core (flow network + one ledger; Gate 2 green)
- [x] Phase 3 — feasibility judge (Gate 3 adversarial suite green, 26 named rules, 100% rule coverage)
- [x] Phase 4 — solvers (Gate 4 green: hybrid exhaustive/greedy + fractional UB certificates, exact matching dealer, four modes)
- [ ] Phase 5 — analytics
- [ ] Phase 6 — data layer (SDE pipeline, ESI prices, PKCE SSO importer)
- [ ] Phase 7 — UI + prototype deploy
