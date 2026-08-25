import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle } from '../src/engine/ledger.js';
import { iskPerM3, iskPerQty, m3, qty } from '../src/units.js';

const noFees = { salesTaxRate: 0, brokerRate: 0 };
const owner10 = { ownerRate: 0.10, hisecNpc: false, customsCodeLevel: 0 };

test('THE INVARIANT: with every cost zero, net === gross EXACTLY', () => {
  const r = settle({
    sales: [
      { commodity: 'Coolant', qty: qty(20160), unitPrice: iskPerQty(11731.5), basis: 'immediate' },
      { commodity: 'Water', qty: qty(1234), unitPrice: iskPerQty(777.77), basis: 'patient' },
    ],
    purchases: [],
    customs: [],
    freight: [],
    fees: noFees,
  });
  assert.equal(r.net, r.gross); // exact float equality, forever
  assert.equal(r.salesTax, 0);
  assert.equal(r.broker, 0);
});

test('hand-computed weekly settlement matches to the ISK', () => {
  // Sell 20,160 Coolant (patient @ 10,000); export them at 12% POCO;
  // buy 322,560 Water + 322,560 Electrolytes (immediate @ 50); import both at 12%;
  // freight out 20,160 × 0.75 m³ @ 400 ISK/m³. Accounting V, Broker Relations V.
  const fees = { salesTaxRate: 0.03375, brokerRate: 0.015 };
  const ctx = { ownerRate: 0.12, hisecNpc: false, customsCodeLevel: 0 };
  const r = settle({
    sales: [{ commodity: 'Coolant', qty: qty(20160), unitPrice: iskPerQty(10000), basis: 'patient' }],
    purchases: [
      { commodity: 'Water', qty: qty(322560), unitPrice: iskPerQty(50), basis: 'immediate' },
      { commodity: 'Electrolytes', qty: qty(322560), unitPrice: iskPerQty(50), basis: 'immediate' },
    ],
    customs: [
      { label: 'export Coolant', tier: 2, qty: qty(20160), direction: 'export', ctx },
      { label: 'import Water', tier: 1, qty: qty(322560), direction: 'import', ctx },
      { label: 'import Electrolytes', tier: 1, qty: qty(322560), direction: 'import', ctx },
    ],
    freight: [{ label: 'to Jita', volumeM3: m3(20160 * 0.75), ratePerM3: iskPerM3(400) }],
    fees,
  });
  const gross = 20160 * 10000;                     // 201,600,000
  const salesTax = gross * 0.03375;                //   6,804,000
  const broker = gross * 0.015;                    //   3,024,000 (patient sale only)
  const exportTax = 7200 * 0.12 * 20160;           //  17,418,240
  const importTax = 400 * 0.12 * 0.5 * 322560 * 2; //  15,482,880
  const freight = 20160 * 0.75 * 400;              //   6,048,000
  const buys = 322560 * 50 * 2;                    //  32,256,000
  assert.equal(r.gross, gross);
  assert.equal(r.salesTax, salesTax);
  assert.equal(r.broker, broker);
  assert.equal(r.customs, exportTax + importTax);
  assert.equal(r.freight, freight);
  assert.equal(r.purchases, buys);
  assert.equal(r.net, gross - salesTax - broker - exportTax - importTax - freight - buys);
  // The labeled lines reconcile exactly to net — one ledger, no side arithmetic
  const lineSum = r.lines.reduce((a, l) => a + l.isk, 0);
  assert.ok(Math.abs(lineSum - r.net) < 1e-6);
});

test('price basis drives broker fees: immediate pays none, patient pays on both sides', () => {
  const fees = { salesTaxRate: 0, brokerRate: 0.015 };
  const immediate = settle({
    sales: [{ commodity: 'Coolant', qty: qty(100), unitPrice: iskPerQty(1000), basis: 'immediate' }],
    purchases: [{ commodity: 'Water', qty: qty(100), unitPrice: iskPerQty(100), basis: 'immediate' }],
    customs: [], freight: [], fees,
  });
  assert.equal(immediate.broker, 0);
  const patient = settle({
    sales: [{ commodity: 'Coolant', qty: qty(100), unitPrice: iskPerQty(1000), basis: 'patient' }],
    purchases: [{ commodity: 'Water', qty: qty(100), unitPrice: iskPerQty(100), basis: 'patient' }],
    customs: [], freight: [], fees,
  });
  assert.equal(patient.broker, 100 * 1000 * 0.015 + 100 * 100 * 0.015);
  // Identical trades, different basis, different net — the spread question made explicit
  assert.ok(patient.net < immediate.net);
});

test('losses are negative, never floored: a plan that cannot pay for inputs says so', () => {
  const r = settle({
    sales: [{ commodity: 'Water', qty: qty(10), unitPrice: iskPerQty(100), basis: 'immediate' }],
    purchases: [{ commodity: 'Water', qty: qty(10), unitPrice: iskPerQty(500), basis: 'immediate' }],
    customs: [], freight: [], fees: noFees,
  });
  assert.equal(r.net, -4000);
});

test('customs events reuse the verified tax module (player-report fixture through the ledger)', () => {
  const r = settle({
    sales: [], purchases: [],
    customs: [{ label: '70 Coolant', tier: 2, qty: qty(70), direction: 'export', ctx: { ...owner10, ownerRate: 0.12 } }],
    freight: [], fees: noFees,
  });
  assert.equal(r.customs, 60480);
  assert.equal(r.net, -60480);
});

test('strict inputs: unknown keys and bad rates throw by name', () => {
  const base = { sales: [], purchases: [], customs: [], freight: [], fees: noFees };
  assert.throws(() => settle({ ...base, shipping: [] } as never), /unknown keys: shipping/);
  assert.throws(() => settle({ ...base, fees: { salesTaxRate: 0, brokerRate: 0, other: 1 } as never }), /unknown keys: other/);
  assert.throws(() => settle({ ...base, fees: { salesTaxRate: 1.5, brokerRate: 0 } }), /salesTaxRate/);
  assert.throws(
    () => settle({ ...base, sales: [{ commodity: 'X', qty: qty(1), unitPrice: iskPerQty(1), basis: 'jita' as never }] }),
    /Unknown price basis/,
  );
});
