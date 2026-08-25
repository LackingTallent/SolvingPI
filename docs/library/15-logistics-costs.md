# Logistics Costs: Getting PI Output to Market

*Researched 2026-08-25. Freight rates are player-set and volatile — treat every ISK figure here as a dated reference point, not a constant. Confirmed-vs-unconfirmed status is flagged throughout.*

---

## 1. PI commodity volumes (the freight-relevant constants)

**Important recent change**: the **Viridian expansion (June 2023) halved all PI commodity volumes** — "Volume of all PI commodities reduced by 50%" ([patch-note coverage](https://nosygamer.blogspot.com/2023/06/eve-viridian-patch-notes-ecosystem-and.html)). Many older guides/tools still show the pre-2023 doubled numbers. Current per-unit volumes ([EVE Uni: Planetary Commodities](https://wiki.eveuniversity.org/Planetary_Commodities)):

| Tier | m³/unit | Typical value density |
|---|---|---|
| P0 (raw) | 0.005 | very low — never haul P0 to market |
| P1 (processed) | 0.19 | low–medium |
| P2 (refined) | 0.75 | medium |
| P3 (specialized) | 3.0 | high |
| P4 (advanced) | 50 | highest |

Rules of thumb: each processing tier shrinks volume to ~25% of its inputs until P3→P4 (little reduction there); higher tiers = more ISK/m³, so processing up-tier is partly a *freight-cost* optimization. Verify per-type values from the SDE (`invTypes.volume`) rather than hardcoding the table.

### POCO export tax (the "first mile" cost — belongs in any PI cost model)
Exporting from planet to orbit is taxed on **fixed base values**, not market prices ([EVE Uni: Planetary Industry](https://wiki.eveuniversity.org/Planetary_Industry)):

| Tier | Base value/unit |
|---|---|
| P0 | 5 ISK |
| P1 | 400 ISK |
| P2 | 7,200 ISK |
| P3 | 60,000 ISK |
| P4 | 1,200,000 ISK |

`exportFee = baseValue × taxRate` (×1.5 if launched via command center); `importFee = baseValue × taxRate × 0.5`. In **highsec** there is a 10% NPC tax component on top of the player-POCO owner's rate, reduced 1 percentage point per level of **Customs Code Expertise** (min 5% at V): `tax = 10% + ownerRate − 1%×CCE level`. Outside highsec the rate is purely owner-set (nullsec/WH POCOs commonly 0–10% for friendlies). The planner needs POCO tax rate + CCE level as inputs; for typical highsec P2 production, POCO tax alone is often ~5–10% of gross revenue.

---

## 2. Hauling to Jita: courier-contract freight

The standard pattern: stage PI output at a station/structure, issue a **courier contract** (package volume + collateral + reward) to a freight corp, and let them move it. Two long-running highsec services are the community reference points:

### Red Frog Freight (highsec only)
- **Confirmed limits**: max **845,000 m³** per contract, max **1.5 B ISK collateral** ([their forum post](https://forums.eveonline.com/t/red-frog-freight-high-sec-freight-service/4316)); price computed per route by their [trip calculator](https://red-frog.org/red_calculator).
- **Not confirmed** (calculator is JS-only): the current per-jump rate. Community lore puts Red Frog around **~1–1.5 M ISK per jump** with a minimum of a few million per contract; verify against their calculator before hardcoding. *(Date checked: 2026-08-25.)*

### PushX / Push Industries ([pushx.net/rates.php](https://pushx.net/rates.php), checked 2026-08-25)
Charges **per warp** (≈ jumps + 1), not per m³:
- Highsec, ≤62,500 m³ (BR/DST): **1.5 M ISK/warp**
- Highsec, ≤950,000 m³ (freighter): **2.25 M ISK/warp** (2.5 M beyond 30 warps)
- Lowsec, ≤12,500 m³: **3.75 M ISK/warp**
- Jump freighter (low/null), ≤360,000 m³: **200 M ISK base + 100 M per low/null system** on route; collateral to 50 B (first 5 B free, surcharges above)
- Collateral (highsec): ≤1.5 B included; up to 5 B at 5× price; +20 M per extra 1 B up to 10 B
- Minimum contract **4.5 M ISK**; rush +50 M (subcap) / +200 M (JF)

### What that means in ISK/m³ (worked reference, hisec 10-jump route ≈ 11 warps)
- Freighter-class load, 500,000 m³: 11 × 2.25 M ≈ 24.75 M → **~50 ISK/m³**
- DST-class load, 50,000 m³: 11 × 1.5 M ≈ 16.5 M → **~330 ISK/m³**
- Small load hitting the 4.5 M minimum, 10,000 m³: **~450 ISK/m³**

So realistic hisec freight for PI sellers lands roughly in the **30–500 ISK/m³** band depending on batching; jump-freighter service from null/low is an order of magnitude more (e.g. 360,000 m³ for 200–600 M → **~550–1,700+ ISK/m³**). Against P2 at ~10–20k ISK/unit / 0.75 m³ (~13–27k ISK/m³), hisec freight is a low-single-digit % of revenue; for P1 it can be 5–15% and materially changes "which tier to export" decisions.

---

## 3. Cost-model parameterization for the tool

Model freight as a function, not a constant:

```
haulCostISK = f(route, service, volume_m3, collateral)
  route:      jumps (ESI GET /route/{origin}/{destination}/?flag=secure), sec-status class (hisec / lowsec / null)
  service:    contract courier (per-jump or per-warp rate table) | self-haul | JF service
  volume:     ceil-divide into contract-sized loads (845k m³ RF / 950k m³ PushX hisec; 360k m³ JF; 62.5k DST)
  collateral: cargo value (use planned sale value); drives surcharges above service thresholds
```

Sensible defaults to ship with the tool (all user-overridable, labeled "as of Aug 2026"):
- `hisecPerJumpFreighter ≈ 2.25 M ISK/jump`, `hisecPerJumpDST ≈ 1.5 M`, `minContract ≈ 5 M`
- `lowsecMultiplier ≈ 2.5×`, `jfBase ≈ 200 M + 100 M per low/null system`
- `collateralIncluded ≈ 1.5 B`, then step surcharges
- POCO tax rate default: highsec 10% NPC (5% with CCE V) + owner %, elsewhere owner % only
- Output metric: **ISK/m³ landed in Jita** and **freight as % of gross**, per commodity tier

Variance drivers worth surfacing in the UI: route length & choke points (Uedama/Niarja-era gank risk raises collateral pricing), load batching (weekly consolidated hauls beat daily dribbles because of per-contract minimums), and whether the user's production system is on a hub pipe.

---

## 4. Opportunity cost: self-haul vs contract

Self-hauling isn't free — it costs pilot time and risk:

- **Time**: a hisec freighter does very roughly 3–5 min/jump (align + warp + gate); a 10-jump Jita round trip ≈ 60–90+ min. At PushX rates the same one-way haul costs ~25 M ISK — so contracting is "worth it" whenever the player values their hour above ~20–30 M ISK (most income activities in 2026 EVE clear that; PI management itself yields far more per minute).
- **Risk**: self-haul in a freighter through gank chokepoints carries loss risk with no collateral backstop; courier contracts transfer that risk to the hauler for the collateral amount (set collateral = full Jita value or you're under-insured).
- **Capital/skills**: freighter hull + skills is a ~2 B+ commitment usable ~only for hauling; a DST/blockade runner (~150–300 M) covers small PI volumes and lowsec runs.
- Recommended framing in the tool: show `contractCost` vs `selfHaulTime × userISKperHourInput + expectedLossRate × cargoValue`, defaulting the ISK/hr slider to something like 50–100 M so contract hauling wins for freighter-scale loads — which matches actual player behavior (Red Frog/PushX have moved trillions in player goods for over a decade).

**Unconfirmed / volatile — re-check before release**: current Red Frog per-jump rate; PushX rates page numbers (player-set, change with meta); gank-risk hotspots; typical null alliance JF service rates (often subsidized ~independent of public services). All ISK figures dated 2026-08-25.

Sources: [PushX rates](https://pushx.net/rates.php) · [Red Frog forum thread](https://forums.eveonline.com/t/red-frog-freight-high-sec-freight-service/4316) · [Red Frog calculator](https://red-frog.org/red_calculator) · [EVE Uni: Planetary Commodities](https://wiki.eveuniversity.org/Planetary_Commodities) · [EVE Uni: Planetary Industry](https://wiki.eveuniversity.org/Planetary_Industry) · [EVE Uni: Tax (POCO section)](https://wiki.eveuniversity.org/Tax) · [Viridian patch notes coverage](https://nosygamer.blogspot.com/2023/06/eve-viridian-patch-notes-ecosystem-and.html)
