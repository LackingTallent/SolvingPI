# EVE Online Market Mechanics (for a PI Profit Planner)

*Researched 2026-08-25. Numbers verified against EVE University wiki, CCP support articles, and CCP dev/news posts current as of that date. EVE fee rates have changed several times (2020, 2022, March 2025) — treat every percentage here as a config value, not a constant.*

---

## 1. Order types: how the EVE market actually works

EVE's market is a per-station limit-order book, aggregated per region in the UI and API.

- **Sell orders (asks)**: an item sits in a station/structure hangar and is listed at a price. Buyers must be in range of (and dock at / access) that location to receive goods.
- **Buy orders (bids)**: escrowed ISK offering to buy at a price, with a **range** (station / solar system / N jumps / region). Range is set by the buy-order-range skill (station-only at level 0, up to entire region at V) — see [EVE Uni: Trading](https://wiki.eveuniversity.org/Trading).
- **Immediate orders**: choosing "immediate" duration fills against the best existing resting orders and **pays no broker fee** (sales tax still applies when selling). This is "selling to buy orders" / "buying from sell orders."
- **Resting (limit) orders**: any non-immediate duration is placed on the book and **pays the broker fee up front** (on top of sales tax when it eventually fills). Duration options run up to 90 days.
- **Partial fills** are normal; an order can fill across many counterparties over days.

### Price ticks
Since the 10 March 2020 "Broker Relations" update, **order prices are limited to 4 significant figures** ("Order prices can only be specified with a maximum precision of 4 significant figures" — [CCP news: Broker Relations](https://www.eveonline.com/news/view/broker-relations)). E.g. near 1,000,000 ISK, valid prices step in 1,000-ISK increments (1,000,000 → 1,001,000). This killed 0.01-ISK undercutting; undercuts now move the price by a whole tick.

---

## 2. Fees — exact current formulas

### 2.1 Broker fee (charged when *placing* a resting order, buy or sell)

**NPC stations** ([EVE Uni: Trading](https://wiki.eveuniversity.org/Trading), [CCP support: Broker Fee and Sales Tax](https://support.eveonline.com/hc/en-us/articles/203218962-Broker-Fee-and-Sales-Tax)):

```
brokerFee% = 3%
           − 0.3%  × BrokerRelations level        (max −1.5%)
           − 0.03% × factionStanding              (max −0.3% at 10.0)
           − 0.02% × corporationStanding          (max −0.2% at 10.0)
```

- Range: **3.0% base → 1.5% with Broker Relations V → 1.0% floor** with perfect unmodified standings toward the station owner's faction and corporation. CCP's support article states the minimum is 1%.
- Standings used are **unmodified** (Connections/Diplomacy do not count).
- Minimum fee per order: **100 ISK**.
- Broker fee is charged on order placement and is **not refunded** if the order expires or is cancelled.

**Player-owned (Upwell) structures**: Broker Relations and standings do **not** apply. Fee = **0.5% SCC surcharge (NPC ISK sink, fixed)** + whatever percentage the structure owner sets (owner portion can be 0%). Historically owner-set fees at trade structures like Tranquility Trading Tower hovered well below NPC rates, which is why structure trading exists. Source: [EVE Uni: Trading](https://wiki.eveuniversity.org/Trading).

### 2.2 Sales tax (charged when a *sale* transaction executes — including immediate sells to buy orders)

```
salesTax% = 7.5% × (1 − 0.11 × Accounting level)
```

- **Base 7.5%** (raised from 4% in patch 22.02, **2025-03-12** — [EVE Uni: Tax](https://wiki.eveuniversity.org/Tax)), reduced 11% per Accounting level → **≈ 3.37% at Accounting V** (CCP support article says "down to 3.37%").
- Applies to the seller only, in NPC stations *and* player structures, and is paid **in addition to** any broker fee.
- Sources: [EVE Uni: Tax](https://wiki.eveuniversity.org/Tax), [CCP support article](https://support.eveonline.com/hc/en-us/articles/203218962-Broker-Fee-and-Sales-Tax) (last updated March 2026 at time of checking).

### 2.3 Relist / modify fee (charged when changing the price of an existing order)

Introduced March 2020 ([CCP: Broker Relations](https://www.eveonline.com/news/view/broker-relations)); current formula per [EVE Uni: Trading](https://wiki.eveuniversity.org/Trading):

```
relistFee = (100% − (50% + 6% × AdvancedBrokerRelations level)) × brokerFee% × newOrderValue
          + brokerFee% × max(newOrderValue − oldOrderValue, 0)
```

- I.e. you pay a **partial broker fee on the whole new order value** (50% discount base, up to 80% discount with Advanced Broker Relations V), plus a **full broker fee on any value increase**. Minimum 100 ISK.
- Consequence for sellers: chasing the market downward with frequent 0.01-style updates is expensive; a PI tool should model at most occasional relists (or none) and treat relist cost as part of the sell-order fee burden.

### 2.4 Fee summary table (NPC station)

| Action | Broker fee | Sales tax |
|---|---|---|
| Sell immediately to buy orders | none | 7.5% → 3.37% |
| List sell order (fills later) | 3% → 1% (upfront) | 7.5% → 3.37% (on fill) |
| Place buy order | 3% → 1% (upfront) | none |
| Buy instantly from sell orders | none | none |

Worst case for an untrained alt listing a sell order: **10.5%** of gross. Best realistic trained case: **~4.4–4.9%** (1.0–1.5% broker + 3.37% tax). A PI planner should expose Accounting level, Broker Relations level, and standings (or a direct fee override) as user inputs.

---

## 3. Jita 4-4 and regional markets

- **Jita IV – Moon 4 – Caldari Navy Assembly Plant** (station ID **60003760**, system 30000142, region The Forge 10000002) is the de-facto reference market: deepest books, tightest spreads, most reliable price discovery. Community price APIs (Fuzzwork, EVE Tycoon, Adam4EVE) all treat Jita/The Forge as the default.
- Secondary hubs: **Amarr VIII (Oris)** (Domain), Rens (Heimatar), Dodixie (Sinq Laison), Hek; plus player structure hubs near Jita (Perimeter). Regional prices for PI goods can deviate from Jita by several percent in either direction, and thin regional books make "local sell" price estimates unreliable — a planner should default to Jita and treat other hubs as optional.
- Markets are **regional**: orders are visible per region; goods do not move. Any non-local sale implies hauling (see `15-logistics-costs.md`).

---

## 4. Realistic price discovery: bid vs ask, and why it matters

For every type there are two reference prices:

- **Best bid** (highest buy order) — what you get *right now*, minus sales tax, with zero time risk.
- **Best ask** (lowest sell order) — roughly what a resting sell order can hope to realize, minus broker fee + sales tax, with time risk and undercutting risk.

The **spread** between them on PI commodities is routinely 5–20%+ (varies by item and week). This means:

- "Sell to buy orders" nets: `bestBid × (1 − salesTax)` — instant, certain.
- "List at ask" nets *at best*: `bestAsk × (1 − salesTax − brokerFee)` — and in practice less, because you get undercut and either wait, relist (fee), or your fill price drifts down.
- A profit planner should compute **both** and show them side by side; the honest "conservative" number for PI planning is the buy-order net, and the "optimistic" number is the sell-order net. Many community PI tools use a **5% percentile price** (volume-weighted price of the best 5% of the book, as served by Fuzzwork/EVE Tycoon aggregates) instead of the raw top-of-book order, because top-of-book is frequently a tiny spoof/scam order.

**Do not use** ESI `/markets/prices/` `adjusted_price`/`average_price` as a sale price — those are CCP's smoothed universe-wide values used for industry cost indices, not achievable prices.

---

## 5. Market depth and slippage for bulk PI sellers

PI is a volume business (millions of ISK/day per character across a handful of commodity types), so top-of-book prices overstate realized revenue for large dumps:

- **Walking the book**: selling N units into buy orders fills the best bid first, then successively worse bids. Realized price = volume-weighted average over the depth consumed. For popular P2s (e.g. fuel-block inputs) Jita bid depth is usually deep enough that a single character's daily output moves the price little; for niche P3/P4s a few tens of thousands of units can eat several price levels.
- Practical modeling for a planner:
  1. Pull the full order book for the type (`GET /markets/{region_id}/orders/?type_id=`), filter to Jita 4-4 (`location_id == 60003760`) or use system-level aggregates.
  2. Simulate filling the user's planned sale quantity against the bid side → **volume-weighted realized price** and **slippage %** vs best bid.
  3. Sanity-check against **daily traded volume** from `/markets/{region_id}/history/`: if planned daily sales exceed ~2–5% of Jita daily volume for that type, flag that the user is a price-maker, not a price-taker, and both bid-dumping and ask-listing estimates degrade.
- Percentile prices (Fuzzwork/EVE Tycoon "5% percentile") are a cheap proxy for a depth simulation and are what most PI calculators use.

---

## 6. Change-log awareness (why the tool must not hardcode fees)

- 2020-03-10: 4-sig-fig ticks, relist fee, structure broker minimums ([Broker Relations](https://www.eveonline.com/news/view/broker-relations)).
- ~2022: 0.5% SCC surcharge on structure markets (reflected in current [EVE Uni Trading](https://wiki.eveuniversity.org/Trading) page).
- 2025-03-12 (v22.02): sales tax base raised 4% → **7.5%** ([EVE Uni: Tax](https://wiki.eveuniversity.org/Tax)).
- No further fee changes found as of 2026-08-25, but the pattern says: keep `baseSalesTax`, `baseBrokerFee`, skill coefficients, and SCC surcharge in a config file.

Sources: [EVE Uni Trading](https://wiki.eveuniversity.org/Trading) · [EVE Uni Tax](https://wiki.eveuniversity.org/Tax) · [CCP support: Broker Fee and Sales Tax](https://support.eveonline.com/hc/en-us/articles/203218962-Broker-Fee-and-Sales-Tax) · [CCP news: Broker Relations](https://www.eveonline.com/news/view/broker-relations) · [CCP news: Updates to Sales Taxes & Brokers Fees](https://www.eveonline.com/news/view/updates-to-sales-taxes-and-brokers-fees)
