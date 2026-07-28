'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSalesSummary, parseNumber } = require('../src/salesSummary');
const { parseSalesMessage } = require('../src/pubsub');

test('groups sales by supplier and product and applies per-kg discount', () => {
  const salesRows = [{
    id: '5',
    data: {
      rows: [
        { supplier: 'Skj', product: 'Rui', weight: '20.3', unitprice: '200' },
        { supplier: 'skj', product: 'rui', weight: '10.5', unitprice: '220' },
        { supplier: 'Other', product: 'Katla', weight: '2', unitprice: '100' }
      ]
    }
  }];

  const summary = buildSalesSummary(
    salesRows,
    0.05,
    '767524024827354',
    '2026-07-28'
  );

  assert.equal(summary.groupCount, 2);
  assert.equal(summary.invalidRecordCount, 0);
  assert.deepEqual(summary.groups[0], {
    supplier: 'Skj',
    product: 'Rui',
    totalSalesQuantity: 30.8,
    averageUnitPrice: 210,
    weightDiscount: 29.3,
    salesRecords: [
      {
        salesRowId: '5',
        supplier: 'Skj',
        product: 'Rui',
        weight: '20.3',
        unitprice: '200'
      },
      {
        salesRowId: '5',
        supplier: 'skj',
        product: 'rui',
        weight: '10.5',
        unitprice: '220'
      }
    ]
  });
});

test('keeps malformed sales records out of calculations and reports them', () => {
  const invalid = {
    supplier: 'Kulgechi',
    product: 'Rui lakhidi',
    weight: '9 4',
    unitprice: '56.89'
  };
  const summary = buildSalesSummary(
    [{ id: '5', data: { rows: [invalid] } }],
    0.05,
    '767524024827354',
    '2026-07-28'
  );

  assert.equal(summary.groupCount, 0);
  assert.equal(summary.invalidRecordCount, 1);
  assert.deepEqual(summary.invalidRecords[0].record, invalid);
  assert.equal(parseNumber('9 4'), null);
});

test('parses a Pub/Sub push envelope', () => {
  const payload = { orgid: 767524024827354, date: '2026-07-28' };
  const body = {
    message: {
      data: Buffer.from(JSON.stringify(payload)).toString('base64')
    },
    subscription: 'projects/maachwala/subscriptions/POST_SALES_DATA-sub'
  };

  assert.deepEqual(parseSalesMessage(body), {
    orgid: '767524024827354',
    date: '2026-07-28'
  });
});

test('rejects malformed Pub/Sub payloads and impossible dates', () => {
  assert.equal(parseSalesMessage({ message: { data: 'not-json' } }), null);
  assert.equal(parseSalesMessage({
    orgid: 'public',
    date: '2026-02-28'
  }), null);
  assert.equal(parseSalesMessage({
    orgid: '767524024827354',
    date: '2026-02-30'
  }), null);
});
