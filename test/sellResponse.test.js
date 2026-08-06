'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  createBuyerAllocationRepository
} = require('../src/buyerAllocationRepository');

const databaseRows = [{
  id: '21',
  created_at: '2026-08-06T05:00:00.000Z',
  purchasedate: '2026-08-06',
  sortingnumber: '496173815415',
  product: '10000',
  productdesc: 'Pomfret',
  size: '1000',
  sizedesc: 'Small',
  buyerphone: '999999999',
  buyername: 'chotu',
  allocatedweight: 500,
  maxprice: 450,
  minprice: 400,
  buyerprice: null,
  buyerquantity: null,
  buyerweightdiscount: null
}];

const expected = [{
  id: 21,
  createdAt: '2026-08-06T05:00:00.000Z',
  purchaseDate: '2026-08-06',
  sortingNumber: 496173815415,
  productId: 10000,
  productName: 'Pomfret',
  sizeId: 1000,
  sizeDescription: 'Small',
  buyerPhone: '999999999',
  buyerName: 'chotu',
  allocatedWeightKg: 500,
  maximumPrice: 450,
  minimumPrice: 400,
  buyerPrice: null,
  buyerQuantity: null,
  buyerWeightDiscount: null
}];

test('fetches buyer allocations by purchase date', async () => {
  const queries = [];
  const repository = createBuyerAllocationRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: databaseRows };
    }
  });
  const result = await repository.findByPurchaseDate(
    '767524024827354', '2026-08-06'
  );
  assert.deepEqual(result, expected);
  assert.match(queries[0].sql, /"767524024827354"\."buyerallocation"/);
  assert.match(queries[0].sql, /WHERE "purchasedate" = \$1::date/);
  assert.deepEqual(queries[0].params, ['2026-08-06']);
});

test('sell response endpoint returns matching allocation rows', async (t) => {
  const sellResponseService = {
    async findByPurchaseDate(orgid, purchaseDate) {
      assert.equal(orgid, '767524024827354');
      assert.equal(purchaseDate, '2026-08-06');
      return expected;
    }
  };
  const app = createApp(
    null, null, null, null, null, null, null, sellResponseService
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/sellresponse`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: 767524024827354,
        purchasedate: '2026-08-06'
      })
    }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-result-count'), '1');
  assert.deepEqual(await response.json(), expected);
});

test('sell response endpoint rejects an invalid purchase date', async (t) => {
  const app = createApp(null, null, null, null, null, null, null, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/sellresponse`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: 767524024827354,
        purchaseDate: '2026-02-30'
      })
    }
  );
  assert.equal(response.status, 400);
});
