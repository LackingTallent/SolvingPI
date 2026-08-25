# Equinox Sov-Null Mechanics for a PI Planner: Orbital Skyhooks & Reagents

Research date: 2026-08-25. Covers the Equinox expansion (2024-06-11) and all published balance
changes through August 2026 (patch notes versions 22.01, 22.02, 23.01, 23.02, 24.01).

Primary sources:
- CCP support article "Orbital Skyhook": https://support.eveonline.com/hc/en-us/articles/14339732733724-Orbital-Skyhook (last updated 2026-06-18)
- Equinox expansion notes: https://www.eveonline.com/news/view/equinox-expansion-notes
- CCP dev blog "Sovereignty, Structures & Transition": https://www.eveonline.com/news/view/sovereignty-structures-and-transition
- "Equinox Update: Enhanced Skyhooks" (2024-09-25): https://www.eveonline.com/news/view/equinox-update-enhanced-skyhooks
- Patch notes v22.02: https://www.eveonline.com/news/view/patch-notes-version-22-02
- Patch notes v23.01 (incl. Legion, 2025-09-09): https://www.eveonline.com/news/view/patch-notes-version-23-01
- Patch notes v23.02 / v24.01 (Nov 2025 – Aug 2026): https://www.eveonline.com/news/view/patch-notes-version-23-02 , https://www.eveonline.com/news/view/patch-notes-version-24-01
- EVE University wiki: https://wiki.eveuniversity.org/Orbital_Skyhook , https://wiki.eveuniversity.org/Planetary_Industry
- ESI dev blog "Equinox on ESI" (2026-05-19): https://developers.eveonline.com/blog/equinox-on-esi-structures-sovereignty-and-access-lists

Anything marked **[UNPUBLISHED/UNCERTAIN]** could not be confirmed from an authoritative source.

---

## 1. What an Orbital Skyhook is

- Deployable structure anchored **in orbit of a planet in player-owned sovereign nullsec only**;
  **exactly one per planet**; can be attached to **all planet types** (CCP support article).
- It is **required to extract resources from planets in nullsec** under the Equinox sov system and
  **"retains the functionality of the customs office"** — i.e. it *is* the customs office for that
  planet, plus the new colony-resource interface (support article).
- CCP's sov transition blog is explicit: *"Skyhooks will also act as an upgraded version of a
  player owned customs office (POCO), filling all the same roles as the POCO does for planetary
  industry."* (https://www.eveonline.com/news/view/sovereignty-structures-and-transition)
- Combat profile: a **single reinforcement cycle**, HP/resists/damage-cap similar to medium Upwell
  structures (Raitaru/Athanor). Destroying a Skyhook removes any Power/Workforce it supplied from
  the system's Sovereignty Hub; on death there is a **50% chance to drop the contents of both the
  Secure and Surplus bays** (Nosy Gamer patch-notes coverage of the Oct 2024 rework,
  https://nosygamer.blogspot.com/2024/10/eve-online-patch-notes-skyhook.html).
- Skyhooks attract hostile pirate NPCs "just like asteroid belts do" (support article).
- No fuel requirement for the Skyhook itself is documented anywhere. Sovereignty **Hub upgrades**
  consume fuel/reagents; the Skyhook does not appear to. **[UNPUBLISHED/UNCERTAIN — absence of
  evidence, not an explicit CCP statement.]**

### Who can anchor one
- Only in **player-owned sovereign null security space** (support article) — in practice the
  alliance holding sovereignty (via its corporations) deploys it. Onlining takes **30 minutes**,
  and since Legion (2025-09-09) Skyhooks **can be configured during that 30-minute onlining
  window and remotely via the "My Orbital Skyhooks" page** (patch notes v23.01).
- When sovereignty changes hands, there is a **governance window** for Skyhook management,
  extended **from 1 hour to 24 hours** in the Legion update (patch notes v23.01, 2025-09-09).
- **[UNCERTAIN]** whether the anchoring corp must hold specific sov roles; CCP has not published
  the exact permission matrix.

---

## 2. Skyhook as customs office: import/export tax mechanics

Confirmed chain of facts:

1. During the 2024 Equinox transition, when a Skyhook finished onlining over a planet with an
   existing POCO, *"the old POCO automatically transports all stored Planetary Industry materials
   to the new skyhook and **copies all PI taxation settings** to the new skyhook, then
   self-destructs."* (CCP, Sovereignty, Structures & Transition blog). PI taxes on a Skyhook are
   therefore the **same tax system as a POCO** — owner-set rates applied to NPC base cost.
2. Standard PI tax formulas (EVE University, https://wiki.eveuniversity.org/Planetary_Industry):
   - **Export fee = base cost × tax rate** (×1.5 if launched via Command Center instead of a
     Launchpad)
   - **Import fee = base cost × tax rate × 0.5**
   - Base costs used for tax: **P0 = 5 ISK, P1 = 400, P2 = 7,200, P3 = 60,000, P4 = 1,200,000**.
   - The ×0.5 import and ×1.5 command-center-launch multipliers are part of the generic customs
     mechanic and there is **no published statement that Skyhooks alter them**.
3. **No NPC tax component in nullsec.** The 10%-base NPC rate and the Customs Code Expertise skill
   (−1%/level) apply **only to POCOs in highsec**; the skill "has no effect in null, low-sec, or
   wormhole space" (EVE University, https://wiki.eveuniversity.org/Tax). So through a Skyhook, tax
   = owner-set rate only.
4. **Who sets the rate:** the Skyhook's owner (the sov-holding alliance/corp). Access is governed
   by an **Access Control List (ACL)** (CCP transition blog), and alliances routinely publish
   standings-based rates (e.g. Winter Coalition caps member Skyhook/POCO tax at 0.2%:
   https://wiki.winterco.org/en/rules/structure/pocos). Legion (2025-09-09) added an **"Access"
   (Custom Office) button in the Planetary Industry window** next to View/Warp-To (patch notes
   v23.01), i.e. the client treats the Skyhook as the planet's customs office.
5. **[UNCERTAIN]** whether the Skyhook tax UI offers exactly the same standings-tier rate table as
   a POCO (neutral/bad/good/excellent/corp/alliance) — strongly implied by "copies all PI taxation
   settings" and by community rules referencing standing tiers, but CCP has not published the
   settings screen anywhere fetchable.

**Planner implication:** model a sov-null planet's tax exactly like a POCO with NPC rate 0 and an
owner rate variable (typically 0–5%, often near 0 in organized alliances); keep the ×0.5 import
and ×1.5 CC-launch multipliers unchanged.

---

## 3. Colony resources: Power, Workforce, Reagents (sov upgrade economy)

Skyhooks passively produce one resource class determined by planet type (support article,
expansion notes):

| Resource | Planet types | Transportable? | Used for |
|---|---|---|---|
| **Power** | Gas, Storm, Plasma (plus the system's star: large blue suns most, small orange least) | No — local to the system | Activating Sovereignty Hub upgrades |
| **Workforce** | Barren, Oceanic, Temperate (amount varies by planet) | Yes — between directly-connected systems of the same alliance, via the Sov Hub | Activating Sovereignty Hub upgrades |
| **Reagents** | **Magmatic Gas** from Lava planets; **Superionic Ice** from Ice planets | Yes — physical items (tradable, transportable, lootable) | Fuel-like inputs for specific upgrades/structures |

Reagent sinks (support article, expansion notes, patch notes):
- **Magmatic Gas** (type ID 81143, volume **0.01 m³** since Legion 2025-09-09; was 0.1 m³ at
  launch — patch notes v23.01; item data: https://everef.net/types/81143): fuels **Metenox Moon
  Drills** (consumption raised 110→**150/hour** on 2025-03-12 (v22.02), then 150→**200/hour**
  (4,800/day) on 2025-09-09 (v23.01)) and **cynosural system upgrades**.
- **Superionic Ice** (type ID 81144, market group "Colony Reagents",
  https://everef.net/types/81144): fuels **Advanced Logistics Network (Ansiblex jump gate)** and
  **Supercapital Construction Facilities** upgrades. Volume: 0.01 m³ per recent market data
  **[UNCERTAIN — CCP only documented the Magmatic Gas volume change explicitly]**.

### How reagent extraction works
- **Fully automatic/passive** at the Skyhook — no player skill, no extractor heads, no colony.
  *"Immature Reagents will be produced over time ... and will slowly become mature, at which point
  they can be extracted by players. Skyhooks yield will gradually improve over time as their
  immature bay becomes larger"* (Equinox expansion notes). i.e. output **ramps up** the longer the
  Skyhook runs undisturbed.
- Production is split **50/50 between a Secure Bay and a Surplus Bay** (Oct 2024 rework):
  - **Secure Bay** — accessible to owner/ACL at all times, never affected by raids.
  - **Surplus Bay** — the raidable half (100% drop on a successful raid).
  (CCP "Enhanced Skyhooks" 2024-09-25; support article.)
- **No player skill and no other structure affects yield.** Nothing published ties yield to
  anything except planet type and the maturation ramp. **[UNPUBLISHED]: exact units/hour rates.
  CCP has never published per-planet reagent rates; the support article only says yields "ramp
  over time" and that an unraided Skyhook's rollover holds "resources equivalent to 6-8 days."
  A planner should treat reagent income as per-planet empirical data, not a formula.**
- **[UNCERTAIN]** whether planet size/system stats modulate reagent rate (they do for Power —
  star class — and Workforce — planet-dependent amounts). No source confirms variance for
  reagents specifically.

---

## 4. Moving/selling reagents and the raiding (theft) risk

- Reagents are ordinary items once collected: *"tradable, transportable, and lootable"* (CCP
  transition blog). They trade on the open market under **Manufacture & Research > Materials >
  Colony Reagents** (https://everef.net/market/3596). At 0.01 m³, hauling is trivial; market risk
  is price volatility driven by Metenox fuel demand (CCP explicitly rebalanced Metenox economics
  twice — Mar 2025 and Sep 2025 — citing reagent supply/demand).
- **Raid (theft) mechanic** — the structural economic risk (support article + Oct 2024 rework):
  - Skyhooks are raidable only during **scheduled vulnerability windows on a roughly 72-hour
    (3–4 day) cadence**. The window's start time is drawn from a **Gaussian around the owner's
    chosen hour, σ = 3 h** (68.2% within ±3 h, 4.2% in the tails, 0.2% opposite timezone).
    Windows are **publicly visible** (Agency, map, structure browser). Support article describes
    a ~2-hour vulnerable period; Nosy Gamer's patch-note transcription says 1 hour.
    **[UNCERTAIN: exact window length — sources disagree (1 h vs 2 h).]**
  - To steal: shoot the **Reagent Silo to below 10% shield**, then **link** with a
    **cruiser-size-or-larger combat ship or an Upwell hauler (no freighters), Omega clone**.
    Link takes **10 minutes**; while linked (and 2 min after) the ship **cannot warp, MJD, cloak
    or tether and is capped at 1,000 m/s**. Only **one ship** can link at a time.
  - **Notifications:** theft start alerts every pilot in-system; after 2 min, everyone 1 jump out;
    after 5 min, everyone within 2 jumps (support article).
  - **Payout:** success drops **100% of the Surplus Bay** into space (Oct 2024 change; at Equinox
    launch it was 40% of both bays with the remainder destroyed and the maturation ramp reset).
  - **Rollover:** if a window passes unraided, the Surplus Bay rolls over; when next vulnerable it
    holds **~6–8 days of production** (support article).
- Friendly theft: owners/ACL can trigger transfers; a "friendly theft" still alerts everyone
  within 2 jumps after 5 minutes (Nosy Gamer Oct 2024 coverage). **[UNCERTAIN on exact friendly-
  theft rules.]**

**Planner implication:** for reagent-revenue modeling, 50% of production is safe (Secure Bay), 50%
carries a raid-loss probability concentrated in one publicly-visible hour every ~3 days.

---

## 5. Interaction with classic P0–P4 PI

- **Classic PI is unchanged by Equinox.** No patch note from 22.01 through 24.01 alters extractor
  mechanics, ECU cycles, schematics, or P0–P4 chains. The Skyhook simply **replaces the POCO as
  the orbital import/export point** in sov null: colonies, command centers, launchpads, links,
  routes, and upgrade levels all work exactly as before, and the PI window now has an
  "Access (Custom Office)" button that points at the Skyhook (patch notes v23.01).
- **Both systems run simultaneously and independently on the same planet.** Reagent/Power/
  Workforce production is a property of the Skyhook structure and does not consume or interact
  with the planet's classic PI resource layer. On lava and ice planets you can run normal
  extractor colonies *and* the Skyhook passively produces reagents. (Support article: the Skyhook
  "retains the functionality of the customs office, allowing characters to continue using planets
  for Planetary Industry, **while also** opening up access to colony resources.")
- Losing the Skyhook (destroyed / sov change) means the planet temporarily has **no customs
  office**; colonies keep running but orbital import/export is unavailable until a new
  Skyhook (or POCO in non-sov space) exists. CC launches still work. **[UNCERTAIN: whether a
  regular POCO can be anchored in Equinox sov space at all — the design intent is Skyhook-only.]**
- QoL changes that matter to a planner (v22.02, 2025-03-12): PI **templates** for everyone,
  multi-pin schematic swap (Shift+click), route tab showing pin names, and **extractors
  restartable from the PI window** without opening the planet view.

---

## 6. Post-June-2024 balance-change timeline (all published changes)

| Date / version | Change |
|---|---|
| 2024-06-11 (Equinox, 22.01) | Skyhooks introduced; theft = 40% of both bays, remainder destroyed, ramp reset; constant raidability. |
| 2024-10 (22.01 update, "Enhanced Skyhooks") | Rework: timed, publicly visible vulnerability windows (~72 h cadence, Gaussian σ=3 h); Secure/Surplus 50/50 split; raids drop 100% of Surplus Bay; "significant increase in the amount of reagents extracted" (no numbers published); mandatory sov transition completed 2024-10-29. |
| 2025-03-12 (22.02) | Metenox Magmatic Gas consumption 110→150/h (raises gas demand). Sov mining upgrade tiers/power costs adjusted. |
| 2025-05-14 (22.02) | Sov hub upgrades offlined by choice go fully "Offline" (full restart cost); fuel-consumption bug fixes. |
| 2025-09-09 (23.01, Legion) | Magmatic Gas volume 0.1→**0.01 m³**; Metenox consumption 150→**200/h**; Skyhook remote configuration + config during onlining; governance window 1 h→24 h; PI-window customs Access button. |
| Nov 2025 – Aug 2026 (23.02, 24.01) | **No Skyhook/reagent/PI-tax changes** in published patch notes. |

---

## 7. What ESI exposes (and doesn't) — as of Aug 2026

From the dev blog **"Equinox on ESI: structures, sovereignty, and access lists" (2026-05-19)**
(https://developers.eveonline.com/blog/equinox-on-esi-structures-sovereignty-and-access-lists):

- **New sovereignty-structures route**: Sovereignty Hubs exposed alongside other Upwell
  structures — what's online in a system, owner, **remaining reagents (upgrade fuel)**, and
  installed upgrades.
- **Raidable Skyhooks route**: a rolling list of Skyhooks across New Eden that are
  **becoming-raidable or currently raidable** — i.e. the vulnerability windows are on ESI.
- **Access List (ACL) read route**: entities on an ACL (characters/corps/alliances,
  allowed/blocked) for authorized characters.
- **Consolidated sovereignty-systems route**: merges the old `/sovereignty/map/` +
  `/sovereignty/structures/` data, plus per-index (Military/Industry/Strategic) Activity Defense
  Multipliers.
- These routes exist **only under the new compatibility-date scheme** (header
  `X-Compatibility-Date: YYYY-MM-DD`), not under legacy `/v1/`–`/latest/` URLs (dev blog
  "Changing versions", 2025-07-10). Exact paths/scopes are in the API Explorer
  (https://developers.eveonline.com/api-explorer) — the blog does not print them.
  **[UNCERTAIN: exact route paths and scope names — confirm in the API Explorer / OpenAPI spec.]**

**Not exposed** (no evidence anywhere):
- Skyhook **Secure/Surplus bay contents** for owners; reagent **production rates**; Skyhook
  **tax rate settings** (the old `/corporations/{id}/customs_offices/` endpoint
  (scope `esi-planets.read_customs_offices.v1`) returns POCO tax schedules — whether Skyhooks
  appear there is **[UNPUBLISHED/UNCERTAIN]**, and no Skyhook-tax read endpoint was announced).
- Per-character reagent income; Power/Workforce balances of a Sov Hub beyond the "reagents left /
  upgrades installed" summary above.
- Classic PI colony endpoints (`/characters/{id}/planets/…`) are **unchanged** by Equinox.

---

## 8. Summary for the PI planner

1. In Equinox sov null, tax modeling = POCO model with NPC rate 0 and owner-set rate
   (import ×0.5, CC-launch ×1.5, same base costs). Nothing about Skyhooks changes P0–P4 math.
2. Reagents are a parallel, passive, colony-independent income stream on lava/ice planets;
   rates are unpublished — treat as data, not formula; 50% raid-exposed on a ~72 h cadence.
3. No skyhook-related balance changes since Sept 2025; system is stable as of Aug 2026.
4. ESI (May 2026) gives you raidable-Skyhook timers and sov-structure/ACL reads, but not bay
   contents, production rates, or Skyhook taxes.
