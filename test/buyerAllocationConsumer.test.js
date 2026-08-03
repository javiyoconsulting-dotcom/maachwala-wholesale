'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  buildBuyerAllocationRows,
  parseBuyerAllocationMessage
} = require('../src/buyerAllocationConsumer');
const {
  createBuyerAllocationRepository
} = require('../src/buyerAllocationRepository');

const payload = {
  orgid: 767524024827354,
  purchaseDate: '2026-08-01',
  products: [{
    productId: 10000,
    productName: 'Pomfret',
    sizes: [{
      sizeId: 1000,
      sizeDescription: 'Small',
      grossWeightKg: 75.5,
      allocatedWeightKg: 70,
      buyers: [
        {
          name: 'Asha Das', phone: '9876543210', weightKg: 40,
          minimumPrice: 200, maximumPrice: 220
        },
        {
          name: 'Bina Roy', phone: '9876543211', weightKg: 30,
          minimumPrice: 205, maximumPrice: 225
        }
      ]
    }]
  }]
};

test('parses a Pub/Sub buyer allocation envelope', () => {
  const parsed = parseBuyerAllocationMessage({
    message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') }
  });
  assert.equal(parsed.orgid, '767524024827354');
  assert.equal(parsed.purchaseDate, '2026-08-01');
  assert.equal(parsed.products[0].sizes[0].buyers.length, 2);
});

test('creates one buyerallocation row per buyer', () => {
  const message = parseBuyerAllocationMessage(payload);
  assert.deepEqual(buildBuyerAllocationRows(message), [
    {
      purchasedate: '2026-08-01', product: 10000,
      productdesc: 'Pomfret', size: 1000, sizedesc: 'Small',
      buyerphone: '9876543210', buyername: 'Asha Das',
      allocatedweight: 40, maxprice: 220, minprice: 200
    },
    {
      purchasedate: '2026-08-01', product: 10000,
      productdesc: 'Pomfret', size: 1000, sizedesc: 'Small',
      buyerphone: '9876543211', buyername: 'Bina Roy',
      allocatedweight: 30, maxprice: 225, minprice: 205
    }
  ]);
});

test('replaces matching allocations and inserts rows atomically', async () => {
  const message = parseBuyerAllocationMessage(payload);
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('RETURNING "id"')) {
        return { rowCount: 2, rows: [{ id: '1' }, { id: '2' }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  const repository = createBuyerAllocationRepository({
    async connect() { return client; }
  });

  const result = await repository.replaceAllocations(
    message.orgid, message, buildBuyerAllocationRows
  );

  assert.equal(result.insertedCount, 2);
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /pg_advisory_xact_lock/);
  assert.match(queries[2].sql, /DELETE FROM "767524024827354"\."buyerallocation"/);
  assert.match(queries[3].sql, /INSERT INTO "767524024827354"\."buyerallocation"/);
  assert.match(queries[3].sql, /"buyerprice"/);
  assert.equal(queries[4].sql, 'COMMIT');
});

test('buyer allocation push endpoint processes and acknowledges data', async (t) => {
  const parsed = parseBuyerAllocationMessage(payload);
  const consumer = {
    parseMessage: parseBuyerAllocationMessage,
    async process(message) {
      assert.deepEqual(message, parsed);
      return { insertedCount: 2 };
    }
  };
  const app = createApp(null, null, null, null, null, null, consumer);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/pubsub/wholesale-create-sale-purchase`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          data: Buffer.from(JSON.stringify(payload)).toString('base64')
        }
      })
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'processed', insertedCount: 2
  });
});
