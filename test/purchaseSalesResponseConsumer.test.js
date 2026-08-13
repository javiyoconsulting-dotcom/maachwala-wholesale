'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  createPurchaseSalesResponseConsumerService,
  invalidPurchaseSalesResponseReason,
  parsePurchaseSalesResponseMessage
} = require('../src/purchaseSalesResponseConsumer');
const {
  createPurchaseSalesResponseRepository
} = require('../src/purchaseSalesResponseRepository');

const payload = {
  purchaseNumber: 1785542400001,
  quantity: 475.5,
  weightDiscount: 24.5,
  unitPrice: 425.75,
  orgid: '43423423408878724'
};

test('parses a Pub/Sub response without losing a large orgid', () => {
  const jsonWithNumericOrgid = JSON.stringify(payload).replace(
    '"43423423408878724"', '43423423408878724'
  );
  const message = parsePurchaseSalesResponseMessage({
    message: { data: Buffer.from(jsonWithNumericOrgid).toString('base64') }
  });
  assert.deepEqual(message, payload);
});

test('uses the Pub/Sub orgid attribute as a fallback', () => {
  const data = { ...payload };
  delete data.orgid;
  const message = parsePurchaseSalesResponseMessage({
    message: {
      data: Buffer.from(JSON.stringify(data)).toString('base64'),
      attributes: { orgid: payload.orgid }
    }
  });
  assert.deepEqual(message, payload);
});

test('identifies a legacy response with no orgid', () => {
  const data = { ...payload };
  delete data.orgid;
  const body = {
    message: { data: Buffer.from(JSON.stringify(data)).toString('base64') }
  };
  assert.equal(
    invalidPurchaseSalesResponseReason(body),
    'orgid is missing from message data and attributes'
  );
});

test('updates purchase status and source buyer allocations atomically', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (text.includes('SELECT "id", "fromorg"')) {
        return { rowCount: 1, rows: [{ id: '7', fromorg: '767524024827354' }] };
      }
      if (text.includes('UPDATE "767524024827354"."buyerallocation"')) {
        return { rowCount: 2, rows: [{ id: '1' }, { id: '2' }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const repository = createPurchaseSalesResponseRepository({
    async connect() { return client; }
  });

  const result = await repository.process(payload);
  assert.equal(result.sourceOrgid, '767524024827354');
  assert.equal(result.purchaseStatus, 1004);
  assert.equal(result.updatedAllocationCount, 2);
  const purchaseUpdate = queries.find((query) =>
    query.sql.includes('SET "status" = 1004'));
  assert.deepEqual(purchaseUpdate.params, ['7']);
  const allocationUpdate = queries.find((query) =>
    query.sql.includes('"buyerweightdiscount"'));
  assert.deepEqual(allocationUpdate.params, [
    425.75, 24.5, 475.5, 1785542400001
  ]);
  assert.ok(queries.some((query) => query.sql === 'COMMIT'));
});

test('consumer endpoint processes a Pub/Sub push message', async (t) => {
  const consumer = createPurchaseSalesResponseConsumerService({
    async process(message) {
      assert.deepEqual(message, payload);
      return {
        purchaseNumber: message.purchaseNumber,
        buyerOrgid: message.orgid,
        sourceOrgid: '767524024827354',
        purchaseStatus: 1004,
        updatedAllocationCount: 1
      };
    }
  });
  const app = createApp(
    null, null, null, null, null, null, null, null, null, null, null,
    consumer
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const envelope = {
    message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') }
  };
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/pubsub/update-purchase-sales-response`,
    {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope)
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'processed');
  assert.equal(body.purchaseStatus, 1004);
});

test('consumer endpoint acknowledges an invalid legacy message', async (t) => {
  const consumer = createPurchaseSalesResponseConsumerService({
    async process() { throw new Error('must not process invalid data'); }
  });
  const app = createApp(
    null, null, null, null, null, null, null, null, null, null, null,
    consumer
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const legacy = { ...payload };
  delete legacy.orgid;
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/pubsub/update-purchase-sales-response`,
    {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: { data: Buffer.from(JSON.stringify(legacy)).toString('base64') }
      })
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ignored');
  assert.match(body.reason, /orgid is missing/);
});
