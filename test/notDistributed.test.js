'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { buildNotDistributedPurchases } = require('../src/notDistributed');
const { createPurchaseRepository } = require('../src/purchaseRepository');

const common = {
  sortingid: '10',
  purchasedate: '2026-08-01',
  purchasenumber: '1785542400001',
  sortingnumber: '583920174625',
  productid: '10000',
  productdesc: 'Pomfret',
  sizeid: '1000',
  sizedesc: 'Small',
  quantity: 75.5,
  allocatedquantity: 70,
  allocationcomplete: false
};

const databaseRows = [
  {
    ...common,
    allocationid: '21',
    buyerphone: '9876543210',
    buyername: 'Asha Das',
    allocatedweight: 40,
    minprice: 200,
    maxprice: 220,
    buyerprice: null,
    buyerquantity: null,
    buyerweightdiscount: null
  },
  {
    ...common,
    allocationid: '22',
    buyerphone: '9876543211',
    buyername: 'Bina Roy',
    allocatedweight: 30,
    minprice: 205,
    maxprice: 225,
    buyerprice: null,
    buyerquantity: null,
    buyerweightdiscount: null
  },
  {
    ...common,
    sortingid: '11',
    sizeid: '1001',
    sizedesc: 'Medium',
    quantity: 92.25,
    allocatedquantity: null,
    allocationid: null,
    buyerphone: null,
    buyername: null,
    allocatedweight: null,
    minprice: null,
    maxprice: null,
    buyerprice: null,
    buyerquantity: null,
    buyerweightdiscount: null
  }
];

const expected = [{
  purchaseDate: '2026-08-01',
  purchaseNumber: 1785542400001,
  sortingNumber: 583920174625,
  products: [{
    productId: 10000,
    productName: 'Pomfret',
    sizes: [
      {
        sizeId: 1000,
        sizeDescription: 'Small',
        quantity: 75.5,
        allocatedQuantity: 70,
        remainingQuantity: 5.5,
        allocationComplete: false,
        allocations: [
          {
            allocationId: 21,
            buyerName: 'Asha Das',
            buyerPhone: '9876543210',
            allocatedWeightKg: 40,
            minimumPrice: 200,
            maximumPrice: 220,
            buyerPrice: null,
            buyerQuantity: null,
            buyerWeightDiscount: null
          },
          {
            allocationId: 22,
            buyerName: 'Bina Roy',
            buyerPhone: '9876543211',
            allocatedWeightKg: 30,
            minimumPrice: 205,
            maximumPrice: 225,
            buyerPrice: null,
            buyerQuantity: null,
            buyerWeightDiscount: null
          }
        ]
      },
      {
        sizeId: 1001,
        sizeDescription: 'Medium',
        quantity: 92.25,
        allocatedQuantity: 0,
        remainingQuantity: 92.25,
        allocationComplete: false,
        allocations: []
      }
    ]
  }]
}];

test('groups incomplete sorting rows with existing buyer allocations', () => {
  assert.deepEqual(buildNotDistributedPurchases(databaseRows), expected);
});

test('queries incomplete sorting rows and joins buyer allocations', async () => {
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
  assert.match(queries[0].sql, /"767524024827354"\."sorting"/);
  assert.match(queries[0].sql, /LEFT JOIN "767524024827354"\."buyerallocation"/);
  assert.match(queries[0].sql, /allocation\."sortingnumber" = sorting\."number"/);
  assert.match(queries[0].sql, /allocation\."product" = sorting\."productid"/);
  assert.match(queries[0].sql, /allocation\."size" = sorting\."sizeid"/);
  assert.match(queries[0].sql, /WHERE sorting\."allocationcomplete" = false/);
  assert.equal(queries[0].params, undefined);
});

test('not-distributed endpoint returns sorting and allocation JSON', async (t) => {
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
