'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCreatePurchasePayload } = require('../src/createPurchase');
const { createPurchaseRepository } = require('../src/purchaseRepository');

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
            purchase_date: '2026-07-29',
            total_cost: '74980.00',
            currency: 'INR',
            products: validPayload.products,
            notes: validPayload.notes,
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
  assert.match(queries[2].sql, /"767524024827354"\."purchases"/);
  assert.match(queries[3].sql, /INSERT INTO/);
  assert.equal(queries[4].sql, 'COMMIT');
  assert.equal(created.id, '1');
  assert.equal(released, true);
});
