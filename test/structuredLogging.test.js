'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

test('logs structured validation details without purchase payload content', async (t) => {
  const writes = [];
  const originalLog = console.log;
  console.log = (value) => writes.push(value);
  t.after(() => { console.log = originalLog; });

  const app = createApp(null, null, null, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/createpurchases`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'purchase-request-123'
      },
      body: JSON.stringify({
        orgid: 767524024827354,
        purchaseDate: '2026-08-13',
        totalCost: '10000',
        currency: 'INR',
        notes: 'private purchase note',
        products: [{
          productId: 10000,
          name: 'Private fish name',
          unitprice: '200',
          grossWeightKg: '50'
        }]
      })
    }
  );
  assert.equal(response.status, 400);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writes.length, 1);
  const log = JSON.parse(writes[0]);
  assert.equal(log.severity, 'WARNING');
  assert.equal(log.event, 'http_request_failed');
  assert.equal(log.requestId, 'purchase-request-123');
  assert.equal(log.path, '/wholesale/createpurchases');
  assert.equal(log.status, 400);
  assert.equal(log.orgid, '767524024827354');
  assert.equal(log.errorCode, 'VALIDATION_ERROR');
  assert.ok(log.validationDetails.some((detail) =>
    detail.field === 'totalCost'));
  assert.ok(log.validationDetails.some((detail) =>
    detail.field === 'unitprice'));
  assert.doesNotMatch(writes[0], /private purchase note/i);
  assert.doesNotMatch(writes[0], /Private fish name/);
});

test('logs structured internal error diagnostics', async (t) => {
  const writes = [];
  const originalLog = console.log;
  console.log = (value) => writes.push(value);
  t.after(() => { console.log = originalLog; });
  const purchaseService = {
    async findDataForSorting() {
      const error = new Error('connection refused by database');
      error.code = 'ECONNREFUSED';
      throw error;
    }
  };
  const app = createApp(null, null, null, purchaseService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getpurchases/sorting`,
    {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 767524024827354 })
    }
  );
  assert.equal(response.status, 503);
  await new Promise((resolve) => setImmediate(resolve));
  const log = JSON.parse(writes[0]);
  assert.equal(log.severity, 'ERROR');
  assert.equal(log.errorCode, 'DATABASE_UNAVAILABLE');
  assert.equal(log.internalErrorCode, 'ECONNREFUSED');
  assert.equal(log.internalErrorMessage, 'connection refused by database');
});
