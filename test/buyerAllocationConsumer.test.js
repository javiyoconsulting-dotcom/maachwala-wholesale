'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  buildBuyerAllocationRows,
  createBuyerAllocationConsumerService,
  parseBuyerAllocationMessage
} = require('../src/buyerAllocationConsumer');
const {
  createBuyerAllocationDistributionPublisher
} = require('../src/buyerAllocationDistributionPublisher');
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
      sortingNumber: 583920174625,
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
  assert.equal(parsed.products[0].sizes[0].sortingNumber, 583920174625);
});

test('creates one buyerallocation row per buyer', () => {
  const message = parseBuyerAllocationMessage(payload);
  assert.deepEqual(buildBuyerAllocationRows(message), [
    {
      purchasedate: '2026-08-01', product: 10000,
      sortingnumber: 583920174625,
      productdesc: 'Pomfret', size: 1000, sizedesc: 'Small',
      buyerphone: '9876543210', buyername: 'Asha Das',
      allocatedweight: 40, maxprice: 220, minprice: 200
    },
    {
      purchasedate: '2026-08-01', product: 10000,
      sortingnumber: 583920174625,
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
      if (String(sql).includes('UPDATE') && String(sql).includes('"sorting"')) {
        return {
          rowCount: 1,
          rows: [{
            id: '10',
            number: '583920174625',
            allocatedquantity: 70,
            allocationcomplete: false
          }]
        };
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
  assert.equal(result.updatedSortingCount, 1);
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /pg_advisory_xact_lock/);
  assert.match(queries[2].sql, /ALTER TABLE/);
  assert.match(queries[2].sql, /"sortingnumber" numeric/);
  assert.match(queries[3].sql, /DELETE FROM "767524024827354"\."buyerallocation"/);
  assert.match(queries[3].sql, /existing\."sortingnumber"/);
  assert.match(queries[4].sql, /INSERT INTO "767524024827354"\."buyerallocation"/);
  assert.match(queries[4].sql, /"sortingnumber"/);
  assert.match(queries[4].sql, /"buyerprice"/);
  assert.match(queries[5].sql, /UPDATE "767524024827354"\."sorting"/);
  assert.match(queries[5].sql, /"allocatedquantity"/);
  assert.match(queries[5].sql, /"allocationcomplete"/);
  assert.match(queries[5].sql, />= sorting\."quantity"/);
  assert.equal(queries[6].sql, 'COMMIT');
});

test('publishes distribution data only after database success', async () => {
  const message = parseBuyerAllocationMessage(payload);
  const calls = [];
  const repository = {
    async replaceAllocations(orgid, input, buildRows) {
      calls.push('database');
      assert.equal(orgid, message.orgid);
      assert.deepEqual(input, message);
      assert.equal(buildRows, buildBuyerAllocationRows);
      return { insertedCount: 2, updatedSortingCount: 1 };
    }
  };
  const publisher = {
    async publish(input) {
      calls.push('publish');
      assert.deepEqual(input, message);
      return 'distribution-message-123';
    }
  };
  const service = createBuyerAllocationConsumerService(repository, publisher);

  const result = await service.process(message);

  assert.deepEqual(calls, ['database', 'publish']);
  assert.deepEqual(result, {
    insertedCount: 2,
    updatedSortingCount: 1,
    distributionMessageId: 'distribution-message-123'
  });
});

test('publishes allocation JSON to the distribution topic', async () => {
  const calls = [];
  const topic = {
    async publishMessage(input) {
      calls.push(input);
      return 'distribution-message-123';
    }
  };
  const pubsub = {
    topic(name) {
      assert.equal(
        name,
        'projects/maachwala/topics/BUYER_ALLOCATION_DISTRIBUTION'
      );
      return topic;
    }
  };
  const publisher = createBuyerAllocationDistributionPublisher(
    pubsub,
    'projects/maachwala/topics/BUYER_ALLOCATION_DISTRIBUTION'
  );
  const message = parseBuyerAllocationMessage(payload);

  const messageId = await publisher.publish(message);

  assert.equal(messageId, 'distribution-message-123');
  assert.deepEqual(JSON.parse(calls[0].data.toString('utf8')), message);
  assert.deepEqual(calls[0].attributes, {
    eventType: 'BUYER_ALLOCATION_DISTRIBUTION',
    orgid: '767524024827354',
    purchaseDate: '2026-08-01'
  });
});

test('buyer allocation push endpoint processes and acknowledges data', async (t) => {
  const parsed = parseBuyerAllocationMessage(payload);
  const consumer = {
    parseMessage: parseBuyerAllocationMessage,
    async process(message) {
      assert.deepEqual(message, parsed);
      return {
        insertedCount: 2,
        updatedSortingCount: 1,
        distributionMessageId: 'distribution-message-123'
      };
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
    status: 'processed',
    insertedCount: 2,
    updatedSortingCount: 1,
    distributionMessageId: 'distribution-message-123'
  });
});
