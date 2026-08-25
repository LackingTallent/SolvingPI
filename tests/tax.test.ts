import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customsFee, effectiveCustomsRate, npcBrokerRate, npcHisecRate, salesTaxRate, structureBrokerRate } from '../src/world/tax.js';
import { qty } from '../src/units.js';

const owner10 = { ownerRate: 0.10, hisecNpc: false, customsCodeLevel: 0 };

test('player report 1: one Biomass (P1) exported at 10% costs 40 ISK', () => {
  assert.equal(customsFee(1, qty(1), 'export', owner10), 40);
});

test('player report 2: 70 Coolant (P2) exported at 12% cost 60,480 ISK', () => {
  assert.equal(customsFee(2, qty(70), 'export', { ...owner10, ownerRate: 0.12 }), 60480);
});

test('customs taxes BASE COST, never market value: P4 at 10% = 120,000', () => {
  assert.equal(customsFee(4, qty(1), 'export', owner10), 120000);
});

test('import is half: finished P1 20.00 vs 150 raw ore 37.50 (the refining premium)', () => {
  assert.equal(customsFee(1, qty(1), 'import', owner10), 20);
  assert.equal(customsFee(0, qty(150), 'import', owner10), 37.5);
});

test('command center launch is 1.5x and export-only', () => {
  assert.equal(customsFee(1, qty(1), 'export', owner10, 'commandCenterLaunch'), 60);
  assert.throws(() => customsFee(1, qty(1), 'import', owner10, 'commandCenterLaunch'), /export-only/);
});

test('NPC hisec component: 10% base, 5% at Customs Code Expertise V', () => {
  assert.equal(npcHisecRate(0), 0.10);
  assert.ok(Math.abs(npcHisecRate(5) - 0.05) < 1e-12);
  assert.ok(Math.abs(effectiveCustomsRate({ ownerRate: 0.02, hisecNpc: true, customsCodeLevel: 5 }) - 0.07) < 1e-12);
  // Nullsec skyhook: owner rate only, no NPC component (library 16)
  assert.equal(effectiveCustomsRate({ ownerRate: 0.10, hisecNpc: false, customsCodeLevel: 0 }), 0.10);
});

test('sales tax: 7.5% base (patch 22.02), 3.375% at Accounting V', () => {
  assert.equal(salesTaxRate(0), 0.075);
  assert.ok(Math.abs(salesTaxRate(5) - 0.03375) < 1e-12);
});

test('NPC broker fee: 1.5% at Broker Relations V, floored at 1%', () => {
  assert.ok(Math.abs(npcBrokerRate({ brokerRelationsLevel: 0, factionStanding: 0, corpStanding: 0 }) - 0.03) < 1e-12);
  assert.ok(Math.abs(npcBrokerRate({ brokerRelationsLevel: 5, factionStanding: 0, corpStanding: 0 }) - 0.015) < 1e-12);
  assert.equal(npcBrokerRate({ brokerRelationsLevel: 5, factionStanding: 10, corpStanding: 10 }), 0.01);
});

test('structure broker fee: SCC 0.5% + owner rate; skills do not apply', () => {
  assert.ok(Math.abs(structureBrokerRate(0.01) - 0.015) < 1e-12);
  assert.throws(() => structureBrokerRate(1.5), /fraction 0\.\.1/);
});

test('invalid inputs throw by name — no silent fallbacks', () => {
  assert.throws(() => customsFee(1, qty(1), 'export', { ...owner10, ownerRate: 5 }), /ownerRate/);
  assert.throws(() => npcHisecRate(7), /customsCodeLevel/);
  assert.throws(() => salesTaxRate(-1), /accountingLevel/);
});
