'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createBuyerPublisher } = require('../src/buyerPublisher');
const { validateSendToBuyerPayload } = require('../src/sendToBuyer');

const validPayload = {
  orgid: 767524024827354,
  purchaseDate: '2026-08-01',
  products: [{
    productId: 10000,
    productName: 'Pomfret',
    sizes: [{
      sortingNumber: 583920174625,
      sizeId: 1000,
      sizeDescription: 'Small',
      grossWeightKg: 75.5,
      allocatedWeightKg: 70,
      buyers: [
        {
          name: 'Asha Das',
          phone: '9876543210',
          weightKg: 40,
          minimumPrice: 200,
          maximumPrice: 220
        },
        {
          name: 'Bina Roy',
          phone: '9876543211',
          weightKg: 30,
          minimumPrice: 205,
          maximumPrice: 225
        }
      ]
    }]
  }]
};

test('validates and normalizes buyer allocation data', () => {
  const result = validateSendToBuyerPayload(validPayload);
  assert.equal(result.errors.length, 0);
  assert.equal(result.payload.purchaseDate, '2026-08-01');
  assert.equal(result.payload.products[0].sizes[0].buyers.length, 2);
  assert.equal(
    result.payload.products[0].sizes[0].sortingNumber,
    583920174625
  );
  assert.equal(
    result.payload.products[0].sizes[0].buyers[0].phone,
    '9876543210'
  );
});

test('accepts and groups buyer-centric allocation data', () => {
  const result = validateSendToBuyerPayload({
    orgid: 767524024827354,
    sortingnumber: 496173815415,
    purchaseDate: '2026-08-06',
    allocations: [
      {
        sortingnumber: 496173815415,
        buyer: { name: 'chotu', phone: '999999999' },
        products: [{
          sortingnumber: 496173815415,
          productId: 10000,
          productName: 'Pomfret',
          sizeId: 1000,
          sizeDescription: 'Small',
          weightKg: 500,
          minimumPrice: 400,
          maximumPrice: 450
        }]
      },
      {
        sortingnumber: 496173815415,
        buyer: { name: 'sanatan', phone: '999973648' },
        products: [{
          sortingnumber: 496173815415,
          productId: 10000,
          productName: 'Pomfret',
          sizeId: 1000,
          sizeDescription: 'Small',
          weightKg: 500,
          minimumPrice: 400,
          maximumPrice: 450
        }]
      }
    ]
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.payload, {
    purchaseDate: '2026-08-06',
    products: [{
      productId: 10000,
      productName: 'Pomfret',
      sizes: [{
        sortingNumber: 496173815415,
        sizeId: 1000,
        sizeDescription: 'Small',
        grossWeightKg: 1000,
        allocatedWeightKg: 1000,
        buyers: [
          {
            name: 'chotu',
            phone: '999999999',
            weightKg: 500,
            minimumPrice: 400,
            maximumPrice: 450
          },
          {
            name: 'sanatan',
            phone: '999973648',
            weightKg: 500,
            minimumPrice: 400,
            maximumPrice: 450
          }
        ]
      }]
    }]
  });
});

test('rejects inconsistent allocation weights and price ranges', () => {
  const result = validateSendToBuyerPayload({
    ...validPayload,
    products: [{
      ...validPayload.products[0],
      sizes: [{
        ...validPayload.products[0].sizes[0],
        allocatedWeightKg: 80,
        buyers: [{
          name: 'Asha',
          phone: '9876543210',
          weightKg: 40,
          minimumPrice: 220,
          maximumPrice: 200
        }]
      }]
    }]
  });
  assert.ok(result.errors.some((error) =>
    error.field === 'allocatedWeightKg'
  ));
  assert.ok(result.errors.some((error) => error.field === 'maximumPrice'));
});

test('requires a sorting number for every size', () => {
  const size = { ...validPayload.products[0].sizes[0] };
  delete size.sortingNumber;
  const result = validateSendToBuyerPayload({
    ...validPayload,
    products: [{ ...validPayload.products[0], sizes: [size] }]
  });
  assert.ok(result.errors.some((error) => error.field === 'sortingNumber'));
});

test('publishes UTF-8 JSON and attributes to the configured topic', async () => {
  const calls = [];
  const topic = {
    async publishMessage(message) {
      calls.push(message);
      return 'message-123';
    }
  };
  const pubsub = {
    topic(name) {
      assert.equal(
        name,
        'projects/maachwala/topics/WHOLESALE_CREATE_SALE_PURCHASE'
      );
      return topic;
    }
  };
  const publisher = createBuyerPublisher(
    pubsub,
    'projects/maachwala/topics/WHOLESALE_CREATE_SALE_PURCHASE'
  );
  const normalized = validateSendToBuyerPayload(validPayload).payload;
  const payload = { orgid: '767524024827354', ...normalized };

  const messageId = await publisher.publish(payload);

  assert.equal(messageId, 'message-123');
  assert.deepEqual(JSON.parse(calls[0].data.toString('utf8')), payload);
  assert.deepEqual(calls[0].attributes, {
    eventType: 'WHOLESALE_CREATE_SALE_PURCHASE',
    orgid: '767524024827354',
    purchaseDate: '2026-08-01'
  });
});

test('buyer allocation endpoint returns the Pub/Sub message ID', async (t) => {
  const normalized = validateSendToBuyerPayload(validPayload).payload;
  const buyerPublisher = {
    async publish(payload) {
      assert.deepEqual(payload, {
        orgid: '767524024827354',
        ...normalized
      });
      return 'message-123';
    }
  };
  const app = createApp(null, null, null, null, null, buyerPublisher);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/buyerallocation`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPayload)
    }
  );
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.status, 'published');
  assert.equal(body.messageId, 'message-123');
  assert.equal(
    body.topic,
    'projects/maachwala/topics/WHOLESALE_CREATE_SALE_PURCHASE'
  );
});
