/* ===================== NON-PI PRODUCTS BUILT FROM PI =====================
 *
 * Fuel Blocks and Nanite Repair Paste are not planetary commodities, but both
 * are built largely or entirely FROM them, so the allocator can plan for them
 * the same way it plans for a P4.
 *
 * RECIPES VERIFIED, not recalled.
 *
 * Fuel Blocks — three independent sources agree exactly (Skoli item 4314/4315,
 * Grokipedia's blueprint article, EVEInfo). One run yields 40 blocks from:
 *     1   Robotics              (P3)
 *     4   Enriched Uranium      (P2)
 *     4   Mechanical Parts      (P2)
 *     9   Coolant               (P2)
 *    20   Strontium Clathrates  (ice, not PI)
 *    22   Oxygen                (P1)
 *   170   Heavy Water           (ice, not PI)
 *   350   Liquid Ozone          (ice, not PI)
 *   450   Isotopes              (ice, not PI — type varies by block)
 * The four blocks differ ONLY in which isotope they use; every other input is
 * identical. EVEInfo lists 167/167/444 for the ice inputs, which are
 * material-efficiency-adjusted figures rather than base — the 170/350/450
 * above are the base values the other two sources agree on.
 *
 * Nanite Repair Paste — EVE Ref, which publishes CCP's own SDE. One run yields
 * 10 paste from:
 *     1   Gel-Matrix Biopaste   (P3)
 *     4   Nanites               (P2)
 *     1   Data Chips            (P3)
 * Every input is PI. Nothing has to be bought in.
 */

const COMPOSITE_RECIPES = {
  'Nitrogen Fuel Block': {
    kind: 'fuel', output: 40, typeId: 4051, volume: 5,
    isotope: 'Nitrogen Isotopes',
    pi:    { 'Robotics':1, 'Enriched Uranium':4, 'Mechanical Parts':4, 'Coolant':9, 'Oxygen':22 },
    nonPi: { 'Strontium Clathrates':20, 'Heavy Water':170, 'Liquid Ozone':350, 'Nitrogen Isotopes':450 },
  },
  'Hydrogen Fuel Block': {
    kind: 'fuel', output: 40, typeId: 4312, volume: 5,
    isotope: 'Hydrogen Isotopes',
    pi:    { 'Robotics':1, 'Enriched Uranium':4, 'Mechanical Parts':4, 'Coolant':9, 'Oxygen':22 },
    nonPi: { 'Strontium Clathrates':20, 'Heavy Water':170, 'Liquid Ozone':350, 'Hydrogen Isotopes':450 },
  },
  'Helium Fuel Block': {
    kind: 'fuel', output: 40, typeId: 4247, volume: 5,
    isotope: 'Helium Isotopes',
    pi:    { 'Robotics':1, 'Enriched Uranium':4, 'Mechanical Parts':4, 'Coolant':9, 'Oxygen':22 },
    nonPi: { 'Strontium Clathrates':20, 'Heavy Water':170, 'Liquid Ozone':350, 'Helium Isotopes':450 },
  },
  'Oxygen Fuel Block': {
    kind: 'fuel', output: 40, typeId: 4246, volume: 5,
    isotope: 'Oxygen Isotopes',
    pi:    { 'Robotics':1, 'Enriched Uranium':4, 'Mechanical Parts':4, 'Coolant':9, 'Oxygen':22 },
    nonPi: { 'Strontium Clathrates':20, 'Heavy Water':170, 'Liquid Ozone':350, 'Oxygen Isotopes':450 },
  },
  /* Mobile Depot — EVE Ref, from CCP's SDE (blueprint 33517).
   * One run yields 1 from 8 P3 units plus minerals:
   *     3 Smartfab Units, 1 Nuclear Reactors, 3 Guidance Systems,
   *     1 High-Tech Transmitters  (all P3)
   *     5,556 Tritanium, 222 Pyerite, 444 Zydrine  (minerals — bought)
   * Whether this clears the 51% PI bar depends on the Zydrine price, so the
   * tool measures it at runtime rather than asserting it here. */
  'Mobile Depot': {
    kind: 'deployable', output: 1, typeId: 33474, volume: 50,
    pi:    { 'Smartfab Units':3, 'Nuclear Reactors':1, 'Guidance Systems':3, 'High-Tech Transmitters':1 },
    nonPi: { 'Tritanium':5556, 'Pyerite':222, 'Zydrine':444 },
  },
  /* Mobile Tractor Unit — EVE Ref, from CCP's SDE (blueprint 33519).
   * The most PI-dense item here: it consumes finished P4 commodities directly.
   *     2 Organic Mortar Applicators (P4), 1 Wetware Mainframe (P4),
   *     2 Ukomi Superconductors (P3)
   *     948 Zydrine (mineral), 1 Small Tractor Beam I (T1 module)
   * The tractor beam is a manufactured module rather than a raw input; it is
   * priced as a bought item because building it is a separate industry job. */
  'Mobile Tractor Unit': {
    kind: 'deployable', output: 1, typeId: 33475, volume: 100,
    pi:    { 'Organic Mortar Applicators':2, 'Wetware Mainframe':1, 'Ukomi Superconductors':2 },
    nonPi: { 'Zydrine':948, 'Small Tractor Beam I':1 },
  },
  'Nanite Repair Paste': {
    kind: 'nanite', output: 10, typeId: 28668, volume: 0.01,
    pi:    { 'Gel-Matrix Biopaste':1, 'Nanites':4, 'Data Chips':1 },
    nonPi: {},
  },
};

/* Type ids for the ice products, so their Jita price can be fetched. */
const NON_PI_TYPE_IDS = {
  'Tritanium': 34, 'Pyerite': 35, 'Zydrine': 39,
  'Small Tractor Beam I': 24348,
  'Heavy Water': 16272, 'Liquid Ozone': 16273, 'Strontium Clathrates': 16275,
  'Nitrogen Isotopes': 17888, 'Hydrogen Isotopes': 17889,
  'Oxygen Isotopes': 17887, 'Helium Isotopes': 16274,
};

/* Volumes (m3 per unit) for the NON-PI inputs, so freight on bought ice is
 * honest rather than free.
 *
 * Verified against EVE Ref (current SDE) and cross-checked on Adam4EVE:
 *   Heavy Water 16272          0.4
 *   Liquid Ozone 16273         0.4
 *   Strontium Clathrates 16275 3
 *   Isotopes (all four)        0.03   — mechanically identical items
 *   Minerals                   0.01   — Tritanium/Pyerite/Zydrine
 *
 * WITHOUT THIS, bought inputs shipped for free and every composite looked
 * cheaper to make than it is. A fuel block run buys 990 units of ice per 40
 * blocks; pricing that at zero freight is not a rounding error.
 */
const NON_PI_VOLUMES = {
  'Heavy Water': 0.4, 'Liquid Ozone': 0.4, 'Strontium Clathrates': 3,
  'Nitrogen Isotopes': 0.03, 'Hydrogen Isotopes': 0.03,
  'Oxygen Isotopes': 0.03, 'Helium Isotopes': 0.03,
  'Tritanium': 0.01, 'Pyerite': 0.01, 'Zydrine': 0.01,
  'Small Tractor Beam I': 5,
};

/* traceComposite removed: the v8 allocator's chainDemand() walks composites
 * natively — PI inputs recursed like any recipe, non-PI inputs becoming
 * purchases. Two functions computing the same demand is how they drift, and
 * this one was only reachable from the deleted rankAlt path.


/* measurePiShare removed: dead. It computed what share of a composite's build
 * cost was PI, for the 51% rule that was dropped — the share is reported, not
 * enforced, and the reporting reads chainDemand directly. */
