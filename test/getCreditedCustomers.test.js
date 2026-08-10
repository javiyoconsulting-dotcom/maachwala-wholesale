'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  createCustomerPaymentRepository
} = require('../src/customerPaymentRepository');

const expected = [
  { id: '4', customerid: '1001', totalCreditAmount: 425.5 },
  { id: '7', customerid: '1002', totalCreditAmount: 100 }
];

test('fetches total credit amounts for credited customers', async () => {
  const queries = [];
  const repository = createCustomerPaymentRepository({
    async query(sql) {
      queries.push(String(sql));
      return {
        rows: [
          { id: '4', customerid: '1001', data: { creditTotal: '425.50' } },
          { id: '7', customerid: '1002', data: { creditTotal: 100 } }
        ]
      };
    }
  });

  assert.deepEqual(
    await repository.findCreditedCustomers('767524024827354'),
    expected
  );
  assert.match(queries[0], /"767524024827354"\."payment"/);
  assert.match(queries[0], /WHERE "credit" IS TRUE/);
});

test('credited customers endpoint returns payment credit totals', async (t) => {
  const paymentService = {
    async findCreditedCustomers(orgid) {
      assert.equal(orgid, '767524024827354');
      return expected;
    }
  };
  const app = createApp(null, null, paymentService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getcreditedcustomers`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 767524024827354 })
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-result-count'), '2');
  assert.deepEqual(await response.json(), expected);
});

test('credited customers endpoint validates orgid', async (t) => {
  const app = createApp(null, null, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getcreditedcustomers`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 'invalid' })
    }
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});
