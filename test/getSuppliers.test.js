'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createSupplierRepository } = require('../src/supplierRepository');

const suppliers = [
  { name: 'Asha Fish Supply', phone: '9876543210' },
  { name: 'Bina Traders', phone: '9876543211' }
];

test('fetches supplier names and phones from the organization schema', async () => {
  const queries = [];
  const repository = createSupplierRepository({
    async query(sql) {
      queries.push(String(sql));
      return { rows: suppliers };
    }
  });

  assert.deepEqual(await repository.findAll('767524024827354'), suppliers);
  assert.match(queries[0], /SELECT "name", "phone"::text AS "phone"/);
  assert.match(queries[0], /"767524024827354"\."supplier"/);
  assert.doesNotMatch(queries[0], /SELECT \*/);
});

test('maps a missing supplier table to a domain error', async () => {
  const repository = createSupplierRepository({
    async query() {
      const error = new Error('missing relation');
      error.code = '42P01';
      throw error;
    }
  });

  await assert.rejects(
    repository.findAll('767524024827354'),
    (error) => error.code === 'SUPPLIER_TABLE_NOT_FOUND'
  );
});

test('get suppliers endpoint returns a name and phone list', async (t) => {
  const supplierService = {
    async findAll(orgid) {
      assert.equal(orgid, '767524024827354');
      return suppliers;
    }
  };
  const app = createApp(
    null, null, null, null, null, null, null, null, null, null,
    null, null, null, supplierService
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getsuppliers`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 767524024827354 })
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-result-count'), '2');
  assert.deepEqual(await response.json(), suppliers);
});

test('get suppliers endpoint validates orgid', async (t) => {
  const app = createApp(
    null, null, null, null, null, null, null, null, null, null,
    null, null, null, {}
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getsuppliers`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 'invalid' })
    }
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});
