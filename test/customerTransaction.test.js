'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  createCustomerPaymentRepository
} = require('../src/customerPaymentRepository');

test('joins the latest payment row to its customer', async () => {
  const queries = [];
  const repository = createCustomerPaymentRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return {
        rowCount: 1,
        rows: [{
          customerId: '10099',
          customerName: 'Gobinda',
          data: { creditTotal: 500, transactions: [] }
        }]
      };
    }
  });

  const result = await repository.findCustomerTransaction(
    '767524024827354',
    '10099'
  );

  assert.deepEqual(result, {
    customerId: '10099',
    customerName: 'Gobinda',
    data: { creditTotal: 500, transactions: [] }
  });
  assert.match(queries[0].sql, /"767524024827354"\."payment"/);
  assert.match(queries[0].sql, /"767524024827354"\."customers"/);
  assert.match(queries[0].sql, /customers\."number" = payment\."customerid"/);
  assert.match(queries[0].sql, /ORDER BY payment\."id" DESC/);
  assert.deepEqual(queries[0].params, ['10099']);
});

test('reports when the customer transaction does not exist', async () => {
  const repository = createCustomerPaymentRepository({
    async query() {
      return { rowCount: 0, rows: [] };
    }
  });

  await assert.rejects(
    repository.findCustomerTransaction('767524024827354', '10099'),
    (error) => error.code === 'CUSTOMER_TRANSACTION_NOT_FOUND'
  );
});

test('customer transaction endpoint returns joined payment data', async (t) => {
  const service = {
    async findCustomerTransaction(orgid, customerid) {
      assert.equal(orgid, '767524024827354');
      assert.equal(customerid, '10099');
      return {
        customerId: customerid,
        customerName: 'Gobinda',
        data: { creditTotal: 500 }
      };
    }
  };
  const app = createApp(null, null, service);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/customertransaction`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: '767524024827354',
        customerid: '10099'
      })
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    customerId: '10099',
    customerName: 'Gobinda',
    data: { creditTotal: 500 }
  });
});

test('customer transaction endpoint validates both identifiers', async (t) => {
  const app = createApp(null, null, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/customertransaction`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 'invalid', customerid: 'customer' })
    }
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});
