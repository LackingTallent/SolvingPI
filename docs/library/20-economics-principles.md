# 20 — Economic Principles for the Rebuild

The analytics layer must be derived from these principles, not bolted on. Every insight the tool
surfaces should be traceable to one of them. These are stated in general form, then mapped to PI.

## 1. Opportunity cost is the only real cost
Every input the player already owns (a P1 they extracted, a planet slot, a login minute) has a
market value. Using it is spending it.
- PI application: self-produced inputs are NOT free. The cost of feeding your own P1 into a P2
  factory is the net price you could have realized selling that P1. A P2 chain is only better
  than selling P1 raw if value-added > (taxes + fees + logistics + time) of the extra step.
- Consequence for the engine: every plan must be comparable against the "sell everything at the
  lowest processed tier" baseline. "Profit" numbers that treat own inputs as free are wrong and
  were one of the old tool's failure modes.

## 2. Marginal analysis, not averages
Decisions happen at the margin: one more planet, one more head, one more login per day.
- The correct question is never "is this colony profitable?" but "what does the NEXT unit of
  effort/capital return, and where does it return most?"
- PI application: marginal ISK per additional login, marginal ISK of upgrading CC level,
  marginal yield of moving a head to a different hotspot, marginal value of a 6th planet on a
  character vs a planet on a fresh character.
- Consequence: the engine must be able to compute derivatives/deltas between adjacent plans, not
  just absolute totals.

## 3. Comparative advantage allocates planets and characters
With 6 planets/char and fixed planet types available, each planet should do what it is
RELATIVELY best at, given what the rest of the operation needs — not what it is absolutely best at.
- A Barren planet can do high-tech (P4) — that's scarce; even if its extraction is good, its
  comparative advantage may be factory work.
- Consequence: allocation is a joint optimization over the whole operation, never a per-planet
  greedy pick. Greedy-per-planet was iterative-design scar tissue in the old tool.

## 4. Prices are realized, not quoted
There is no single "the price." There is best bid (sell instantly), best ask (list and wait),
and depth behind each.
- Realized revenue = chosen side of book − sales tax − (broker fee if listing) − slippage on volume.
- Realized input cost = chosen side of book + broker fee if using resting buy orders.
- The old tool priced purchases off the wrong side of the book. The new engine must carry a
  price BASIS (immediate vs patient, side of book) on every ISK figure, end to end.

## 5. Transaction costs decide chain depth
Taxes and fees are per-transaction; each tier boundary crossed costs POCO export tax (+ import
tax on inputs), possibly broker/sales fees, and freight m³.
- Fixed base-value taxes (P1=400, P2=7,200, P3=60,000, P4=1,200,000 ISK) mean tax burden as a %
  of market price varies by tier and by market conditions — sometimes deep chains are tax-
  efficient, sometimes they are not. This must be computed, never assumed.
- Freight is priced per m³: the volume compression of going up a tier (e.g., 40 P1 @0.19 m³ →
  5 P2 @0.75 m³) is itself an economic product of the factory step.

## 6. Time is the binding constraint (and it's lumpy)
The player's scarce resource is attention: logins, clicks, hauling trips. ISK/hour of gameplay
attention is the true objective for most users, not ISK/day of wall-clock.
- Extraction economics: shorter programs yield more per hour of program but cost more logins.
  The decay formula makes this a precise, computable tradeoff curve (yield vs login cadence).
- Consequence: every plan carries at least two rates: ISK per day (wall clock) and ISK per
  login/interaction (attention), and the QOL mode optimizes the second.

## 7. Throughput systems are governed by their bottleneck
A PI colony is a flow network: extractor rate → storage buffers → factory consumption → export.
- Steady-state math: the chain runs at min(stage rates) after ratio conversion; everything above
  the bottleneck is waste (overflow or idle CPU/PG).
- Buffers (launchpad/storage) don't change steady-state throughput; they change how long the
  system runs unattended before a stage starves or overflows — that is a QOL metric, not a
  profit metric. Keep the two rigorously separate.

## 8. Make-or-buy is a price comparison, not an identity
Every factory input can be extracted locally, produced upstream, or bought and imported.
- The engine must evaluate buy-vs-make per input at realized prices (including import tax +
  freight in), and be allowed to conclude that a "factory planet fed by Jita" beats vertical
  integration — or vice versa — per commodity, per market snapshot.

## 9. Sunk costs are ignored; capital costs are not
- Already-placed buildings are sunk: replans should ignore what the current layout cost.
- But setup ISK (command centers, buildings, POCO standing games) and switching costs (teardown,
  lost cycles) are real when comparing "keep current plan" vs "switch plans." A switch is only
  advised when NPV of the delta clears the switching cost within the user's horizon.

## 10. Risk and variance are costs
- Freight collateral risk, gank risk on hauls, price volatility between plan time and sell time,
  hotspot depletion drift between reprogram visits.
- Minimum honest treatment: state staleness of the price snapshot, show spread (bid/ask gap) as
  a bound on price uncertainty, and let freight cost include a collateral/risk term. Do not
  fabricate volatility models beyond available data.

## 11. Markets clear: your own volume moves the price
A 28-character operation selling one P2 in one hub is a price influencer, not a pure price taker.
- Daily regional volume (ESI market history) vs the operation's output rate gives a saturation
  ratio; high ratios flag "your plan assumes you can sell more than the market absorbs."
- Diversification across products is the standard mitigation; the engine should surface it as
  such rather than silently optimizing into a wall.

## 12. Comparability requires one accounting identity
Every mode, path, and analytics view must reconcile to the same ledger:
  net = Σ realized revenue − Σ realized input cost − Σ POCO taxes − Σ market fees − Σ freight
with the zero-cost identity (all costs zero ⇒ net == gross) as a permanent invariant test.
Two numbers that claim to be "profit" in different tabs must come from this one function.

## Anti-principles (explicitly rejected)
- No "score" or weighted-blend objectives that mix ISK with vibes — every ranking is in ISK or
  ISK/time, with constraints handled as constraints.
- No averages where a distribution matters (bid vs ask, best-case yield vs decayed).
- No treating game-mechanical limits (CPU/PG, 6 planets, schematic ratios) as soft penalties —
  they are hard feasibility constraints checked by an independent judge.
