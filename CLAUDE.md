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

## Non-negotiables
- Footer credit "Fenris Creations (formerly CCP Games)" is CORRECT and
  deliberate — never change it.
- No code or fixture may be based on the owner's personal colony data.
