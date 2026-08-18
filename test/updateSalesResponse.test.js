'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  validateUpdateSalesResponsePayload
} = require('../src/updateSalesResponse');
const {
  createBuyerAllocationRepository
} = require('../src/buyerAllocationRepository');

const payload = {
  orgid: '767524024827354',
  sortingnumber: '496173815415',
  buyerunitprice: 425.75,
  buyerquantity: 475.5,
  buyerweightdiscount: 24.5
};

test('validates and normalizes an update sales response payload', () => {
  assert.deepEqual(validateUpdateSalesResponsePayload(payload), {
    errors: [],
    payload
  });
});

test('rejects invalid update sales response values', () => {
  const result = validateUpdateSalesResponsePayload({
    orgid: 'invalid',
    sortingnumber: 'invalid',
    buyerunitprice: -1,
    buyerquantity: 'invalid',
    buyerweightdiscount: -2
  });
  assert.equal(result.errors.length, 5);
});

test('updates buyer allocations selected by sorting number', async () => {
  const queries = [];
  const rows = [{
    id: '1',
    sortingnumber: '496173815415',
    buyerunitprice: 425.75,
    buyerquantity: 475.5,
    buyerweightdiscount: 24.5
  }];
  const repository = createBuyerAllocationRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rowCount: 1, rows };
    }
  });

  assert.deepEqual(await repository.updateSalesResponse(payload), {
    updatedRows: 1,
    rows
  });
  assert.match(queries[0].sql, /UPDATE "767524024827354"\."buyerallocation"/);
  assert.match(queries[0].sql, /SET "buyerprice" = \$1/);
  assert.match(queries[0].sql, /WHERE "sortingnumber" = \$4::numeric/);
  assert.deepEqual(queries[0].params, [425.75, 475.5, 24.5, '496173815415']);
  assert.doesNotMatch(queries[0].sql, /UPDATE .*"sorting"/);
});

test('reports when no buyer allocation matches the sorting number', async () => {
  const repository = createBuyerAllocationRepository({
    async query() { return { rowCount: 0, rows: [] }; }
  });
  await assert.rejects(
    repository.updateSalesResponse(payload),
    (error) => error.code === 'BUYER_ALLOCATION_NOT_FOUND'
  );
});

test('update sales response endpoint returns updated allocation rows', async (t) => {
  const sellResponseService = {
    async updateSalesResponse(value) {
      assert.deepEqual(value, payload);
      return { updatedRows: 1, rows: [{ sortingnumber: value.sortingnumber }] };
    }
  };
  const app = createApp(
    null, null, null, null, null, null, null, sellResponseService
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/updatesalesresponse`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.updatedRows, 1);
  assert.equal(body.sortingnumber, '496173815415');
});
