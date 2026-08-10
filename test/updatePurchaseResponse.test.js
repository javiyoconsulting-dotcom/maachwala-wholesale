'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  createPurchaseResponsePublisher
} = require('../src/purchaseResponsePublisher');
const {
  validateUpdatePurchaseResponsePayload
} = require('../src/updatePurchaseResponse');

const payload = {
  purchaseNumber: 1785542400001,
  quantity: 475.5,
  weightDiscount: 24.5,
  unitPrice: 425.75
};

test('validates an update purchase response payload', () => {
  const result = validateUpdatePurchaseResponsePayload(payload);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.payload, payload);
});

test('rejects invalid purchase response values', () => {
  const result = validateUpdatePurchaseResponsePayload({
    purchaseNumber: 1.5,
    quantity: -1,
    weightDiscount: 'invalid',
    unitPrice: -5
  });
  assert.equal(result.errors.length, 4);
});

test('publishes purchase response JSON to the configured topic', async () => {
  const calls = [];
  const publisher = createPurchaseResponsePublisher({
    topic(name) {
      assert.equal(
        name,
        'projects/maachwala/topics/UPDATE_PURCHASE_SALES_RESPONSE'
      );
      return {
        async publishMessage(message) {
          calls.push(message);
          return 'message-456';
        }
      };
    }
  }, 'projects/maachwala/topics/UPDATE_PURCHASE_SALES_RESPONSE');

  assert.equal(await publisher.publish(payload), 'message-456');
  assert.deepEqual(JSON.parse(calls[0].data.toString('utf8')), payload);
  assert.deepEqual(calls[0].attributes, {
    eventType: 'UPDATE_PURCHASE_SALES_RESPONSE',
    purchaseNumber: '1785542400001'
  });
});

test('update purchase response endpoint publishes the message', async (t) => {
  const publisher = {
    async publish(value) {
      assert.deepEqual(value, payload);
      return 'message-456';
    }
  };
  const app = createApp(
    null, null, null, null, null, null, null, null, null, null, publisher
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/updatepurchaseresponse`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.status, 'published');
  assert.equal(body.messageId, 'message-456');
  assert.deepEqual(body.data, payload);
});
