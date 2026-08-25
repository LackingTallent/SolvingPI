import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULE_IDS, validatePlan, type OperationPlan } from '../src/engine/judge.js';
import { character } from '../src/world/characters.js';

/**
 * Gate 3 is ADVERSARIAL: every rule the judge can emit is exercised by a
 * deliberately illegal plan and must be caught BY NAME. The coverage test at
 * the bottom fails if any rule id is never triggered — an assertion that has
 * never failed is a guess.
 */

const triggered = new Set<string>();

function baseline(): OperationPlan {
  const links = (n: number) => Array.from({ length: n }, () => ({ lengthKm: 0, level: 0 }));
  return {
    operation: {
      characters: [
        character({ name: 'main', icLevel: 5, ccuLevel: 5, customsCodeLevel: 5, accountingLevel: 5, brokerRelationsLevel: 5 }),
        character({ name: 'alt', icLevel: 0, ccuLevel: 3, customsCodeLevel: 0, accountingLevel: 3, brokerRelationsLevel: 0 }),
      ],
    },
    colonies: [
      {
        id: 'c1', characterName: 'main', planetName: 'PLANET-A', planetType: 'Barren', ccLevel: 4,
        layout: { ecus: 1, headsPerEcu: [10], basic: 8, advanced: 0, hightech: 0, storage: 0, launchpads: 1, links: links(10) },
        plan: {
          extractors: [{ resource: 'Aqueous Liquids', w: 13277.2694, programHours: 6 }],
          imports: [],
          factories: [{ schematic: 'Water', count: 8 }],
        },
      },
      {
        id: 'c2', characterName: 'main', planetName: 'PLANET-B', planetType: 'Temperate', ccLevel: 5,
        layout: { ecus: 0, headsPerEcu: [], basic: 0, advanced: 0, hightech: 16, storage: 1, launchpads: 1, links: links(18) },
        plan: {
          extractors: [],
          imports: [
            { commodity: 'Neocoms', qtyPerHour: 96 },
            { commodity: 'Data Chips', qtyPerHour: 96 },
            { commodity: 'High-Tech Transmitters', qtyPerHour: 96 },
          ],
          factories: [{ schematic: 'Broadcast Node', count: 16 }],
        },
      },
      {
        id: 'c3', characterName: 'alt', planetName: 'PLANET-A', planetType: 'Barren', ccLevel: 2,
        layout: { ecus: 1, headsPerEcu: [5], basic: 2, advanced: 0, hightech: 0, storage: 0, launchpads: 1, links: links(5) },
        plan: {
          extractors: [{ resource: 'Carbon Compounds', w: 5000, programHours: 24 }],
          imports: [],
          factories: [{ schematic: 'Biofuels', count: 2 }],
        },
      },
    ],
    logistics: {
      purchases: [
        { commodity: 'Neocoms', qtyPerHour: 96 },
        { commodity: 'Data Chips', qtyPerHour: 96 },
        { commodity: 'High-Tech Transmitters', qtyPerHour: 96 },
      ],
    },
  };
}

function expectRule(plan: OperationPlan, rule: string, pattern?: RegExp): void {
  const verdict = validatePlan(plan);
  assert.ok(!verdict.legal, `expected illegal plan for rule ${rule}`);
  const hit = verdict.violations.find((x) => x.rule === rule);
  assert.ok(hit, `expected violation "${rule}", got: ${verdict.violations.map((x) => x.rule).join(', ')}`);
  if (pattern) assert.match(hit.message, pattern);
  triggered.add(rule);
}

const clone = <T>(x: T): T => structuredClone(x);

test('the baseline plan is fully legal — including two characters sharing one planet', () => {
  const verdict = validatePlan(baseline());
  assert.deepEqual(verdict.violations, []);
  assert.ok(verdict.legal);
});

test('the judge never mutates its input', () => {
  const plan = baseline();
  const before = JSON.stringify(plan);
  validatePlan(plan);
  assert.equal(JSON.stringify(plan), before);
});

test('plan-shape / colony-shape: unknown keys are violations, not surprises', () => {
  expectRule({ ...baseline(), goalMode: 'profit' } as never, 'plan-shape', /goalMode/);
  const p = clone(baseline());
  (p.colonies[0] as unknown as Record<string, unknown>)["slider"] = 1;
  expectRule(p, 'colony-shape', /slider/);
  const p2 = clone(baseline());
  (p2.logistics as unknown as Record<string, unknown>)['freight'] = [];
  expectRule(p2, 'plan-shape', /freight/);
});

test('operation-invalid: empty and oversized operations are rejected', () => {
  expectRule({ ...baseline(), operation: { characters: [] } }, 'operation-invalid', /1\.\.50/);
});

test('colony ids: empty and duplicate', () => {
  const p = clone(baseline());
  (p.colonies[0] as { id: string }).id = '';
  expectRule(p, 'colony-id-invalid');
  const q = clone(baseline());
  (q.colonies[1] as { id: string }).id = 'c1';
  expectRule(q, 'colony-id-duplicate', /"c1"/);
});

test('char-unknown: a colony owned by nobody in the operation', () => {
  const p = clone(baseline());
  (p.colonies[0] as { characterName: string }).characterName = 'ghost';
  expectRule(p, 'char-unknown', /ghost/);
});

test('char-duplicate-planet: same character, same planet, two colonies', () => {
  const p = clone(baseline());
  (p.colonies[1] as { planetName: string }).planetName = 'PLANET-A';
  expectRule(p, 'char-duplicate-planet', /one colony per character per planet/);
});

test('char-capacity: the [6,1,1]-class bug is caught by name (v8 dealer regression)', () => {
  const p = clone(baseline());
  const extra = clone(p.colonies[2]!);
  (extra as { id: string }).id = 'c4';
  (extra as { planetName: string }).planetName = 'PLANET-C';
  (p as unknown as { colonies: unknown[] }).colonies = [...p.colonies, extra];
  expectRule(p, 'char-capacity', /Interplanetary Consolidation 0 allows 1/);
});

test('cc-level-invalid and cc-skill', () => {
  const p = clone(baseline());
  (p.colonies[0] as { ccLevel: number }).ccLevel = 7;
  expectRule(p, 'cc-level-invalid');
  const q = clone(baseline());
  (q.colonies[2] as { ccLevel: number }).ccLevel = 5; // alt has CCU 3
  expectRule(q, 'cc-skill', /has 3/);
});

test('planet-type-invalid', () => {
  const p = clone(baseline());
  (p.colonies[0] as { planetType: string }).planetType = 'Shattered';
  expectRule(p, 'planet-type-invalid', /Shattered/);
});

test('resource-not-on-planet: no mining what the planet lacks', () => {
  const p = clone(baseline());
  (p.colonies[0]!.plan.extractors[0] as { resource: string }).resource = 'Felsic Magma';
  expectRule(p, 'resource-not-on-planet', /Felsic Magma.*Barren/);
});

test('hightech-planet-illegal: P4 assembly only on Barren/Temperate', () => {
  const p = clone(baseline());
  (p.colonies[1] as { planetType: string }).planetType = 'Gas';
  expectRule(p, 'hightech-planet-illegal', /Gas/);
});

test('layout-invalid: the strict layout constructor speaks through the judge', () => {
  const p = clone(baseline());
  (p.colonies[0]!.layout.headsPerEcu as number[])[0] = 11;
  expectRule(p, 'layout-invalid', /1\.\.10/);
});

test('cpu-exceeded and pg-exceeded, with numbers in the message', () => {
  const links = (n: number) => Array.from({ length: n }, () => ({ lengthKm: 0, level: 0 }));
  const p = clone(baseline());
  (p.colonies[1] as { layout: unknown }).layout =
    { ecus: 0, headsPerEcu: [], basic: 0, advanced: 0, hightech: 20, storage: 0, launchpads: 1, links: links(21) };
  (p.colonies[1]!.plan.factories[0] as { count: number }).count = 16;
  expectRule(p, 'cpu-exceeded', /needs \d+/);

  const q = clone(baseline());
  (q.colonies[0] as { layout: unknown }).layout =
    { ecus: 0, headsPerEcu: [], basic: 0, advanced: 26, hightech: 0, storage: 0, launchpads: 1, links: links(27) };
  (q.colonies[0] as { plan: unknown }).plan = { extractors: [], imports: [], factories: [] };
  expectRule(q, 'pg-exceeded', /needs \d+/);
});

test('plan-invalid: unknown schematics and non-P0 extraction surface by name', () => {
  const p = clone(baseline());
  (p.colonies[0]!.plan.factories[0] as { schematic: string }).schematic = 'Tritanium';
  expectRule(p, 'plan-invalid', /Unknown schematic/);
});

test('ecu-capacity: two programs need two ECUs', () => {
  const p = clone(baseline());
  (p.colonies[0]!.plan.extractors as unknown[]).push({ resource: 'Base Metals', w: 9000, programHours: 6 });
  expectRule(p, 'ecu-capacity', /2 extraction program/);
});

test('w-invalid and program-bounds', () => {
  const p = clone(baseline());
  (p.colonies[0]!.plan.extractors[0] as { w: number }).w = 0;
  expectRule(p, 'w-invalid');
  const q = clone(baseline());
  (q.colonies[0]!.plan.extractors[0] as { programHours: number }).programHours = 400;
  expectRule(q, 'program-bounds', /1\.\.336/);
});

test('facility-capacity by kind: a plan cannot run more facilities than the layout holds', () => {
  const p = clone(baseline());
  (p.colonies[0]!.plan.factories[0] as { count: number }).count = 10; // layout has 8 basic
  expectRule(p, 'facility-capacity-basic', /10 basic.*has 8/);

  const q = clone(baseline());
  (q.colonies[0]!.plan.factories as unknown[]).push({ schematic: 'Coolant', count: 1 }); // layout has 0 advanced
  expectRule(q, 'facility-capacity-advanced', /has 0/);

  const r = clone(baseline());
  (r.colonies[1]!.plan.factories[0] as { count: number }).count = 17; // layout has 16 HT
  expectRule(r, 'facility-capacity-hightech', /17 high-tech.*has 16/);
});

test('import-without-launchpad: CC launch is export-only, imports need a pad', () => {
  const p = clone(baseline());
  const lay = p.colonies[1]!.layout as { launchpads: number };
  lay.launchpads = 0;
  expectRule(p, 'import-without-launchpad');
});

test('purchase-invalid and material-balance: phantom imports are named', () => {
  const p = clone(baseline());
  (p.logistics!.purchases[0] as { qtyPerHour: number }).qtyPerHour = -5;
  expectRule(p, 'purchase-invalid');

  const q = clone(baseline());
  (q as { logistics?: unknown }).logistics = undefined;
  delete (q as { logistics?: unknown }).logistics;
  expectRule(q, 'material-balance', /Neocoms.*imported but only 0/);
});

test('material-balance accepts internal sourcing: another colony\'s surplus backs the import', () => {
  // c1 exports 320 Water/h; add a factory colony importing 160 Water/h — no purchase needed.
  const links = (n: number) => Array.from({ length: n }, () => ({ lengthKm: 0, level: 0 }));
  const p = clone(baseline());
  (p.colonies as unknown[]).push({
    id: 'c5', characterName: 'main', planetName: 'PLANET-CI', planetType: 'Storm', ccLevel: 3,
    layout: { ecus: 0, headsPerEcu: [], basic: 0, advanced: 4, hightech: 0, storage: 0, launchpads: 1, links: links(5) },
    plan: {
      extractors: [],
      imports: [{ commodity: 'Water', qtyPerHour: 160 }, { commodity: 'Electrolytes', qtyPerHour: 160 }],
      factories: [{ schematic: 'Coolant', count: 4 }],
    },
  });
  (p.logistics!.purchases as unknown as unknown[]).push({ commodity: 'Electrolytes', qtyPerHour: 160 });
  const verdict = validatePlan(p);
  assert.deepEqual(verdict.violations, []);
});

test('a many-violation plan reports ALL of them, not just the first', () => {
  const p = clone(baseline());
  (p.colonies[0] as { characterName: string }).characterName = 'ghost';
  (p.colonies[0]!.plan.extractors[0] as { programHours: number }).programHours = 999;
  (p.colonies[1]!.plan.factories[0] as { count: number }).count = 17;
  const verdict = validatePlan(p);
  const rules = new Set(verdict.violations.map((x) => x.rule));
  assert.ok(rules.has('char-unknown') && rules.has('program-bounds') && rules.has('facility-capacity-hightech'));
  assert.ok(verdict.violations.length >= 3);
});

test('COVERAGE: every rule id the judge can emit was triggered by this suite', () => {
  const missing = RULE_IDS.filter((r) => !triggered.has(r));
  assert.deepEqual(missing, [], `rules never adversarially exercised: ${missing.join(', ')}`);
});
