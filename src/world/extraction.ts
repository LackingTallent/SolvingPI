/**
 * CCP's published extraction yield formula, implemented verbatim from the
 * official developer docs (library 10). Input is the RAW per-cycle base value
 * w (qty_per_cycle — what the in-game survey and ESI report). The friendly
 * "density %" is a UI translation defined in density.ts, never used here.
 *
 * Verified: with w = 13277.2694 and forced 30-min cycles this reproduces the
 * v8.3 published table exactly (290,112 @ 6h; 81.5% / 34.0% / 21.9%).
 */
import {
  CYCLE_TIME_STEPS, DECAY_FACTOR, EXTRACTION_TIME_UNIT_S, NOISE_FACTOR,
  PROGRAM_MAX_HOURS, PROGRAM_MIN_HOURS,
} from '../spec/constants.js';

/** Game-correct cycle seconds for a program length (step function; see OPEN-QUESTIONS #1). */
export function cycleSecondsForProgram(programHours: number): number {
  if (!Number.isFinite(programHours) || programHours < PROGRAM_MIN_HOURS || programHours > PROGRAM_MAX_HOURS)
    throw new Error(`Program length must be ${PROGRAM_MIN_HOURS}..${PROGRAM_MAX_HOURS} hours, got ${programHours}`);
  for (const step of CYCLE_TIME_STEPS) {
    if (programHours <= step.maxProgramHours) return step.cycleSeconds;
  }
  /* unreachable: last step covers PROGRAM_MAX_HOURS */
  throw new Error(`No cycle step covers ${programHours}h`);
}

export interface ExtractionOptions {
  /**
   * Truncate each cycle's yield to an integer (community-observed in-game
   * behavior, not in CCP docs — OPEN-QUESTIONS #2). Default false (analytic).
   */
  readonly truncatePerCycle?: boolean;
  /** Override cycle seconds (testing / v8-compat oracle only). */
  readonly cycleSecondsOverride?: number;
}

const OPTION_KEYS = ['truncatePerCycle', 'cycleSecondsOverride'] as const;

function checkOptions(opts: ExtractionOptions): Required<ExtractionOptions> {
  const unknown = Object.keys(opts).filter((k) => !(OPTION_KEYS as ReadonlyArray<string>).includes(k));
  if (unknown.length > 0) throw new Error(`extraction options: unknown keys: ${unknown.join(', ')}`);
  const override = opts.cycleSecondsOverride ?? 0;
  if (override !== 0 && (!Number.isFinite(override) || override <= 0))
    throw new Error(`cycleSecondsOverride must be > 0, got ${override}`);
  return { truncatePerCycle: opts.truncatePerCycle ?? false, cycleSecondsOverride: override };
}

function checkW(w: number): number {
  if (!Number.isFinite(w) || w <= 0) throw new Error(`qty_per_cycle (w) must be > 0, got ${w}`);
  return w;
}

/**
 * Per-cycle yields for a program. CCP formula, verbatim:
 *   t = (cycle + 0.5) × barWidth          (barWidth = cycleSeconds / 900)
 *   decay = w / (1 + t × 0.012)
 *   noise = max(mean of 3 phase-shifted cosines, 0) × 0.8
 *   yield = barWidth × decay × (1 + noise)
 */
export function programCycles(w: number, programHours: number, opts: ExtractionOptions = {}): number[] {
  checkW(w);
  const o = checkOptions(opts);
  const cycleSeconds = o.cycleSecondsOverride !== 0 ? o.cycleSecondsOverride : cycleSecondsForProgram(programHours);
  const totalCycles = Math.floor((programHours * 3600) / cycleSeconds);
  const barWidth = cycleSeconds / EXTRACTION_TIME_UNIT_S;
  const phaseShift = Math.pow(w, 0.7);
  const out: number[] = [];
  for (let cycle = 0; cycle < totalCycles; cycle++) {
    const t = (cycle + 0.5) * barWidth;
    const decayValue = w / (1 + t * DECAY_FACTOR);
    const sinA = Math.cos(phaseShift + t * (1 / 12));
    const sinB = Math.cos(phaseShift / 2 + t * 0.2);
    const sinC = Math.cos(t * 0.5);
    const sinStuff = Math.max((sinA + sinB + sinC) / 3, 0);
    const y = barWidth * decayValue * (1 + NOISE_FACTOR * sinStuff);
    out.push(o.truncatePerCycle ? Math.floor(y) : y);
  }
  return out;
}

/** Total units over a whole program. */
export function programTotal(w: number, programHours: number, opts: ExtractionOptions = {}): number {
  return programCycles(w, programHours, opts).reduce((a, b) => a + b, 0);
}

/** Average units per hour for a program of this length, restarted back-to-back. */
export function perHourRate(w: number, programHours: number, opts: ExtractionOptions = {}): number {
  return programTotal(w, programHours, opts) / programHours;
}

/**
 * The decay-vs-cadence tradeoff curve: per-hour rate at each candidate program
 * length, normalized to the shortest. This is the QOL tradeoff made precise.
 */
export function cadenceCurve(
  w: number,
  programHoursList: ReadonlyArray<number>,
  opts: ExtractionOptions = {},
): Array<{ programHours: number; perHour: number; relativeToFirst: number }> {
  if (programHoursList.length === 0) throw new Error('cadenceCurve: empty program list');
  const rates = programHoursList.map((h) => ({ programHours: h, perHour: perHourRate(w, h, opts) }));
  const first = rates[0]!.perHour;
  return rates.map((r) => ({ ...r, relativeToFirst: r.perHour / first }));
}
