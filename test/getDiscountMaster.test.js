'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createDiscountRepository } = require('../src/discountRepository');

const discounts = [
  { id: 1, weight: 0.05 },
  { id: 2, weight: 0.1 }
];

test('fetches all discount master rows for an organization', async () => {
  const queries = [];
  const repository = createDiscountRepository({
    async query(sql) {
      queries.push(String(sql));
      return { rows: discounts };
    }
  });

  assert.deepEqual(await repository.findAll('767524024827354'), discounts);
  assert.match(queries[0], /"767524024827354"\."discount"/);
  assert.match(queries[0], /ORDER BY "id"/);
});

test('get discount master endpoint returns discount rows', async (t) => {
  const discountService = {
    async findAll(orgid) {
      assert.equal(orgid, '767524024827354');
      return discounts;
    }
  };
  const app = createApp(null, null, null, null, null, null, null, null, null,
    discountService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getdiscountmaster`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 767524024827354 })
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-result-count'), '2');
  assert.deepEqual(await response.json(), discounts);
});

test('get discount master endpoint validates orgid', async (t) => {
  const app = createApp(null, null, null, null, null, null, null, null, null, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getdiscountmaster`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 'invalid' })
    }
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});
