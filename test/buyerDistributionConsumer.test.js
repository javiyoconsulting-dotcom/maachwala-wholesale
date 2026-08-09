'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  buildBuyerPurchases,
  createBuyerDistributionConsumerService
} = require('../src/buyerDistributionConsumer');
const {
  parseBuyerAllocationMessage
} = require('../src/buyerAllocationConsumer');
const {
  createBuyerDistributionRepository
} = require('../src/buyerDistributionRepository');

const payload = {
  orgid: 767524024827354,
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
          name: 'chotu', phone: '999999999', weightKg: 500,
          minimumPrice: 400, maximumPrice: 450
        },
        {
          name: 'sanatan', phone: '999973648', weightKg: 500,
          minimumPrice: 450, maximumPrice: 480
        }
      ]
    }]
  }]
};

test('builds one purchase document per buyer', () => {
  const message = parseBuyerAllocationMessage(payload);
  const buyers = buildBuyerPurchases(message);

  assert.equal(buyers.length, 2);
  assert.deepEqual(buyers[0], {
    phone: '999999999',
    name: 'chotu',
    sortingNumbers: [496173815415],
    purchase: {
      notes: '',
      currency: 'INR',
      products: [{
        name: 'Pomfret',
        size: 1000,
        sizedesc: 'Small',
        productId: 10000,
        minPrice: 400,
        maxPrice: 450,
        grossWeightKg: 500
      }],
      totalCost: 200000,
      purchaseDate: '2026-08-06'
    }
  });
  assert.equal(buyers[1].purchase.totalCost, 225000);
});

test('creates purchases for onboarded buyers and marks source allocations', async () => {
  const message = parseBuyerAllocationMessage(payload);
  const queries = [];
  const client = {
    async query(sql, params) {
      const query = String(sql);
      queries.push({ sql: query, params });
      if (query.includes('FROM "core"."contractedorg"')) {
        return {
          rowCount: 1,
          rows: [{
            orgid: '1783152835192',
            name: 'demo trawler',
            phone: '999999999'
          }]
        };
      }
      if (query.includes('FROM "767524024827354"."buyerallocation"')) {
        return { rowCount: 1, rows: [{ id: '21' }] };
      }
      if (query.includes('INSERT INTO "1783152835192"."purchase"')) {
        return {
          rowCount: 1,
          rows: [{ id: '1', number: '1786012345678' }]
        };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  const repository = createBuyerDistributionRepository({
    async connect() { return client; }
  });

  const result = await repository.distribute(
    message.orgid,
    message,
    buildBuyerPurchases
  );

  assert.equal(result.createdCount, 1);
  assert.equal(result.skippedNotOnboarded, 1);
  assert.equal(result.skippedAlreadyProcessed, 0);
  assert.equal(result.purchases[0].organizationId, '1783152835192');
  assert.match(queries[2].sql, /"primaryphone"::text/);
  assert.match(queries[2].sql, /"data"->>'ownerphone'/);
  assert.match(queries[2].sql, /CROSS JOIN LATERAL/);
  assert.match(queries[3].sql, /COALESCE\("isbuyeronboarded", false\) = false/);
  assert.ok(queries.some(({ sql }) =>
    /INSERT INTO "1783152835192"\."purchase"/.test(sql)
  ));
  const insert = queries.find(({ sql }) =>
    /INSERT INTO "1783152835192"\."purchase"/.test(sql)
  );
  assert.match(insert.sql, /"fromorg"/);
  assert.match(insert.sql, /1003/);
  assert.equal(insert.params[2], '767524024827354');
  const stored = JSON.parse(insert.params[1]);
  assert.equal(stored.products[0].grossWeightKg, 500);
  assert.equal(stored.totalCost, 200000);
  const update = queries.find(({ sql }) =>
    /UPDATE "767524024827354"\."buyerallocation"/.test(sql)
  );
  assert.match(update.sql, /"isbuyeronboarded" = true/);
  assert.match(update.sql, /"buyerpurchase" = \$3::numeric/);
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('distribution endpoint processes a Pub/Sub message', async (t) => {
  const parsed = parseBuyerAllocationMessage(payload);
  const consumer = {
    parseMessage: parseBuyerAllocationMessage,
    async process(message) {
      assert.deepEqual(message, parsed);
      return {
        createdCount: 1,
        skippedNotOnboarded: 1,
        skippedAlreadyProcessed: 0,
        purchases: []
      };
    }
  };
  const app = createApp(
    null, null, null, null, null, null, null, null, consumer
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/pubsub/buyer-allocation-distribution`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: { data: Buffer.from(JSON.stringify(payload)).toString('base64') }
      })
    }
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).createdCount, 1);
});

test('consumer service delegates normalized messages to repository', async () => {
  const message = parseBuyerAllocationMessage(payload);
  const repository = {
    async distribute(orgid, input, builder) {
      assert.equal(orgid, '767524024827354');
      assert.deepEqual(input, message);
      assert.equal(builder, buildBuyerPurchases);
      return { createdCount: 2 };
    }
  };
  const service = createBuyerDistributionConsumerService(repository);
  assert.deepEqual(await service.process(message), { createdCount: 2 });
});
