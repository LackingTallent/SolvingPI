# PI Facilities, Planets, and Production Chains (Ground Truth)

Researched August 2026. Primary sources: EVE University wiki
(https://wiki.eveuniversity.org/Planetary_Industry, https://wiki.eveuniversity.org/Planetary_Commodities,
https://wiki.eveuniversity.org/Planetary_Buildings, https://wiki.eveuniversity.org/Colony_management),
EVE Ref (SDE mirror, https://everef.net) for item volumes, CCP Equinox expansion notes
(https://www.eveonline.com/news/view/equinox-expansion-notes).

## Planet types and P0 resources

8 planet types; 15 P0 ("raw") resources. Matrix per UniWiki Planetary Commodities:

| P0 resource | Planet types |
|---|---|
| Aqueous Liquids | Barren, Gas, Ice, Oceanic, Storm, Temperate |
| Autotrophs | Temperate |
| Base Metals | Barren, Gas, Lava, Plasma, Storm |
| Carbon Compounds | Barren, Oceanic, Temperate |
| Complex Organisms | Oceanic, Temperate |
| Felsic Magma | Lava |
| Heavy Metals | Ice, Lava, Plasma |
| Ionic Solutions | Gas, Storm |
| Microorganisms | Barren, Ice, Oceanic, Temperate |
| Noble Gas | Gas, Ice, Storm |
| Noble Metals | Barren, Plasma |
| Non-CS Crystals | Lava, Plasma |
| Planktic Colonies | Ice, Oceanic |
| Reactive Gas | Gas |
| Suspended Plasma | Lava, Plasma, Storm |

Colonization exclusions (UniWiki Planetary Industry): shattered planets/systems cannot be
colonized, nor can planets in a short list of restricted systems (career-agent/trade hubs: Jita,
Amarr, Dodixie, Rens, Arnon, etc.).

**Equinox note (June 2024):** the Equinox expansion did **not** change classic PI mechanics. It
added separate nullsec-sovereignty "colony resources" (Power, Workforce, and the Reagents
Magmatic Gas from lava planets / Superionic Ice from ice planets) harvested via **Orbital
Skyhooks**, which in sov nullsec "replace but retain the functionality of the Customs Office as a
resource interface for planetary industry" (Equinox expansion notes). Reagents are not part of the
P0–P4 chain.

## Schematic tiers (input/output per cycle) — verified

| Step | Facility | Cycle time | Inputs per cycle | Output per cycle |
|---|---|---|---|---|
| P0→P1 | Basic Industry Facility | 30 min | 3000 × one P0 | 20 × P1 |
| P1→P2 | Advanced Industry Facility | 1 h | 40 × each of 2 P1s (80 total) | 5 × P2 |
| P2→P3 | Advanced Industry Facility | 1 h | 10 × each of 2 or 3 P2s (20/30 total) | 3 × P3 |
| P3→P4 | High-Tech Production Plant | 1 h | 6 × each of 3 P3s (18 total), OR 6 × each of 2 P3s + 40 × one P1 | 1 × P4 |

Source: UniWiki Planetary Industry ("takes 3000 units of Micro Organisms and turns them into 20
units of Bacteria" per 30-min cycle; "A 1-hour P1 to P2 cycle uses a total of (2*40=) 80 units of
P1 to make 5 units of P2"; "A 1-hour P2 to P3 cycle uses 20 or 30 units of P2 to make 3 units of
P3"; P4 = "a total of 18 units (3 different types) of P3" or "12 units (2 different types) of P3
and 40 units of P1"). Facilities only run when a schematic is installed and inputs are routed in;
partial inputs do not start a cycle. High-Tech Production Plants can only be built on **Barren and
Temperate** planets (UniWiki Planetary Buildings).

## Full production chains

### P0 → P1 (15 pairs, 1:1)
Aqueous Liquids→Water; Autotrophs→Industrial Fibers; Base Metals→Reactive Metals; Carbon
Compounds→Biofuels; Complex Organisms→Proteins; Felsic Magma→Silicon; Heavy Metals→Toxic Metals;
Ionic Solutions→Electrolytes; Microorganisms→Bacteria; Noble Gas→Oxygen; Noble Metals→Precious
Metals; Non-CS Crystals→Chiral Structures; Planktic Colonies→Biomass; Reactive Gas→Oxidizing
Compound; Suspended Plasma→Plasmoids.

### P1 → P2 (24 commodities, each 2 inputs @40 → 5 out)

| P2 | Inputs |
|---|---|
| Biocells | Precious Metals + Biofuels |
| Construction Blocks | Toxic Metals + Reactive Metals |
| Consumer Electronics | Chiral Structures + Toxic Metals |
| Coolant | Water + Electrolytes |
| Enriched Uranium | Toxic Metals + Precious Metals |
| Fertilizer | Proteins + Bacteria |
| Genetically Enhanced Livestock | Biomass + Proteins |
| Livestock | Biofuels + Proteins |
| Mechanical Parts | Precious Metals + Reactive Metals |
| Microfiber Shielding | Silicon + Industrial Fibers |
| Miniature Electronics | Silicon + Chiral Structures |
| Nanites | Reactive Metals + Bacteria |
| Oxides | Oxygen + Oxidizing Compound |
| Polyaramids | Industrial Fibers + Oxidizing Compound |
| Polytextiles | Industrial Fibers + Biofuels |
| Rocket Fuel | Electrolytes + Plasmoids |
| Silicate Glass | Silicon + Oxidizing Compound |
| Superconductors | Water + Plasmoids |
| Supertensile Plastics | Biomass + Oxygen |
| Synthetic Oil | Oxygen + Electrolytes |
| Test Cultures | Water + Bacteria |
| Transmitter | Chiral Structures + Plasmoids |
| Viral Agent | Biomass + Bacteria |
| Water-Cooled CPU | Water + Reactive Metals |

### P2 → P3 (21 commodities, each 2–3 inputs @10 → 3 out)

| P3 | Inputs |
|---|---|
| Biotech Research Reports | Nanites + Livestock + Construction Blocks |
| Camera Drones | Silicate Glass + Rocket Fuel |
| Condensates | Oxides + Coolant |
| Cryoprotectant Solution | Test Cultures + Synthetic Oil + Fertilizer |
| Data Chips | Supertensile Plastics + Microfiber Shielding |
| Gel-Matrix Biopaste | Oxides + Biocells + Superconductors |
| Guidance Systems | Water-Cooled CPU + Transmitter |
| Hazmat Detection Systems | Polytextiles + Viral Agent + Transmitter |
| Hermetic Membranes | Polyaramids + Genetically Enhanced Livestock |
| High-Tech Transmitters | Polyaramids + Transmitter |
| Industrial Explosives | Fertilizer + Polytextiles |
| Neocoms | Biocells + Silicate Glass |
| Nuclear Reactors | Microfiber Shielding + Enriched Uranium |
| Planetary Vehicles | Supertensile Plastics + Mechanical Parts + Miniature Electronics |
| Robotics | Mechanical Parts + Consumer Electronics |
| Smartfab Units | Construction Blocks + Miniature Electronics |
| Supercomputers | Water-Cooled CPU + Coolant + Consumer Electronics |
| Synthetic Synapses | Supertensile Plastics + Test Cultures |
| Transcranial Microcontrollers | Biocells + Nanites |
| Ukomi Superconductors | Synthetic Oil + Superconductors |
| Vaccines | Livestock + Viral Agent |

### P3 → P4 (8 commodities; Barren/Temperate high-tech plants only)

| P4 | Inputs per cycle |
|---|---|
| Broadcast Node | 6 Neocoms + 6 Data Chips + 6 High-Tech Transmitters |
| Integrity Response Drones | 6 Gel-Matrix Biopaste + 6 Hazmat Detection Systems + 6 Planetary Vehicles |
| Nano-Factory | 6 Industrial Explosives + 6 Ukomi Superconductors + 40 Reactive Metals (P1) |
| Organic Mortar Applicators | 6 Condensates + 6 Robotics + 40 Bacteria (P1) |
| Recursive Computing Module | 6 Synthetic Synapses + 6 Guidance Systems + 6 Transcranial Microcontrollers |
| Self-Harmonizing Power Core | 6 Camera Drones + 6 Nuclear Reactors + 6 Hermetic Membranes |
| Sterile Conduits | 6 Smartfab Units + 6 Vaccines + 40 Water (P1) |
| Wetware Mainframe | 6 Supercomputers + 6 Biotech Research Reports + 6 Cryoprotectant Solution |

(All chain tables per UniWiki Planetary Commodities.)

## Facility stats (CPU tf / Powergrid MW / ISK)

Per UniWiki Planetary Buildings:

**Command Centers** (one per planet; provides all CPU/PG; 500 m³ storage at all levels; purchase
price ~90,000 ISK — purchase price not confirmed on UniWiki this pass, flag as likely-but-unverified):

| CC upgrade level | CPU provided | PG provided | Upgrade cost (ISK) |
|---|---|---|---|
| 0 | 1,675 tf | 6,000 MW | — |
| 1 | 7,057 tf | 9,000 MW | 580,000 |
| 2 | 12,136 tf | 12,000 MW | 930,000 |
| 3 | 17,215 tf | 15,000 MW | 1,200,000 |
| 4 | 21,315 tf | 17,000 MW | 1,500,000 |
| 5 | 25,415 tf | 19,000 MW | 2,100,000 |

**Consumers:**

| Structure | CPU | PG | ISK | Notes |
|---|---|---|---|---|
| Extractor Control Unit | 400 tf | 2,600 MW | 45,000 | + heads below |
| Extractor Head | 110 tf | 550 MW | free | max 10 per ECU |
| Basic Industry Facility | 200 tf | 800 MW | 75,000 | P0→P1, 30-min cycle |
| Advanced Industry Facility | 500 tf | 700 MW | 250,000 | P1→P2 and P2→P3, 1-h cycle |
| High-Tech Production Plant | 1,100 tf | 400 MW | 525,000 | P3→P4; Barren/Temperate only |
| Storage Facility | 500 tf | 700 MW | 250,000 | 12,000 m³ |
| Launchpad | 3,600 tf | 700 MW | 900,000 | 10,000 m³ |
| Link (base) | 15 tf | 10 MW | free | + distance cost below |

**Links:** CPU cost c(l) = 15 + 0.2×l tf; PG cost p(l) = 10 + 0.15×l MW, where l = link length
in km (UniWiki Planetary Industry). Link capacity is upgradeable from level 0 (250 m³ throughput)
doubling per level to level 10 (256,000 m³) (UniWiki Planetary Buildings).
**UNVERIFIED:** the exact CPU/PG cost multiplier per link upgrade level was not confirmed this
pass — do not guess; measure in client or SDE before relying on it.

## Capacities and per-unit volumes

Storage: Command Center 500 m³; Launchpad 10,000 m³; Storage Facility 12,000 m³ (UniWiki).

Per-unit volumes, **verified against the current SDE via EVE Ref** (everef.net/types/2268 Aqueous
Liquids, /types/3645 Water, /types/9832 Coolant, /types/2867 Broadcast Node):

| Tier | Volume per unit |
|---|---|
| P0 | 0.005 m³ |
| P1 | 0.19 m³ |
| P2 | 0.75 m³ |
| P3 | 3.0 m³ (inferred from consistent halving + UniWiki table; not individually spot-checked on EVE Ref) |
| P4 | 50 m³ |

**WARNING for source reconciliation:** many older guides (and stale sentences on the UniWiki
itself, e.g. "combined 108 m³ of three P3 materials") use the pre-halving volumes 0.01 / 0.38 /
1.5 / 6 / 100 m³. The current SDE values are the halved set above; EVE Ref (which mirrors the
live SDE) is authoritative here.

## Export: customs office vs command center launch

- **Customs Office / Orbital Skyhook route (normal):** move goods to a Launchpad, then transfer
  launchpad↔customs office in either direction (import and export). Tax applies (see file 12).
  No per-transfer volume limit beyond launchpad capacity (10,000 m³ per launchpad inventory).
- **Command Center launch (emergency/no-POCO route):** the CC can launch a rocket with up to
  **500 m³** of goods ("volume limit of 500m3 (which is conveniently the same as the CC's maximum
  storage capacity)" — UniWiki Colony management). The package appears in space as a container
  reachable via Journal → Planetary Launches and persists for **5 days** ("launch a package into
  orbit for you to pickup within the next 5 days"). Export tax for CC launches is **1.5× the
  normal export tax** ("Export fee = Base cost × tax rate (×1.5 if launched via Command Center)").
  CC launch is export-only — imports require a customs office/skyhook.
