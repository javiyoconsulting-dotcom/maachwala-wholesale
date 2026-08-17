'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  validateCreateSuppliersPayload
} = require('../src/createSuppliers');
const { createSupplierRepository } = require('../src/supplierRepository');

test('validates and normalizes a supplier batch', () => {
  assert.deepEqual(validateCreateSuppliersPayload({
    orgid: 767524024827354,
    suppliers: [
      { name: ' Asha Fish Supply ', phone: '9876543210' },
      { name: 'Bina Traders', phone: 9876543211 }
    ]
  }), {
    errors: [],
    orgid: '767524024827354',
    suppliers: [
      { name: 'Asha Fish Supply', phone: '9876543210' },
      { name: 'Bina Traders', phone: '9876543211' }
    ]
  });
});

test('rejects duplicate phones within a supplier batch', () => {
  const result = validateCreateSuppliersPayload({
    orgid: '767524024827354',
    suppliers: [
      { name: 'Asha', phone: '9876543210' },
      { name: 'Bina', phone: '9876543210' }
    ]
  });
  assert.deepEqual(result.errors[0], {
    index: 1,
    field: 'phone',
    message: 'phone must be unique within the request'
  });
});

test('inserts a supplier batch in one statement', async () => {
  const queries = [];
  const repository = createSupplierRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [{
        id: '1', name: 'Asha', phone: '9876543210', createdAt: new Date()
      }] };
    }
  });
  const result = await repository.createMany('767524024827354', [
    { name: 'Asha', phone: '9876543210' }
  ]);
  assert.equal(result.length, 1);
  assert.match(queries[0].sql, /INSERT INTO "767524024827354"\."supplier"/);
  assert.match(queries[0].sql, /unnest\(\$1::text\[\], \$2::numeric\[\]\)/);
  assert.deepEqual(queries[0].params, [['Asha'], ['9876543210']]);
});

test('maps a stored phone conflict to a domain error', async () => {
  const repository = createSupplierRepository({
    async query() {
      const error = new Error('duplicate');
      error.code = '23505';
      throw error;
    }
  });
  await assert.rejects(
    repository.createMany('767524024827354', [
      { name: 'Asha', phone: '9876543210' }
    ]),
    (error) => error.code === 'SUPPLIER_PHONE_CONFLICT'
  );
});

test('create suppliers endpoint returns inserted records', async (t) => {
  const supplierService = {
    async createMany(orgid, suppliers) {
      assert.equal(orgid, '767524024827354');
      return suppliers.map((supplier, index) => ({
        id: String(index + 1),
        ...supplier,
        createdAt: '2026-08-17T00:00:00.000Z'
      }));
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
    `http://127.0.0.1:${server.address().port}/wholesale/createsuppliers`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: '767524024827354',
        suppliers: [{ name: 'Asha', phone: '9876543210' }]
      })
    }
  );
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.insertedCount, 1);
  assert.equal(body.suppliers[0].phone, '9876543210');
});

test('create suppliers endpoint returns conflict for an existing phone', async (t) => {
  const supplierService = {
    async createMany() {
      const error = new Error('Supplier phone already exists');
      error.code = 'SUPPLIER_PHONE_CONFLICT';
      throw error;
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
    `http://127.0.0.1:${server.address().port}/wholesale/createsuppliers`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: '767524024827354',
        suppliers: [{ name: 'Asha', phone: '9876543210' }]
      })
    }
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'SUPPLIER_PHONE_CONFLICT');
});
