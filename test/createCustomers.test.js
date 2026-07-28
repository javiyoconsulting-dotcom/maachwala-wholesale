'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_BATCH_SIZE,
  validateCreateCustomersPayload
} = require('../src/createCustomers');
const { CustomerCache } = require('../src/cache');
const { createCustomerService } = require('../src/customerService');
const { createCustomerRepository } = require('../src/customerRepository');

test('validates and normalizes a create-customers batch', () => {
  const result = validateCreateCustomersPayload({
    orgid: 767524024827354,
    customers: [
      { name: '  Asha  ', phone: '9876543210' },
      { name: 'Bina', phone: 9876543211 }
    ]
  });

  assert.deepEqual(result, {
    errors: [],
    orgid: '767524024827354',
    customers: [
      { name: 'Asha', phone: '9876543210' },
      { name: 'Bina', phone: '9876543211' }
    ]
  });
});

test('reports item indexes for invalid customer data', () => {
  const result = validateCreateCustomersPayload({
    orgid: 'invalid',
    customers: [
      { name: '', phone: 'abc' },
      { name: 'Valid Name', phone: '123' }
    ]
  });

  assert.equal(result.errors.length, 4);
  assert.deepEqual(result.errors[1], {
    index: 0,
    field: 'name',
    message: 'name is required'
  });
  assert.deepEqual(result.errors[3], {
    index: 1,
    field: 'phone',
    message: 'phone must contain 6 to 15 digits'
  });
});

test('rejects empty and oversized batches', () => {
  assert.equal(
    validateCreateCustomersPayload({
      orgid: '767524024827354',
      customers: []
    }).errors[0].message,
    'customers must contain at least one item'
  );

  const oversized = Array.from(
    { length: MAX_BATCH_SIZE + 1 },
    () => ({ name: 'Customer', phone: '9876543210' })
  );
  assert.match(
    validateCreateCustomersPayload({
      orgid: '767524024827354',
      customers: oversized
    }).errors[0].message,
    /cannot contain more/
  );
});

test('successful inserts invalidate the organization customer cache', async () => {
  const cache = new CustomerCache(60_000);
  cache.set('767524024827354', [{ number: '1' }]);
  const repository = {
    async createMany(_orgid, customers) {
      return customers.map((customer, index) => ({
        id: String(index + 1),
        number: String(index + 1),
        ...customer
      }));
    }
  };
  const service = createCustomerService(repository, cache);

  await service.createCustomers('767524024827354', [{
    name: 'Asha',
    phone: '9876543210'
  }]);

  assert.equal(cache.get('767524024827354'), null);
});

test('allocates customer numbers from the current maximum under a lock', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (String(sql).includes('RETURNING')) {
        return {
          rows: [
            { id: '10278', number: '10278' },
            { id: '10277', number: '10277' }
          ]
        };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = createCustomerRepository({
    async connect() {
      return client;
    }
  });

  const created = await repository.createMany('767524024827354', [
    { name: 'Asha', phone: '9876543210' },
    { name: 'Bina', phone: '9876543211' }
  ]);

  assert.match(queries[1].sql, /pg_advisory_xact_lock/);
  assert.match(queries[2].sql, /MAX\("number"\)/);
  assert.match(queries[2].sql, /"last_number" \+ input\."position"/);
  assert.match(queries[3].sql, /setval/);
  assert.deepEqual(created.map((customer) => customer.number), [
    '10277',
    '10278'
  ]);
});
