'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  createCustomerPaymentRepository
} = require('../src/customerPaymentRepository');

function paymentPool(creditTotal) {
  const queries = [];
  const client = {
    async query(sql, params) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (text.includes('SELECT "id"')) {
        return {
          rowCount: 1,
          rows: [{
            id: '9',
            customerid: '1001',
            credit: true,
            debit: false,
            data: { creditTotal, debitTotal: 0, payments: [] }
          }]
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  return { pool: { async connect() { return client; } }, queries };
}

test('reduces credit and appends payment details atomically', async () => {
  const { pool, queries } = paymentPool(500);
  const repository = createCustomerPaymentRepository(pool);
  const result = await repository.updateCustomerPayment(
    '767524024827354',
    '1001',
    125.5
  );

  assert.equal(result.previousCreditAmount, 500);
  assert.equal(result.totalCreditAmount, 374.5);
  assert.equal(result.totalDebitAmount, 0);
  assert.equal(result.credit, true);
  assert.equal(result.debit, false);
  const update = queries.find((query) => query.sql.trim().startsWith('UPDATE'));
  const data = JSON.parse(update.params[2]);
  assert.equal(data.creditTotal, 374.5);
  assert.equal(data.payments.length, 1);
  assert.equal(data.payments[0].amount, 125.5);
  assert.ok(queries.some((query) => query.sql === 'BEGIN'));
  assert.ok(queries.some((query) => query.sql === 'COMMIT'));
});

test('marks an overpayment as a debit balance', async () => {
  const { pool } = paymentPool(100);
  const repository = createCustomerPaymentRepository(pool);
  const result = await repository.updateCustomerPayment(
    '767524024827354',
    '1001',
    150
  );

  assert.equal(result.totalCreditAmount, 0);
  assert.equal(result.totalDebitAmount, 50);
  assert.equal(result.credit, false);
  assert.equal(result.debit, true);
});

test('update customer payment endpoint validates and updates payment', async (t) => {
  const paymentService = {
    async updateCustomerPayment(orgid, customerid, amount) {
      assert.equal(orgid, '767524024827354');
      assert.equal(customerid, '1001');
      assert.equal(amount, 125.5);
      return {
        customerid,
        paymentAmount: amount,
        previousCreditAmount: 500,
        totalCreditAmount: 374.5,
        totalDebitAmount: 0,
        credit: true,
        debit: false
      };
    }
  };
  const app = createApp(null, null, paymentService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/updatecustomerpayment`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: 767524024827354,
        customerid: 1001,
        paymentAmount: 125.5
      })
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'success');
  assert.equal(body.totalCreditAmount, 374.5);
});
