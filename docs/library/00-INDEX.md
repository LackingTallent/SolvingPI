# Solving PI Rebuild — Reference Library Index

Ground rules: nothing in the new engine may contradict these files. Where a file flags a number
as UNVERIFIED, it must be verified (in-game check, SDE, or official source) before code depends
on it. Ryan's formula list (incoming) will be filed as 03 and cross-checked against 02 and 10-15.

## Lessons from the existing product (v7.9/v8, solvingpi.com)
- 01-product-lessons.md — what it does, architecture, documented flaws, ordering problems,
  principles worth keeping, do-not-carry list
- 02-legacy-formulas.md — every formula/constant in the old code, verbatim with file:line,
  plus an 18-item suspicious list
- 03-owner-formulas.md — Ryan's "Every formula, in words" doc, VERIFIED with per-item verdicts
  (independent CCP-formula reimplementation in ../verify/verify-owner-formulas.py)
- 04-findings-v8.3.md — Ryan's FINDINGS.md: what went wrong, how found, what it cost
- 05-v8.3-state.md — audit of the v8.3 build: bug status (fixed vs still present), core
  output model, archetypes, tests, new concerns

## Game mechanics ground truth (sourced)
- 10-extraction-mechanics.md — ECU program mechanics, CCP's published yield/decay formula,
  cycle-time steps, head overlap, what a planner can/cannot know
- 11-facilities-and-chains.md — planet types, full P0→P4 schematic tables, facility CPU/PG,
  capacities, per-tier volumes (post-Viridian halved values)
- 12-skills-and-limits.md — skills and exact effects, character limits, POCO/CC tax mechanics,
  tier base values

## Economy and data ground truth (sourced)
- 13-market-mechanics.md — broker fee/sales tax/relist formulas (2025-2026 values), bid vs ask,
  spread and depth
- 14-esi-and-data-sources.md — ESI endpoints, rate limits, compatibility-date versioning,
  SDE (2025 JSONL relaunch), third-party price APIs
- 15-logistics-costs.md — freight cost models and current rate ranges (dated), volumes for
  freight math, parameterization

## Principles
- 20-economics-principles.md — the twelve economic principles the analytics layer derives from,
  and explicitly rejected anti-principles

## Equinox and SSO (sourced)
- 16-equinox-skyhooks.md — full Equinox sov-null mechanics: skyhook customs, reagents, bays, raid windows
- 17-esi-sso.md — PKCE SSO flow, planets endpoints, multi-character patterns

## Plan
- 30-rebuild-plan-outline.md — FINAL v1 plan with locked decisions (fresh repo, raw-units density,
  ESI import, per-colony layout choice, full Equinox scope, prototype deploy)
