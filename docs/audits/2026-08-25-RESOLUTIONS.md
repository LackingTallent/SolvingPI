# Audit resolutions — 2026-08-25

Two audits ran against the reskinned v9 (reports in this folder): a functional
audit (20 defects: 3 BROKEN, 9 DEGRADED, 8 COSMETIC) and a text-accuracy audit
(18 items). Every item below is resolved in this commit unless marked otherwise.

## Functional audit → fixes

| # | Defect | Resolution |
|---|---|---|
| 1 | PI Templates dead — 21-templates.js SyntaxError (duplicate `IMPORTED_TEMPLATES` with 20b) | Dropped the redundant `20b-imported-templates.js` script tag (21 contains the entire 20b block). Templates verified rendering (smoke asserts `tpl-row` + populated `#tplCount`). |
| 2 | 01-data.js load crash — `p0PerDayForProgram` never carried | Removed the dead `P0_PER_DAY_BASELINE` line (nothing consumed it); all downstream consts now initialize. |
| 3 | Zelle button/modal dead | Ported v8's `initZelleModal` block (24-saveload.js:399-414 verbatim) into 10-shell.js. |
| 4 | Market hover popup printed `undefined` system | Bridge `readPlanets` now returns `system` (UiPlanet gained an optional `system` field). |
| 5 | Batch planets double-prefixed ("T-Q2DD T-Q2DD XI") | `deliverBatch` uses the OCR name as-is when it already starts with the system. |
| 6 | Hero jump double-fired `section:expanded` → Status double ESI load | Removed the duplicate dispatch in 10-shell (setCollapsed already announces); Status `load()` also guarded by its `loaded` flag. |
| 7 | Collapse click fired a fresh Status ESI load | Removed the direct collapse-btn listeners in 24-status and 22-price-history — expansion always announces via 00-shims. |
| 8 | ~10 wasted ESI system fetches per load | Removed the eager `loadAllSystems()` call (function kept for a future system field). |
| 9 | Smoke test blind to #1/#2 | Smoke now asserts rendered rows (not static ids) and FAILS on any uncaught page console error — verified by deliberately re-breaking the page (canary caught by name). |
| 10 | Bridge-rejected batch planets shown as successes | `deliverBatch` returns per-planet verdicts; rejected rows render bad with the reason. |
| 11 | Stale results shown unmarked after edits | Any state mutation stamps the results panel "Inputs changed — press Solve to refresh" and marks the section summary (stale). |
| 12 | Number inputs accepted out-of-range / cleared values | `numInput` clamps to min/max and restores the prior value on NaN/empty. |
| 13 | Dead autosave-restore banner | Markup removed (v9 autosaves and auto-loads; help text already said so). |
| 14 | `#calcAnnounce` never written | `announce()` writes it on every solve/compare completion and failure. |
| 15 | Sticky bar overlapped footer padding | `body { padding-bottom: 96px }` in 03-v9.css. |
| 16 | Dead `#tooltip` element | Removed. |
| 17 | Hardcoded hero commodity count | Set from `priceableNames().length` at load. |
| 18 | Rajdhani @import pointed at nonexistent cdnjs library | Folded into the Google Fonts css2 import (Rajdhani 500/600/700). |
| 19 | Duplicate skip links | One kept. |
| 20 | `baseCostOf` guarded on a global `tierOf` that never exists | Now guarded on `v9TierKey` (and its TDZ cause, #2, is fixed). Still has no caller. |

## Text audit → fixes

| # | Item | Resolution |
|---|---|---|
| A1 | "Restore it / Discard" flow that doesn't exist | Removed with #13. |
| A2/A3/A10 | "live Jita prices" overclaim (hero, quickstart, help) | Reworded: fetched live where this build can, entered by you where it can't. |
| A4 | "highlight every planet in your plan" | "see which of your planets carry it" (matches the popup that exists). |
| A5 | Planner "can plan" fuel blocks/nanite paste/deployables | Reworded: reference prices only; this build's planner plans the PI chain P1–P4. |
| A6 | "Every template the tool can generate" | Reworded: generated layouts plus 199 community templates, credited. |
| A7 | Footer: marks owned by "Fenris Creations (formerly CCP Games)" | Flagged, then **REVERTED on owner instruction** — Ryan confirmed the wording is deliberate and correct. The original text stands. |
| A8 | Quickstart implied per-character program length | Reworded: one program length for the whole operation. |
| A9 | Price History "highs and lows" | "average prices" (the chart plots daily averages). |
| A11/B4 | "most profit" mode ambiguity | Mode label and help now say "most output of your chosen product (then priced honestly — a loss shows as a loss)"; compare-all is the profit ranking. |
| B1 | "Budget" column header | "Planet budget". |
| B2 | Developer error text shown to visitors | `missing-typeid` reasons translated at display: "no type ID in this build — enter its quote manually". |
| B3 | Compare mode truncated silently | "Top 15 shown of N" caption + "first 40 shown" on the excluded fold when truncated. |
| C | Engine strings | Audited clean; no changes. |
| D1 | Batch status said "before calculating" | "before you press Solve". |
| D2 | Popup "in your plan" | "of your planets carry this". |
| D3 | Bug report read dead v8 mode radios | Reads `input[name="v9mode"]:checked`. |
