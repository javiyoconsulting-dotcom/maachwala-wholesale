'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createPurchaseRepository } = require('../src/purchaseRepository');

const expected = [{
  id: '12',
  purchaseNumber: '1785542400001',
  date: '2026-08-10',
  statusCode: 1003,
  data: { currency: 'INR', products: [] },
  fromOrganisation: {
    number: '767524024827354',
    name: 'MacchWala',
    data: { owner: 'Sanatan' }
  }
}];

test('joins purchases by status with source organization details', async () => {
  const queries = [];
  const repository = createPurchaseRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [{
        id: '12', date: '2026-08-10', number: '1785542400001',
        status: '1003', data: { currency: 'INR', products: [] },
        fromorg: '767524024827354', organizationname: 'MacchWala',
        organizationdata: { owner: 'Sanatan' }
      }] };
    }
  });

  assert.deepEqual(
    await repository.findByStatus('767524024827355', 1003),
    expected
  );
  assert.match(queries[0].sql, /"767524024827355"\."purchase"/);
  assert.match(queries[0].sql, /LEFT JOIN "core"\."contractedorg"/);
  assert.match(queries[0].sql, /organization\."number" = purchase\."fromorg"/);
  assert.match(queries[0].sql, /purchase\."status" = \$1::bigint/);
  assert.deepEqual(queries[0].params, [1003]);
});

test('purchase list by status endpoint returns combined JSON', async (t) => {
  const purchaseService = {
    async findByStatus(orgid, statusCode) {
      assert.equal(orgid, '767524024827355');
      assert.equal(statusCode, 1003);
      return expected;
    }
  };
  const app = createApp(null, null, null, purchaseService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getpurchaselistbystatus`,
    {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 767524024827355, statuscode: 1003 })
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-result-count'), '1');
  assert.deepEqual(await response.json(), expected);
});

test('purchase list by status endpoint validates status code', async (t) => {
  const app = createApp(null, null, null, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getpurchaselistbystatus`,
    {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 767524024827355, statuscode: 'invalid' })
    }
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});
