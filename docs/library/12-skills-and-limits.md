# PI Skills, Character Limits, and Taxes (Ground Truth)

Researched August 2026. Primary sources: EVE University wiki
(https://wiki.eveuniversity.org/Skills:Planet_Management, https://wiki.eveuniversity.org/Tax,
https://wiki.eveuniversity.org/Clone_states, https://wiki.eveuniversity.org/Remote_Sensing,
https://wiki.eveuniversity.org/Interplanetary_Consolidation,
https://wiki.eveuniversity.org/Customs_Code_Expertise), CCP dev blog "EVE Rubicon: Player Owned
Customs Offices in Hi-Sec" (https://www.eveonline.com/news/view/player-owned-customs-offices-in-hi-sec),
CCP support article "Customs Offices" (https://support.eveonline.com/hc/en-us/articles/203269921-Customs-Offices).

## PI skills (exact effects)

| Skill | Rank (×) | Prereqs | Effect per level |
|---|---|---|---|
| Command Center Upgrades | 4× | none | "Each rank in this skill improves the quality of command facility available to you" — i.e. unlocks CC upgrade level = skill level (level N skill → CC level N, raising CPU/PG per the table in file 11). |
| Interplanetary Consolidation | 4× | none | "For each rank in this skill, you may install a command center on one additional planet, to a maximum of 6 planets." Base = 1 planet with the skill untrained. |
| Remote Sensing | 1× | Science III | Remote planet scanning. Scan range by level: **L1 = 1 ly, L2 = 3 ly, L3 = 5 ly, L4 = 7 ly, L5 = 9 ly** (UniWiki Remote_Sensing). |
| Planetology | 3× | Remote Sensing III, Science IV | "Increases the resolution of resource data when scanning a planet to allow for more accurate surveying" — more gradient bands on the resource heatmap. |
| Advanced Planetology | 5× | Planetology IV | "Further increases the resolution of resource data … for very precise surveying" — sharper/more accurate hotspot localization. |
| Customs Code Expertise | 2× | Trade IV | "Reduces Import and Export empire tax in Customs Offices by 10% per level" — relative reduction of the NPC (CONCORD) portion of high-sec customs tax only. |

**UNCERTAINTY:** Planetology/Advanced Planetology effects are qualitative in every source; CCP has
never published a numeric scan-accuracy formula. A planner cannot model scan accuracy — only note
that untrained scans blur hotspot position/intensity. Skill ISK prices per UniWiki: Remote Sensing
300k, CC Upgrades 500k, Interplanetary Consolidation 500k, Planetology 1M, Advanced Planetology
10M, Customs Code Expertise 3M.

## Character limits

- **Planets per character:** 1 base, +1 per level of Interplanetary Consolidation, **max 6**.
- **One command center per planet** per character (UniWiki Interplanetary_Consolidation: "You can
  only have one command center per planet"). Multiple different characters can colonize the same
  planet independently.
- **One extraction program per ECU**; up to 10 heads per ECU; buildable structures otherwise
  limited only by CC CPU/powergrid.
- **Alpha vs Omega:** PI is **Omega-only**. UniWiki Clone_states: Alphas "cannot, however, do
  Planetary Industry"; none of the six PI skills is on the Alpha skill list. (Colonies continue
  producing if an Omega lapses to Alpha, but cannot be managed — flag: the exact lapse behavior is
  commonly reported but was not re-verified this pass.)
- Colonies persist indefinitely; extraction programs run at most 14 days without interaction.

## Customs taxes

### Tier base values (the taxable "Base cost" per unit)

Per UniWiki Planetary Industry and Colony_management (identical in both):

| Tier | Base cost per unit |
|---|---|
| P0 (R0) | 5 ISK |
| P1 | 400 ISK |
| P2 | 7,200 ISK |
| P3 | 60,000 ISK |
| P4 | 1,200,000 ISK |

These are fixed accounting values used **only** for tax calculation (unrelated to market price).
Source URLs: https://wiki.eveuniversity.org/Planetary_Industry,
https://wiki.eveuniversity.org/Colony_management. (Not restated in CCP support docs; treat as
community-verified. They have been stable for years.)

### Fee formulas (UniWiki Colony_management, quoted)

- **Export fee = Base cost × tax rate (×1.5 if launched via Command Center)**
- **Import fee = Base cost × tax rate × 0.5**

i.e. importing through a customs office is taxed at half the export rate for the same goods.
(Consistent with CCP's Rubicon dev blog quoting NPC rates as "10% for export and 5% for import".)

### Tax rate composition

- **High-sec player-owned customs office (POCO):** total = owner-set tax + NPC (CONCORD) tax.
  NPC base = **10%** (export; import half). Customs Code Expertise reduces the NPC portion by 10%
  per level: CCP Rubicon dev blog — "This will reduce the NPC portion of the tax rate, but 10% per
  level (so at level 5 the NPC export tax rate will be 5% rather than 10%)." UniWiki Tax page
  agrees: "The base NPC rate in high security space is 10% … At level V this reduces the NPC tax
  down to 5%." The two taxes appear as separate wallet entries (CCP support article).
- **Interbus/NPC customs offices** (auto-placed where no POCO exists): per the Rubicon dev blog,
  "the tax rate stays the same, at 10% for export and 5% for import."
  **CONFLICT FLAG:** the UniWiki Planetary Industry page states a fixed, non-reducible **17%** for
  NPC customs offices in low/null — that 17% figure is the pre-Rubicon (2013) Interbus rate and
  its current applicability is unverified; in practice essentially all low/null customs offices
  are player-owned (Interbus offices are destructible). Do not hard-code 17% without in-game
  verification.
- **Low-sec / null-sec / wormhole POCOs:** owner-set tax only; **no NPC tax**, and Customs Code
  Expertise "does nothing" there (UniWiki Tax). Owner tax can be set per-standing, from 0% up to
  100% (UniWiki Tax: "At a maximum, the total tax rate could be 100%").
- **Null-sec sovereignty (post-Equinox, June 2024):** an Orbital Skyhook may replace the POCO and
  "retains the functionality of the Customs Office as a resource interface for planetary industry"
  (https://www.eveonline.com/news/view/equinox-expansion-notes); tax behaves like an owner-set
  POCO tax. Skyhook-specific tax details were not verified this pass.

### Worked example

Exporting 1,000 P2 units through a high-sec POCO with 5% owner tax, Customs Code Expertise V:
base = 1,000 × 7,200 = 7.2M ISK; rate = 5% (owner) + 5% (NPC at CCE V) = 10%; fee = 720,000 ISK.
Importing the same goods would cost half that at the same rates.
