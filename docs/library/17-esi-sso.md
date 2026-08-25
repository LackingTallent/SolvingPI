# ESI SSO for a Browser-Based PI Tool (importing colonies via `esi-planets.manage_planets.v1`)

Research date: 2026-08-25.

Primary sources:
- Official SSO docs: https://developers.eveonline.com/docs/services/sso/
- esi-docs (source of the official docs): https://github.com/esi/esi-docs — native flow
  (`docs/sso/native_sso_flow.md`), web flow, refreshing tokens
  (https://docs.esi.evetech.net/docs/sso/refreshing_access_tokens.html), revoking tokens
  (`docs/sso/revoking_refresh_tokens.md`), creating an SSO application
  (https://docs.esi.evetech.net/docs/sso/creating_sso_application.html)
- ESI versioning: https://developers.eveonline.com/blog/changing-versions-v42-was-getting-out-of-hand (2025-07-10)
- Legacy route removals: https://developers.eveonline.com/blog/spring-cleaning-legacy-routes-removed-24-march-2026 (2026-02-24)
- ESI best practices: https://developers.eveonline.com/docs/services/esi/best-practices/
- CORS evidence: https://github.com/esi/esi-issues/issues/1058
- Planets endpoint schemas: ESI OpenAPI spec (mirrored at
  https://github.com/api-evangelist/eve-online, `openapi/eve-online-planetary-interaction-api-openapi.yml`)

Items marked **[UNCERTAIN]** are not confirmed by an authoritative source.

---

## 1. OAuth2 PKCE flow for a public client (no client secret)

EVE SSO supports exactly two flows (official SSO docs):
1. **Authorization Code** (confidential client, client secret, HTTP Basic auth on the token call) —
   for apps with a server.
2. **Authorization Code + PKCE** (public client, **no client secret anywhere**) — CCP: *"mostly
   aimed at mobile and desktop applications that cannot securely store the client secret"*; SPAs
   fall in the same category.

CCP recommends discovering endpoints from the OAuth metadata document rather than hardcoding:
`https://login.eveonline.com/.well-known/oauth-authorization-server` (SSO docs). The stable
endpoints it returns:

- **Authorize:** `https://login.eveonline.com/v2/oauth/authorize`
- **Token:** `https://login.eveonline.com/v2/oauth/token`
- **Revoke:** `https://login.eveonline.com/v2/oauth/revoke`
- **JWKS:** advertised in the metadata document (`jwks_uri`, currently
  `https://login.eveonline.com/oauth/jwks`)
- v1 SSO endpoints were deprecated years ago; **only /v2/ exists** (see
  https://developers.eveonline.com/blog/sso-endpoint-deprecations-2). The old
  `esi.evetech.net/verify` route now redirects to `login.eveonline.com/v2/oauth/verify` and the
  redirect was scheduled for removal 2026-04-28 (Spring-Cleaning blog) — **validate the JWT
  locally instead of calling /verify**.

### Step 1 — authorize request (browser redirect)

`GET https://login.eveonline.com/v2/oauth/authorize/?` with URL-encoded params (native flow doc):

| Param | Value |
|---|---|
| `response_type` | `code` |
| `client_id` | your app's client ID |
| `redirect_uri` | must **exactly** match a callback registered at developers.eveonline.com — *"If you put in any other URL other than what is defined in your SSO application the EVE SSO will reject your request"* |
| `scope` | space-delimited, URL-encoded — for this tool: `esi-planets.manage_planets.v1` |
| `state` | random per-request string; **required** by EVE SSO (CSRF protection; also handy to tag which character slot is being authed) |
| `code_challenge` | base64url( SHA-256( code_verifier ) ), **no padding** (RFC 4648 base64url) |
| `code_challenge_method` | `S256` — *"only method currently accepted"* |

**code_verifier rule** (native flow doc): *"generate 32 random bytes and base64url encode them"*
(→ 43-char verifier); the challenge is the base64url of the **raw** SHA-256 hash output. In a
browser: `crypto.getRandomValues` + `crypto.subtle.digest('SHA-256', …)`.

### Step 2 — token exchange

`POST https://login.eveonline.com/v2/oauth/token`
`Content-Type: application/x-www-form-urlencoded` — body:

```
grant_type=authorization_code&code=<code>&client_id=<client_id>&code_verifier=<verifier>
```

No Authorization header, no secret. Response:

```json
{ "access_token": "<JWT>", "expires_in": 1199, "token_type": "Bearer", "refresh_token": "<opaque>" }
```

Access tokens live **~20 minutes** (`expires_in` 1199 s) (native flow doc).

### Step 3 — JWT validation (SSO docs, "validating JWT tokens")

- **Signature:** fetch JWKS via metadata `jwks_uri`; pick key by the JWT header `kid`; keys are
  RS256/ES256. Cache the JWKS.
- **Issuer:** accept `https://login.eveonline.com` or `login.eveonline.com` (docs note both forms
  have been emitted).
- **Audience:** `aud` is an array containing **your `client_id` and the literal `"EVE Online"`** —
  verify your client_id is present.
- **Expiry:** standard `exp` check.
- Useful claims: `sub` = `EVE:CHARACTER:<character_id>` (parse the character ID from here),
  `name` = character name, `scp` = scope(s) granted, `owner` = owner hash (changes if the
  character is transferred — re-auth signal).
- For a pure-client app this validation is defense-in-depth (you fetched the token yourself over
  TLS); it becomes mandatory the moment any backend trusts a token handed to it.

---

## 2. Refresh tokens for PKCE apps

- **Grant:** `POST /v2/oauth/token`, form body
  `grant_type=refresh_token&refresh_token=<rt>&client_id=<client_id>` — public clients send
  `client_id` in the body, **no Basic auth** (refreshing-tokens doc). Optional `scope` param may
  request a **subset** of originally granted scopes (down-scoping).
- **Lifetime:** *"can be stored and used indefinitely"* until revoked (refreshing-tokens doc);
  there is **no published fixed expiry**.
- **Rotation:** for native/public apps CCP says to treat the refresh token as **volatile** —
  *"you should always be prepared to receive a new refresh token every time you refresh your
  access tokens"* and *"the refresh_token returned may not be the same as the refresh token
  submitted"*. So: **always overwrite the stored refresh token with the one in each response.**
  Losing a rotated token (e.g. two tabs racing a refresh) can orphan the grant → serialize
  refreshes per character. **[UNCERTAIN: whether rotation-with-invalidation is currently enforced
  or the old token stays valid; CCP wording reserves the right either way.]**
- **What kills a refresh token / forces re-login:**
  - user revokes the app on the third-party-applications support page
    (https://community.eveonline.com/support/third-party-applications/);
  - explicit `POST /v2/oauth/revoke` with `token_type_hint=refresh_token&token=<rt>` (public
    clients include `client_id` in the body; confidential clients use Basic auth; server returns
    200 even for already-invalid tokens) (revoking doc);
  - account password change / account security events **[UNCERTAIN — community-observed,
    not explicitly documented]**;
  - changing your app's **requested scopes or callback** on the dev site invalidates existing
    grants **[UNCERTAIN — long-standing community observation]**.
  - Failure mode: the token endpoint returns 400 `invalid_grant` — that is your "re-login
    required" signal; surface it per character.

---

## 3. Registering the app at developers.eveonline.com

(Creating-an-SSO-application doc: https://docs.esi.evetech.net/docs/sso/creating_sso_application.html)

- Log in at https://developers.eveonline.com with an EVE account, accept the developer license,
  Applications → Create New Application. Historically the account must have been Omega/paid at
  least once to accept the license **[UNCERTAIN whether still enforced in 2026]**.
- **Connection type:** choose **"Authentication & API Access"** (needed for ESI scopes); select
  the scopes the app may request — for this tool just `esi-planets.manage_planets.v1` (add
  `esi-universe.read_structures.v1` etc. only if actually used). Scopes requested at login must
  be a subset of the registered set.
- **Callback URL:** must match `redirect_uri` exactly (scheme/host/path). `https://localhost/...`
  is fine for development, but *"never use localhost as a callback URL for an application you have
  released."* Editable after creation. **[UNCERTAIN: whether multiple callback URLs per app are
  supported — the docs show a single field; register separate dev/prod apps if needed.]**
- The portal issues a **client ID** (and a secret — which a public/PKCE client simply never uses;
  the current portal has a native/public-client option that omits the secret
  **[UNCERTAIN: exact 2026 portal UI]**).
- **Rate limits tied to auth:** none published for the SSO token endpoint. On ESI itself there is
  no global request cap, but (a) the **error limit** — exceed the error budget per rolling window
  and you get HTTP 420 (headers `X-ESI-Error-Limit-Remain` / `X-ESI-Error-Limit-Reset`) — and
  (b) since 2026-02-24 **per-endpoint bucket rate limits** are rolling out, starting with market
  orders (https://developers.eveonline.com/blog/market-orders-rate-limit-rolls-out-on-february-24-2026).
  Planets endpoints have **no dedicated bucket** as of Aug 2026. Always send a descriptive
  **User-Agent / X-User-Agent** with contact info (best-practices doc); never bust the cache
  ("can get you banned from ESI").

---

## 4. Pure client-side PKCE vs a token-exchange backend (2026 status)

- **Officially supported?** PKCE is the documented flow for clients that cannot hold a secret;
  CCP's docs name "mobile and desktop" and do not explicitly bless or forbid browser SPAs.
  There is **no CCP statement requiring a backend**, and no official CORS documentation.
- **CORS reality:** `login.eveonline.com/v2/oauth/token` has returned
  `access-control-allow-origin: *` with `OPTIONS, GET, POST` allowed (see
  https://github.com/esi/esi-issues/issues/1058 — the complaint there was a missing
  `Access-Control-Allow-Headers: authorization`, which **only affects Basic-auth (confidential)
  calls; a PKCE exchange sends no Authorization header**, so browser preflights pass).
  ESI itself (`esi.evetech.net`) fully supports CORS. Community SPAs have run browser-only PKCE
  against EVE SSO for years. **[UNCERTAIN: CORS behavior is observed, not contractually
  documented — it could change without notice.]**
- **Trade-offs:**
  - *Pure client-side:* zero infrastructure; refresh tokens live in the browser (localStorage/
    IndexedDB) where any XSS can read them; if CCP ever tightens CORS the app breaks outright.
  - *Cloudflare Worker token proxy:* ~50 lines; the Worker only forwards
    `authorization_code`/`refresh_token` POSTs to login.eveonline.com and adds CORS headers you
    control; keeps working regardless of CCP CORS policy; still a public client (no secret), or
    optionally upgrade to a confidential client with the secret in the Worker + encrypted
    HttpOnly session cookies for stronger token custody.
- **Recommendation:** ship PKCE with the token calls behind a tiny Worker proxy (or at least an
  abstraction that can flip between direct and proxied). You keep the static-site architecture,
  gain immunity to CORS policy drift, and can later move refresh-token custody server-side
  without re-architecting.

---

## 5. The planets endpoints (importer contract)

Scope for both: **`esi-planets.manage_planets.v1`**. (Schemas per the ESI OpenAPI spec; field
lists verified against the spec mirror — https://github.com/api-evangelist/eve-online.)

**URL style (2026):** new-style base is `https://esi.evetech.net/characters/{character_id}/planets`
with header `X-Compatibility-Date: <YYYY-MM-DD>` (or `?compatibility_date=`); legacy
`/latest|/v1|.../characters/{id}/planets/` URLs still work "indefinitely" for existing routes but
are deprecated, and meta-routes (`/swagger.json`, `/versions/`, `/status.json`, `/verify`) were
removed 2026-03-24 (versioning + Spring-Cleaning blogs). Pin a compatibility date at release and
bump deliberately.

### GET `/characters/{character_id}/planets/` — colony list
Cache: **600 s** (Cache-Control/Expires/ETag/Last-Modified all present). Array (≤ all colonies,
game cap is 6/char) of:

```
planet_id        int32   required
solar_system_id  int32   required
planet_type      enum    required  temperate|barren|oceanic|ice|gas|lava|storm|plasma
owner_id         int32   required  (character id)
last_update      datetime required
upgrade_level    int32   required  0-5 (Command Center upgrade level)
num_pins         int32   required  >=1
```

### GET `/characters/{character_id}/planets/{planet_id}/` — colony layout
Cache: 600 s **[UNCERTAIN: the spec mirror confirms 600 s for the list route; the detail route has
historically also been 600 s — verify header at runtime]**. Response object:

- **`pins`** (array, ≤100): `pin_id` int64, `type_id` int32 (the pin's structure type: command
  center, extractor control unit, launchpad, storage, factories), `latitude`/`longitude` float,
  optional `schematic_id` int32, optional `install_time`, `expiry_time`, `last_cycle_start`
  (date-times), optional `contents` (array ≤90 of `{type_id int32, amount int64}`),
  - optional **`extractor_details`**: `cycle_time` int32 (seconds), `head_radius` float,
    `heads` (array ≤10 of `{head_id 0-9, latitude, longitude}`), optional `product_type_id` int32,
    optional `qty_per_cycle` int32,
  - optional **`factory_details`**: `{schematic_id int32}`.
- **`links`** (array, ≤500): `{source_pin_id int64, destination_pin_id int64, link_level 0-10}`.
- **`routes`** (array, ≤1000): `{route_id int64, source_pin_id int64, destination_pin_id int64,
  content_type_id int32, quantity float, waypoints?: array ≤5 of pin ids}`.

Supporting public (no-auth) route: **GET `/universe/schematics/{schematic_id}/`** →
`{schematic_name, cycle_time}` (cache 3600 s). Inputs/outputs of schematics are **not** in ESI —
take them from the SDE (invSchematics tables) shipped with the app.

**Importer gotchas:**
- ESI returns a **snapshot, not a simulation**: extractor `qty_per_cycle` is the *first* cycle's
  base quantity; per-cycle yield decays over the program per the documented extractor formula
  (esi-docs PI guide, https://github.com/esi/esi-docs — `docs/guides/pi.md`
  **[UNCERTAIN: current path]**), so the importer must simulate cycles from `install_time`,
  `cycle_time`, `expiry_time`, `qty_per_cycle`.
- `contents`/`last_update` reflect the server's last colony evaluation (typically when the owner
  last opened the colony in-client); do not treat storage contents as live.
- An expired extractor keeps its pins; detect `expiry_time < now`.
- 404/403 appear per character if the token lacks the scope or the character has no colonies;
  handle per-character, don't abort the batch.
- Honor `Expires`/`ETag` (send `If-None-Match`, expect 304): with a 600 s cache there is no point
  polling faster, and cache-busting is a bannable offense (best-practices doc). Note the Jan 2026
  "smarter caching" change moves some routes to event-driven invalidation
  (https://developers.eveonline.com/blog/smarter-caching-when-events-drive-invalidation) — trust
  the headers rather than hardcoding 600 s.

---

## 6. Multi-character support (e.g. 28-character PI operations)

No official multi-character pattern exists; established community practice (SeAT, AllianceAuth,
EVE Tycoon-style tools):

- **One SSO app, N logins.** Each character is a separate PKCE authorization → separate
  access/refresh token pair. Use `state` to carry a nonce **plus** which slot initiated login;
  after callback, read the character from the JWT (`sub`, `name`, `owner`) — never trust the UI
  slot alone.
- **Adding characters:** EVE SSO reuses the live login-session cookie, so "Add character" should
  send `prompt`-less users through the normal authorize URL; the account picker on
  login.eveonline.com lets them switch characters. 28 characters = 28 round trips; make it a
  resumable checklist UX. **[UNCERTAIN: EVE SSO has no documented `prompt=select_account`
  parameter; character switching is handled by CCP's own login UI.]**
- **Storage (client-side):** persist per character
  `{character_id, name, owner_hash, refresh_token, access_token, expires_at, scopes}` in
  IndexedDB. Refresh tokens are bearer credentials — if staying backend-less, at minimum wrap
  them with WebCrypto and a non-extractable key; with a Worker backend, prefer server-side
  encrypted storage keyed by an HttpOnly session.
- **Refresh discipline:** refresh lazily (on demand when `expires_at - now < 60 s`), serialize
  per character (rotation!), and stagger bulk refreshes — 28 near-simultaneous token calls is
  fine today but gains nothing. A refresh failing with `invalid_grant` marks that character
  "needs re-login" without touching the others.
- **Watch `owner`:** if the owner hash changes, the character was transferred — drop tokens and
  require fresh consent (SSO docs).
- **Fetch pattern for 28 chars:** 28× colony list + up to 168× colony detail every 600 s worst
  case is well within ESI norms if you use ETags; batch with modest concurrency (~10) and back
  off on any `X-ESI-Error-Limit-Remain` approaching 0.

---

## 7. Bottom line for this tool

1. Register one "Authentication & API Access" app with scope `esi-planets.manage_planets.v1`
   and your production callback; use PKCE (S256, 32-byte verifier), `state` per request.
2. Exchange/refresh at `login.eveonline.com/v2/oauth/token` with `client_id` in the body;
   always store the returned refresh token; treat `invalid_grant` as "re-login this character."
3. Validate JWTs locally (issuer login.eveonline.com, `aud` contains client_id + "EVE Online",
   JWKS via well-known metadata); do not call the removed `/verify` route.
4. Call planets endpoints with `X-Compatibility-Date`, honor ETag/Expires (600 s), simulate
   extractors client-side, pull schematic I/O from the SDE.
5. Browser-only PKCE works today (CORS `*` on the token endpoint) but is undocumented; a
   ~50-line Cloudflare Worker token proxy is cheap insurance and the recommended default.
