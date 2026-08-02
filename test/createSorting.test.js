'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { validateCreateSortingPayload } = require('../src/createSorting');
const { createPurchaseRepository } = require('../src/purchaseRepository');

const validPayload = {
  orgid: 767524024827354,
  purchaseDate: '2026-08-01',
  status: 'DRAFT',
  products: [
    {
      productId: 10000,
      name: 'Pomfret',
      sizes: [
        { size: 1000, sizedesc: 'Small', grossWeightKg: 75.50 },
        { size: 1001, sizedesc: 'Medium', grossWeightKg: 92.25 },
        { size: 1002, sizedesc: 'Large', grossWeightKg: 10.00 }
      ]
    },
    {
      productId: 10001,
      name: 'Katla',
      sizes: [
        { size: 1000, sizedesc: 'Small', grossWeightKg: 45.25 }
      ]
    }
  ],
  totalPurchasedWeightKg: 225.00,
  totalSortedWeightKg: 223.00,
  sortingDifferenceKg: 2.00,
  notes: 'Sorting completed at morning warehouse'
};

test('validates and normalizes sorting data', () => {
  const result = validateCreateSortingPayload(validPayload);
  assert.equal(result.errors.length, 0);
  assert.equal(result.sorting.purchaseDate, '2026-08-01');
  assert.equal(result.sorting.status, 'DRAFT');
  assert.equal(result.sorting.products.length, 2);
  assert.equal(result.sorting.products[0].sizes.length, 3);
  assert.equal(result.sorting.totalSortedWeightKg, 223);
});

test('rejects inconsistent sorting totals and malformed nested sizes', () => {
  const result = validateCreateSortingPayload({
    ...validPayload,
    totalSortedWeightKg: 220,
    sortingDifferenceKg: 1,
    products: [{
      productId: 10000,
      name: '',
      sizes: [{ size: 0, sizedesc: '', grossWeightKg: -1 }]
    }]
  });
  assert.ok(result.errors.some((error) => error.field === 'name'));
  assert.ok(result.errors.some((error) => error.field === 'size'));
  assert.ok(result.errors.some((error) => error.field === 'sizedesc'));
  assert.ok(result.errors.some((error) => error.field === 'grossWeightKg'));
  assert.ok(result.errors.some((error) =>
    error.field === 'totalSortedWeightKg'
  ));
  assert.ok(result.errors.some((error) =>
    error.field === 'sortingDifferenceKg'
  ));
});

test('updates sortingdata on the latest purchase matching the date', async () => {
  const sorting = validateCreateSortingPayload(validPayload).sorting;
  const queries = [];
  const repository = createPurchaseRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return {
        rowCount: 1,
        rows: [{ id: '8', date: '2026-08-01', sortingdata: sorting }]
      };
    }
  });

  const result = await repository.updateSorting('767524024827354', sorting);

  assert.equal(result.id, '8');
  assert.match(queries[0].sql, /SET "sortingdata" = \$2::jsonb/);
  assert.match(queries[0].sql, /WHERE "date" = \$1::date/);
  assert.match(queries[0].sql, /ORDER BY "id" DESC/);
  assert.deepEqual(queries[0].params, [
    '2026-08-01',
    JSON.stringify(sorting)
  ]);
});

test('reports when no purchase exists for the sorting date', async () => {
  const repository = createPurchaseRepository({
    async query() {
      return { rowCount: 0, rows: [] };
    }
  });
  await assert.rejects(
    repository.updateSorting(
      '767524024827354',
      validateCreateSortingPayload(validPayload).sorting
    ),
    (error) => error.code === 'PURCHASE_NOT_FOUND'
  );
});

test('create sorting endpoint returns the updated sorting JSON', async (t) => {
  const sorting = validateCreateSortingPayload(validPayload).sorting;
  const purchaseService = {
    async updateSorting(orgid, input) {
      assert.equal(orgid, '767524024827354');
      assert.deepEqual(input, sorting);
      return { id: '8', date: '2026-08-01', sortingdata: sorting };
    }
  };
  const app = createApp(null, null, null, purchaseService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/createsorting`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPayload)
    }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'success');
  assert.equal(body.purchaseId, '8');
  assert.deepEqual(body.sortingdata, sorting);
});
