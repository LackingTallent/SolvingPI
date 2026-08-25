/**
 * Extraction-colony production with the physical cap the v8 model lacked.
 * The classic claim "53,760 P1/week × density" is the FACILITY-CAPPED branch
 * of the real function:
 *
 *   P1/week = min( basics × 20 × cycles/week,  extractor supply ÷ 150 )
 *
 * At the v8 reference density and 6h programs the two sides nearly meet
 * (48,352 vs 48,000 P0/h — 0.7% surplus), which is why the linear model
 * looked right. Above 100% density (or with fewer basics) they diverge, and
 * the honest answer names its bottleneck and its waste.
 */
import { P1_FROM_P0 } from '../spec/schematics.js';
import { steadyState, weeklyNet, HOURS_PER_WEEK, type FlowResult } from './flow.js';
import type { ExtractionOptions } from '../world/extraction.js';

export interface ExtractionColonySpec {
  readonly resource: string;       // P0 to extract
  readonly w: number;              // raw qty_per_cycle
  readonly programHours: number;
  readonly basics: number;         // basic industry facilities refining it
  readonly extraction?: ExtractionOptions;
}

export interface ExtractionColonyResult {
  readonly p1PerWeek: number;
  readonly p1Name: string;
  readonly bottleneck: 'facility' | 'extractor';
  /** Raw P0 per hour left unprocessed (0 when extractor-limited). */
  readonly surplusP0PerHour: number;
  /** Facility capacity headroom in P1/week (0 when facility-limited). */
  readonly capacityHeadroomPerWeek: number;
  readonly flow: FlowResult;
}

const KEYS = ['resource', 'w', 'programHours', 'basics', 'extraction'] as const;

export function extractionColony(spec: ExtractionColonySpec): ExtractionColonyResult {
  const unknown = Object.keys(spec).filter((k) => !(KEYS as ReadonlyArray<string>).includes(k));
  if (unknown.length > 0) throw new Error(`extractionColony(): unknown keys: ${unknown.join(', ')}`);
  if (!Number.isInteger(spec.basics) || spec.basics < 1)
    throw new Error(`basics must be a positive integer, got ${spec.basics}`);
  const p1Name = P1_FROM_P0[spec.resource];
  if (p1Name === undefined) throw new Error(`Not a P0 resource: "${spec.resource}"`);

  const extractorEntry: { resource: string; w: number; programHours: number; extraction?: ExtractionOptions } = {
    resource: spec.resource, w: spec.w, programHours: spec.programHours,
  };
  if (spec.extraction !== undefined) extractorEntry.extraction = spec.extraction;
  const flow = steadyState({
    extractors: [extractorEntry],
    imports: [],
    factories: [{ schematic: p1Name, count: spec.basics }],
  });

  const stage = flow.stages[0]!;
  const p1PerWeek = weeklyNet(flow, p1Name);
  const p0 = flow.perHour.get(spec.resource)!;
  const capacityPerWeek = spec.basics * 20 * (3600 / 1800) * HOURS_PER_WEEK;
  return {
    p1PerWeek,
    p1Name,
    bottleneck: stage.utilization >= 1 ? 'facility' : 'extractor',
    surplusP0PerHour: Math.max(0, p0.net),
    capacityHeadroomPerWeek: capacityPerWeek - p1PerWeek,
    flow,
  };
}
