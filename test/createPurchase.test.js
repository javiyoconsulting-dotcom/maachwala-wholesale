'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCreatePurchasePayload } = require('../src/createPurchase');
const { createPurchaseRepository } = require('../src/purchaseRepository');
const { createApp } = require('../src/app');

const validPayload = {
  orgid: 9375837583,
  purchaseDate: '2026-07-29',
  totalCost: 74980.00,
  currency: 'INR',
  products: [
    {
      productId: 10000,
      name: 'rui',
      size: 1000,
      sizedesc: 'small',
      unitprice: 210.90,
      grossWeightKg: 186.50
    },
    {
      productId: 100001,
      name: 'katla',
      size: 1001,
      sizedesc: 'large',
      unitprice: 210.90,
      grossWeightKg: 200.00
    }
  ],
  notes: 'Morning market purchase'
};

test('validates and normalizes a purchase payload', () => {
  const result = validateCreatePurchasePayload(validPayload);

  assert.deepEqual(result, {
    errors: [],
    purchase: {
      purchaseDate: '2026-07-29',
      totalCost: 74980,
      currency: 'INR',
      products: [
        {
          productId: 10000,
          name: 'rui',
          size: 1000,
          sizedesc: 'small',
          unitprice: 210.9,
          grossWeightKg: 186.5
        },
        {
          productId: 100001,
          name: 'katla',
          size: 1001,
          sizedesc: 'large',
          unitprice: 210.9,
          grossWeightKg: 200
        }
      ],
      notes: 'Morning market purchase'
    }
  });
});

test('reports invalid purchase fields and product indexes', () => {
  const result = validateCreatePurchasePayload({
    purchaseDate: '2026-02-30',
    totalCost: -1,
    currency: 'rupees',
    products: [
      {
        productId: 100,
        name: '',
        size: 0,
        sizedesc: '',
        unitprice: -1,
        grossWeightKg: 0
      },
      {
        productId: 100,
        name: 'Rui',
        size: 1000,
        sizedesc: 'Small',
        unitprice: 10.123,
        grossWeightKg: '2'
      }
    ],
    notes: 42
  });

  assert.ok(result.errors.some((error) => error.field === 'purchaseDate'));
  assert.ok(result.errors.some((error) => error.field === 'totalCost'));
  assert.ok(result.errors.some((error) => error.field === 'currency'));
  assert.ok(result.errors.some((error) => error.field === 'notes'));
  assert.ok(result.errors.some((error) =>
    error.index === 1 && error.field === 'productId'
  ));
  assert.ok(result.errors.some((error) =>
    error.index === 1 && error.field === 'grossWeightKg'
  ));
  assert.ok(result.errors.some((error) =>
    error.index === 0 && error.field === 'name'
  ));
  assert.ok(result.errors.some((error) =>
    error.index === 0 && error.field === 'size'
  ));
  assert.ok(result.errors.some((error) =>
    error.index === 1 && error.field === 'unitprice'
  ));
});

test('creates the purchase table and inserts in one transaction', async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('RETURNING')) {
        return {
          rows: [{
            id: '1',
            date: '2026-07-29',
            data: validateCreatePurchasePayload(validPayload).purchase,
            status: '1000',
            created_at: '2026-08-01T00:00:00.000Z'
          }]
        };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    }
  };
  const repository = createPurchaseRepository({
    async connect() {
      return client;
    }
  });

  const created = await repository.create(
    '767524024827354',
    validateCreatePurchasePayload(validPayload).purchase
  );

  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /pg_advisory_xact_lock/);
  assert.match(queries[2].sql, /CREATE TABLE IF NOT EXISTS/);
  assert.match(queries[2].sql, /"767524024827354"\."purchase"/);
  assert.match(queries[3].sql, /INSERT INTO/);
  assert.match(queries[3].sql, /"status"/);
  assert.match(queries[3].sql, /1000/);
  assert.equal(queries[4].sql, 'COMMIT');
  assert.equal(created.id, '1');
  assert.equal(created.status, 1000);
  assert.equal(released, true);
});

test('returns purchase data JSON ordered by purchase id for a date', async () => {
  const expected = [
    { purchaseDate: '2026-07-29', totalCost: 100, products: [] },
    { purchaseDate: '2026-07-29', totalCost: 200, products: [] }
  ];
  const queries = [];
  const repository = createPurchaseRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: expected.map((data) => ({ data })) };
    }
  });

  const result = await repository.findDataByDate(
    '767524024827354',
    '2026-07-29'
  );

  assert.deepEqual(result, expected);
  assert.match(queries[0].sql, /"767524024827354"\."purchase"/);
  assert.match(queries[0].sql, /WHERE "date" = \$1::date/);
  assert.match(queries[0].sql, /ORDER BY "id"/);
  assert.deepEqual(queries[0].params, ['2026-07-29']);
});

test('get purchases sorting endpoint returns the data JSON list', async (t) => {
  const expected = [{ purchaseDate: '2026-07-29', totalCost: 74980 }];
  const purchaseService = {
    async findDataByDate(orgid, date) {
      assert.equal(orgid, '767524024827354');
      assert.equal(date, '2026-07-29');
      return expected;
    }
  };
  const app = createApp(null, null, null, purchaseService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(
    `http://127.0.0.1:${port}/wholesale/getpurchases/sorting`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: 767524024827354,
        date: '2026-07-29'
      })
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-result-count'), '1');
  assert.deepEqual(await response.json(), expected);
});
