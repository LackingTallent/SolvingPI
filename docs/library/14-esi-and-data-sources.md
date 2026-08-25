# ESI and Data Sources (for a PI Profit Planner)

*Researched 2026-08-25. ESI changed substantially in 2025–2026 (compatibility-date versioning, real rate limiting, market-orders bucket) — details below.*

---

## 1. ESI basics in 2026

- Base URL: `https://esi.evetech.net`. Official docs and interactive API explorer: [developers.eveonline.com](https://developers.eveonline.com/) (the old Swagger UI / docs.esi.evetech.net content has migrated there).
- **Versioning changed (2025)**: routes no longer need `/latest/` or `/vN/` prefixes. New style: call `https://esi.evetech.net/markets/{region_id}/orders/` and send an **`X-Compatibility-Date: YYYY-MM-DD`** header (or `compatibility_date` query param). ESI serves the behavior matching that date; roughly one year of backward compatibility is maintained. Old `/latest/`, `/v1/`… routes "still work and will work for the foreseeable future," but new endpoints are compatibility-date-only. Source: [Changing versions: /v42/ was getting out of hand](https://developers.eveonline.com/blog/changing-versions-v42-was-getting-out-of-hand).
- **User-Agent is required practice**: include app name+version and a contact (email strongly preferred), e.g. `PIPlanner/1.0 (contact@example.com)`. Browsers drop `User-Agent` on fetch — use **`X-User-Agent`** header or `user_agent` query param from web apps. Source: [ESI best practices](https://developers.eveonline.com/docs/services/esi/best-practices/).

### Caching rules
Every response carries `Expires`, `Last-Modified`, and `ETag`. Re-requesting before `Expires` returns cached data and wastes your quota; use `If-None-Match` with the ETag to get cheap 304s. **"Circumventing the ESI caching can get you banned from ESI."** ([best practices](https://developers.eveonline.com/docs/services/esi/best-practices/))

### Error-limit regime
Headers `X-ESI-Error-Limit-Remain` / `X-ESI-Error-Limit-Reset`: exceed the error budget in a window and **all** requests are discarded until reset. Treat any 4xx spike as a stop signal.

### Rate limiting (new, rolled out Oct 2025 – 2026)
ESI now has real token-bucket rate limits per **rate-limit group × identity** (identity = `appID:characterID` for authed calls, source IP for unauthed). Token costs by response status: **2xx = 2, 3xx = 1 (rewards ETag revalidation), 4xx = 5, 5xx = 0**; tokens return after 15 minutes. Headers: `X-Ratelimit-Group`, `X-Ratelimit-Limit` (e.g. `150/15m`), `X-Ratelimit-Remaining`, `X-Ratelimit-Used`; 429 + `Retry-After` when exhausted. Not all routes have limits yet. Sources: [Rate limiting docs](https://developers.eveonline.com/docs/services/esi/rate-limiting/), [Hold your horses: introducing rate limiting to ESI](https://developers.eveonline.com/blog/hold-your-horses-introducing-rate-limiting-to-esi).

- **Market orders bucket (2026-02-24)**: `/markets/{region_id}/orders/` got a **12,000-token bucket** (window is the standard 15-minute token return; CCP's own math: pulling *all* 113 regions every 5 minutes costs ~10,338 tokens, i.e. just under the cap). The route's cache is 5 minutes — poll no faster, fetch only regions you need. Source: [Market orders rate limit rolls out on February 24, 2026](https://developers.eveonline.com/blog/market-orders-rate-limit-rolls-out-on-february-24-2026).
- The older special limit on `/markets/{region_id}/history/` (300 req/min per IP, since 2020 — see [esi-issues #1338](https://github.com/esi/esi-issues/issues/1338)) predates the new regime; I could not confirm its current status under the bucket system — assume history is expensive and cache it aggressively (data only changes once per day anyway).

---

## 2. ESI endpoints a PI planner needs

Paths shown unversioned (new style); all exist under `/latest/` too. Cache times as documented in the API explorer.

**Market (public):**
- `GET /markets/{region_id}/orders/?order_type=all&type_id={id}` — live order book; paginated via `X-Pages`; **5-min cache**. The Forge = `10000002`; filter Jita 4-4 with `location_id == 60003760`.
- `GET /markets/{region_id}/history/?type_id={id}` — daily OHLC/avg + volume + order_count per day, ~13 months; updates once daily after downtime. One type per call — do not enumerate all types naively.
- `GET /markets/prices/` — `adjusted_price` / `average_price` for every type (hourly cache). Use for industry cost indices / rough valuations only, **not** achievable market prices.
- `GET /markets/structures/{structure_id}/` — order book of a player structure (auth: `esi-markets.structure_markets.v1`). Only needed if supporting structure-hub selling.
- `GET /markets/{region_id}/types/` and `/markets/groups/` — enumeration helpers.

**Planetary Industry:**
- `GET /characters/{character_id}/planets/` — list of a character's colonies (planet_id, type, upgrade level, num_pins). **Auth scope: `esi-planets.manage_planets.v1`.**
- `GET /characters/{character_id}/planets/{planet_id}/` — full colony layout: pins (extractors with cycle info, factories with schematic_id, storage/launchpads with contents), links, routes. Same scope. Lets the tool import a player's actual setups instead of hand-entry.
- `GET /universe/schematics/{schematic_id}/` — schematic name + cycle_time only (inputs/outputs come from the SDE, see below).
- `GET /characters/{character_id}/customs_offices/ (corporation equivalent under /corporations/)` — only relevant if the user owns POCOs.

**Universe / routing:**
- `GET /universe/systems/{system_id}/`, `GET /universe/planets/{planet_id}/` — names, positions, planet type.
- `GET /route/{origin}/{destination}/?flag=secure|shortest|insecure` — jump count for freight-cost estimates.
- `GET /universe/types/{type_id}/` — type name, **volume** (packaged), group; fine for spot lookups, but bulk type data belongs in the SDE.

**Auth**: OAuth2 SSO via `login.eveonline.com` (PKCE for web/native apps); register the app at [developers.eveonline.com](https://developers.eveonline.com/) and request only `esi-planets.manage_planets.v1` (plus `esi-markets.structure_markets.v1` if needed). A pure calculator can run entirely unauthenticated.

---

## 3. The Static Data Export (SDE)

**What it is**: CCP's dump of all static game data — types (names, volumes, groups), planet schematics, map data, NPC corps, etc. ([EVE Uni: Static Data Export](https://wiki.eveuniversity.org/Static_Data_Export))

**Major 2025 change**: CCP relaunched the SDE on **2025-09-22** at [developers.eveonline.com/static-data](https://developers.eveonline.com/static-data) in **JSON Lines** format (alongside YAML), auto-built with every Tranquility deployment, and **not backwards compatible** with the old YAML layout (bsd/universe folders removed, some files split). Source: [Reworking the SDE: a fresh start for static data](https://developers.eveonline.com/blog/reworking-the-sde-a-fresh-start-for-static-data). Pin your importer to one format and expect churn.

**Community conversions** (usually easier): Steve Ronuken's Fuzzwork conversions at [fuzzwork.co.uk/dump](https://www.fuzzwork.co.uk/dump/) — SQLite (`sqlite-latest.sqlite.bz2`), MySQL, Postgres, MSSQL, CSV, updated per SDE release; per-table CSVs under `/dump/latest/`. ([EVE Uni SDE page](https://wiki.eveuniversity.org/Static_Data_Export) confirms formats.) Also: [EVE Ref datasets](https://docs.everef.net/datasets/sde.html) mirrors the SDE and derived data.

**PI-specific tables** (names per the classic conversion; the JSONL SDE has equivalents):
- `planetSchematics` — schematic id, name, **cycle time**
- `planetSchematicsTypeMap` — inputs/outputs per schematic with **quantities** (this is the P0→P1→P2→P3→P4 recipe graph)
- `planetSchematicsPinMap` — which pin (factory) types can run which schematic
- `invTypes` — type names + **packaged volumes** (PI commodity m³)
- `mapRegions/mapSolarSystems` (or JSONL map equivalents) — region/system ids for routing and market queries

**SDE vs hardcode vs live — recommendation for a PI tool:**
| Data | Source |
|---|---|
| Schematic graph, cycle times, quantities | SDE (ship a pre-baked JSON extracted at build time; changes only on patches) |
| Type names, volumes, ids | SDE, same pre-baked file |
| Fee formulas / base rates / POCO base values | Config constants with in-app override (CCP changes them by patch; see file 13) |
| Prices, order books, history | Live (ESI or aggregator), cached server-side |
| Character colonies | Live ESI, authed |
| Region/station ids for hubs (Jita 4-4 = 60003760 etc.) | Hardcode the handful of hubs |

Re-extract the SDE bake on each EVE patch; the PI recipe graph changed as recently as Viridian (June 2023, some P1→P2 substitutions and a global volume halving — see file 15).

---

## 4. Third-party price APIs

- **Fuzzwork market aggregates** — `https://market.fuzzwork.co.uk/aggregates/?station=60003760&types=2073,3645...` (also `region=` / `system=`; region `0` = global). Returns per-type buy/sell: `weightedAverage, max, min, stddev, median, volume, orderCount, percentile` (the 5% percentile is the community-standard "realistic" price). Docs: [market.fuzzwork.co.uk/api](https://market.fuzzwork.co.uk/api/). Built from ESI ordersets (~30-min cadence implied; exact refresh not stated). Free; be gentle, batch types into few calls, cache — Steve explicitly asks heavy users to pull from CCP directly.
- **EVE Tycoon** — `https://evetycoon.com/api/v1/market/stats/{regionId}/{typeId}` (market stats incl. `sellAvgFivePercent`-style fields); JSON. Docs at [evetycoon.com/docs](https://evetycoon.com/docs) (interactive; not fully confirmable by static fetch), forum thread: [Eve Tycoon API](https://forums.eveonline.com/t/eve-tycoon-api/416478). Refresh rate and rate limits **not confirmed** — verify in their docs/Discord before depending on it. Tycoon also has a PI profit tracker (feature overlap ≈ competitor reference).
- **Adam4EVE** — [api.adam4eve.eu](https://api.adam4eve.eu/): `market_prices` (live buy/sell per locationID/typeID), `market_price_history` (daily, ≤20 typeIDs per call, ~1 year back), `market_percentiles` (5% percentile). **Rate limit: 1 request / 5 seconds; User-Agent with contact required; violators banned without warning.** Bulk CSV dumps at `static.adam4eve.eu`. Good for history without hammering ESI.
- Others: **EVE Ref** (bulk datasets, [docs.everef.net](https://docs.everef.net/datasets/sde.html)); **Janice** (janice.e-351.com, appraisal API, API key by request — not verified here); EVEMarketer is **dead** (EVE Uni's old [API access to market data](https://wiki.eveuniversity.org/API_access_to_market_data) page is marked deprecated and points to Fuzzwork/EVE Tycoon).

**Architecture recommendation**: server-side price service that pulls Jita aggregates (Fuzzwork or own ESI ingestion) every 15–60 min, caches, and serves your frontend — never let browser clients hit ESI/aggregators directly (User-Agent problems, rate-limit sharing, CORS).

---

## 5. Compliance checklist

1. Descriptive User-Agent/X-User-Agent with contact on **every** request (ESI *and* Fuzzwork/Adam4EVE).
2. Honor `Expires`; use ETags (`If-None-Match`) — 3xx costs half the tokens of a 2xx.
3. Watch `X-Ratelimit-Remaining` and `X-ESI-Error-Limit-Remain`; back off on 420/429 with `Retry-After`.
4. Send `X-Compatibility-Date` on new-style routes; pin and test-bump it deliberately.
5. Stagger scheduled pulls; never burst all regions/types at once.
6. Developer License Agreement applies to ESI + SDE usage (no ISK-for-cash, etc.) — [developers.eveonline.com](https://developers.eveonline.com/).
