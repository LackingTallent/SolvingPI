/**
 * Space-type presets — typical values, NOT the user's own. Two preset families:
 *
 *   SPACE_COST_PRESETS — fee/freight prefills for section 4. One source of
 *   truth, carried from v8's 06-economics table (v8 shipped a second,
 *   disagreeing table in 14-finance; that one is deliberately NOT carried).
 *   Anchors, per the v8 audit trail (checked 2026-08-22):
 *     - freight: Red Frog hauls up to 845,000 m³ per high-sec freighter trip
 *       for a reward in the single-digit millions of ISK → real high-sec
 *       courier freight is roughly 5–15 ISK/m³. Low/null/WH figures are
 *       jump-freighter-class ESTIMATES (risk-priced services vary widely).
 *     - customs: v9 models the high-sec NPC portion natively (hisecNpc flag +
 *       Customs Code Expertise), so the high-sec preset sets ONLY the typical
 *       player-POCO owner rate (5%) and turns the NPC flag on — more precise
 *       than v8's flattened "10% total". Low/null/WH have no NPC portion;
 *       only the owner's rate applies (typical rates shown).
 *     - sales tax 3.375% assumes Accounting V (7.5% base, −55%); broker 1.5%
 *       assumes Broker Relations V with decent standings.
 *   Presets are EDITABLE PREFILLS: applying one writes the fields, the user
 *   can then change any of them, and the UI must disclose that preset numbers
 *   are typical values, not theirs.
 *
 *   QUICK_DENSITY_PCT — per-security-band density assumptions for the Quick
 *   estimate detail level. CCP publishes no density table; these are typical-
 *   yield anchors expressed against this build's calibrated 100% reference
 *   (DENSITY_REFERENCE_W, the community "Miner - 00" 290,112-per-6h planet —
 *   a healthy null-class planet). Community-reported yields put null-sec and
 *   wormhole planets at roughly 2–5× high-sec; the ladder below (null ≈ 3×
 *   high) sits inside that consensus. They exist ONLY to stand in for scans
 *   the user has not entered yet, and every result built on them must be
 *   labeled an estimate.
 */

export type SpaceBand = 'highsec' | 'lowsec' | 'nullsec' | 'wormhole';

export const SPACE_BANDS: ReadonlyArray<SpaceBand> = ['highsec', 'lowsec', 'nullsec', 'wormhole'];

export interface SpaceCostPreset {
  readonly label: string;
  /** Player/owner customs rate, percent (the NPC portion is modeled separately). */
  readonly customsPct: number;
  readonly hisecNpc: boolean;
  readonly salesTaxPct: number;
  readonly brokerPct: number;
  /** Typical courier rate, ISK per m³ — applied to both directions. */
  readonly freightPerM3: number;
  /** One-line defense of the figures, shown in the UI. */
  readonly rationale: string;
}

export const SPACE_COST_PRESETS: Readonly<Record<SpaceBand, SpaceCostPreset>> = {
  highsec: {
    label: 'High sec (typical)',
    customsPct: 5, hisecNpc: true, salesTaxPct: 3.375, brokerPct: 1.5, freightPerM3: 10,
    rationale: '5% typical player POCO + the NPC portion (modeled from your Customs Code skill); freight anchored on Red Frog-class courier rates (~5–15 ISK/m³).',
  },
  lowsec: {
    label: 'Low sec (typical)',
    customsPct: 8, hisecNpc: false, salesTaxPct: 3.375, brokerPct: 1.5, freightPerM3: 400,
    rationale: 'No NPC customs outside high sec — only the POCO owner’s rate (8% typical). Freight is a jump-freighter-class estimate; replace with a real quote.',
  },
  nullsec: {
    label: 'Null sec (typical)',
    customsPct: 5, hisecNpc: false, salesTaxPct: 3.375, brokerPct: 1.5, freightPerM3: 600,
    rationale: 'Alliance POCOs commonly run ~5%; no NPC portion. Freight is a jump-freighter-class estimate; replace with a real quote.',
  },
  wormhole: {
    label: 'Wormhole (typical)',
    customsPct: 5, hisecNpc: false, salesTaxPct: 3.375, brokerPct: 1.5, freightPerM3: 900,
    rationale: 'Owner-set POCO rates (~5% typical); no NPC portion. Freight priced for wormhole logistics risk — an estimate; replace with a real quote.',
  },
};

export const PRESETS_ARE_APPROXIMATIONS =
  'Preset rates are typical values, not yours. Edit any field — or confirm them — to make them your real rates.';

/**
 * Quick-estimate density assumption per security band, in the UI's %
 * convention (100% = DENSITY_REFERENCE_W). Estimates by construction —
 * see the header comment for the anchoring argument.
 */
export const QUICK_DENSITY_PCT: Readonly<Record<SpaceBand, number>> = {
  highsec: 30,
  lowsec: 60,
  nullsec: 90,
  wormhole: 100,
};

export const BAND_LABELS: Readonly<Record<SpaceBand, string>> = {
  highsec: 'High sec', lowsec: 'Low sec', nullsec: 'Null sec', wormhole: 'Wormhole',
};

export const QUICK_DENSITY_DISCLOSURE =
  'Typical-yield assumptions, not scans. CCP publishes no density table; these anchor on community-reported yields (null-sec ≈ 3× high-sec) against this build’s calibrated 100% reference. Scan your planets for real numbers.';
