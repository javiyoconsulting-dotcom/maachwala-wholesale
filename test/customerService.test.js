'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CustomerCache } = require('../src/cache');
const { createCustomerService } = require('../src/customerService');
const { schemaFromOrgid } = require('../src/customerRepository');

test('loads once and serves subsequent requests from cache', async () => {
  let calls = 0;
  const repository = {
    async findAll() {
      calls += 1;
      return [{ number: 1, name: 'Customer', phone: '9999999999' }];
    }
  };
  const service = createCustomerService(repository, new CustomerCache(60_000));

  const first = await service.getCustomers('767524024827354');
  const second = await service.getCustomers('767524024827354');

  assert.equal(first.cacheStatus, 'MISS');
  assert.equal(second.cacheStatus, 'HIT');
  assert.equal(calls, 1);
  assert.deepEqual(second.customers, first.customers);
});

test('refresh bypasses and replaces cached data', async () => {
  let value = 0;
  const repository = {
    async findAll() {
      value += 1;
      return [{ number: value, name: 'Customer', phone: '9999999999' }];
    }
  };
  const service = createCustomerService(repository, new CustomerCache(60_000));

  await service.getCustomers('767524024827354');
  const refreshed = await service.getCustomers('767524024827354', { refresh: true });
  const cached = await service.getCustomers('767524024827354');

  assert.equal(refreshed.cacheStatus, 'REFRESH');
  assert.equal(refreshed.customers[0].number, 2);
  assert.equal(cached.customers[0].number, 2);
});

test('schema identifier accepts digits only', () => {
  assert.equal(schemaFromOrgid('767524024827354'), '"767524024827354"');
  assert.throws(() => schemaFromOrgid('public; DROP TABLE collection'), TypeError);
});
