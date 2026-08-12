'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  createBuyerAllocationRepository
} = require('../src/buyerAllocationRepository');

const expected = [{
  actualWeight: 50,
  maximumPrice: 250,
  minimumPrice: 200,
  buyerWeight: 48,
  buyerPrice: null,
  buyerWeightDiscount: 2,
  sortingNumber: 496173815415,
  productDescription: 'Pomfret',
  sizeDescription: 'Small',
  purchaseDate: '2026-08-10',
  purchaseNumber: 1786329604596
}];

test('fetches unsettled allocations joined with sorting details', async () => {
  const queries = [];
  const repository = createBuyerAllocationRepository({
    async query(sql) {
      queries.push(String(sql));
      return { rows: [{
        allocatedweight: 50, maxprice: 250, minprice: 200,
        buyerquantity: 48, buyerprice: null, buyerweightdiscount: 2,
        sortingnumber: '496173815415', productdesc: 'Pomfret',
        sizedesc: 'Small', purchasedate: '2026-08-10',
        purchasenumber: '1786329604596'
      }] };
    }
  });

  assert.deepEqual(
    await repository.findNotSettled('767524024827354'), expected
  );
  assert.match(queries[0], /"767524024827354"\."buyerallocation"/);
  assert.match(queries[0], /INNER JOIN "767524024827354"\."sorting"/);
  assert.match(queries[0], /sorting\."productid" = allocation\."product"/);
  assert.match(queries[0], /sorting\."sizeid" = allocation\."size"/);
  assert.match(queries[0], /"buyerprice" IS NULL/);
  assert.match(queries[0], /"buyerquantity"\s+IS DISTINCT FROM allocation\."allocatedweight"/);
});

test('not settled endpoint returns JSON array', async (t) => {
  const service = {
    async findNotSettled(orgid) {
      assert.equal(orgid, '767524024827354');
      return expected;
    }
  };
  const app = createApp(
    null, null, null, null, null, null, null, service
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/notsettledtransactions`,
    {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 767524024827354 })
    }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-result-count'), '1');
  assert.deepEqual(await response.json(), expected);
});

test('not settled endpoint validates orgid', async (t) => {
  const app = createApp(null, null, null, null, null, null, null, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/notsettledtransactions`,
    {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 'invalid' })
    }
  );
  assert.equal(response.status, 400);
});
