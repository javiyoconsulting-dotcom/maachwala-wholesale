'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { buildNotDistributedPurchases } = require('../src/notDistributed');
const { createPurchaseRepository } = require('../src/purchaseRepository');

const databaseRows = [{
  id: '8',
  date: '2026-08-01',
  sortingdata: {
    purchaseDate: '2026-08-01',
    products: [{
      productId: 10000,
      name: 'Pomfret',
      sizes: [
        { size: 1000, sizedesc: 'Small', grossWeightKg: 75.5 },
        { size: 1001, sizedesc: 'Medium', grossWeightKg: 92.25 }
      ]
    }]
  }
}];

const expected = [{
  purchaseDate: '2026-08-01',
  products: [{
    productId: 10000,
    productName: 'Pomfret',
    sizes: [
      {
        sizeId: 1000,
        sizeDescription: 'Small',
        grossWeightKg: 75.5
      },
      {
        sizeId: 1001,
        sizeDescription: 'Medium',
        grossWeightKg: 92.25
      }
    ]
  }]
}];

test('formats not-distributed sorting data by product and size', () => {
  assert.deepEqual(buildNotDistributedPurchases(databaseRows), expected);
});

test('queries only status 1001 purchase rows', async () => {
  const queries = [];
  const repository = createPurchaseRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: databaseRows };
    }
  });

  const result = await repository.findNotDistributed(
    '767524024827354',
    buildNotDistributedPurchases
  );

  assert.deepEqual(result, expected);
  assert.match(queries[0].sql, /"767524024827354"\."purchase"/);
  assert.match(queries[0].sql, /WHERE "status" = 1001/);
  assert.match(queries[0].sql, /ORDER BY "id"/);
  assert.equal(queries[0].params, undefined);
});

test('not-distributed endpoint returns normalized purchase JSON', async (t) => {
  const purchaseService = {
    async findNotDistributed(orgid) {
      assert.equal(orgid, '767524024827354');
      return expected;
    }
  };
  const app = createApp(null, null, null, purchaseService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/notdistributed`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 767524024827354 })
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-result-count'), '1');
  assert.deepEqual(await response.json(), expected);
});
