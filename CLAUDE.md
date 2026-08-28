# Project notes for AI sessions

## Hosting topology — do not get this wrong
- **solvingpi.com (production) is hosted on CLOUDFLARE.** Deploys happen by
  uploading the static site (dist/ contents: index.html, favicon.svg, css/,
  js/, legacy/) to Cloudflare — the owner does this via the dashboard.
- The **Netlify project `solvingpi`** does NOT serve the site: it only
  REDIRECTS to solvingpi.com. Never deploy to it.
- The **Netlify project `prototype-solvingpi`** (v9protofull / prototype URLs)
  is the v9 prototype target; the owner deploys there manually (drag-drop of
  the dist zip, or repo link using netlify.toml).

## Build
- `node tools/build.mjs` → dist/ (static, no server); `npm run gate7` for the
  full gate; `npm run matrix` + `node tools/ui-matrix.mjs` for the deep sweeps.
- Adversarial gates: `npx tsx tools/edge-matrix.ts` (engine/state edges) and
  `node tools/ui-edge.mjs` (browser edge attacks; also regenerates the
  design-review screenshots into ../shots/review/). Run ALL suites before
  shipping zips.

## UX invariants (owner-approved, keep true)
- Refusals render as plain sentences via friendlyRefusal(); raw engine text
  stays behind the "Engine detail" disclosure. Quota refusals with an
  achievable rate offer one-click "Set target to N/wk".
- Starter world is 3 planets (Storm/Gas/Barren, first expanded) so a fresh
  Max/Quota solve WORKS out of the box — never ship a default world that
  refuses its own default product.
- Duplicate planet names flag inline (.v9-dup-tag) as typed.
- Planet removal is a confirmed ✕ (title "Remove this planet"), never a
  labeled pill.
- Quick detail demands the security band only for ores the chosen goal can
  use (Compare: any zero counts).
- rerender() is re-entrancy-guarded — do not call render functions directly
  from event handlers; always go through rerender().
- Chains visualizer icons: REAL CCP icons at runtime via the legacy globals
  iconUrl()/TYPE_IDS (and planetIconUrl()/PLANET_TYPE_IDS) from
  static/legacy/01-data.js — the one type-id source of truth, shared with
  Market Reference. Drawn glyphs are the instant/offline fallback; never
  remove them, and never restate type ids elsewhere.

## Non-negotiables
- Footer credit "Fenris Creations (formerly CCP Games)" is CORRECT and
  deliberate — never change it.
- No code or fixture may be based on the owner's personal colony data.
