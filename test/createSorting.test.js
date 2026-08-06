'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { validateCreateSortingPayload } = require('../src/createSorting');
const { createPurchaseRepository } = require('../src/purchaseRepository');

const validPayload = {
  orgid: 767524024827354,
  purchaseDate: '2026-08-01',
  purchaseNumber: 1785542400001,
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
  assert.equal(result.sorting.purchaseNumber, 1785542400001);
  assert.equal(result.sorting.status, 'DRAFT');
  assert.equal(result.sorting.products.length, 2);
  assert.equal(result.sorting.products[0].sizes.length, 3);
  assert.equal(result.sorting.totalSortedWeightKg, 223);
});

test('rejects inconsistent sorted total and malformed nested sizes', () => {
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
  assert.equal(result.errors.some((error) =>
    error.field === 'sortingDifferenceKg'
  ), false);
});

test('preserves sorting difference without validation', () => {
  for (const value of [-10, 'manual adjustment', null, { value: 2 }]) {
    const result = validateCreateSortingPayload({
      ...validPayload,
      sortingDifferenceKg: value
    });
    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.sorting.sortingDifferenceKg, value);
  }
});

test('requires a positive purchase number', () => {
  const result = validateCreateSortingPayload({
    ...validPayload,
    purchaseNumber: null
  });
  assert.ok(result.errors.some((error) => error.field === 'purchaseNumber'));
});

test('inserts one sorting row per size and updates purchase status', async () => {
  const sorting = validateCreateSortingPayload(validPayload).sorting;
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params) {
      const query = String(sql);
      queries.push({ sql: query, params });
      if (query.includes('UPDATE') && query.includes('"purchase"')) {
        return {
          rowCount: 1,
          rows: [{
            id: '8',
            date: '2026-08-01',
            number: '1785542400001',
            status: '1001'
          }]
        };
      }
      if (query.includes('INSERT INTO') && query.includes('"sorting"')) {
        return {
          rowCount: 4,
          rows: sorting.products.flatMap((product) =>
            product.sizes.map((size, index) => ({
              id: String(index + 1),
              purchasedate: sorting.purchaseDate,
              purchasenumber: String(sorting.purchaseNumber),
              number: '583920174625',
              productid: String(product.productId),
              productdesc: product.name,
              sizeid: String(size.size),
              sizedesc: size.sizedesc,
              quantity: size.grossWeightKg,
              allocatedquantity: null,
              allocationcomplete: false
            }))
          )
        };
      }
      return { rowCount: 0, rows: [] };
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

  const result = await repository.updateSorting('767524024827354', sorting);

  assert.equal(result.id, '8');
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /pg_advisory_xact_lock/);
  assert.match(queries[2].sql, /CREATE TABLE IF NOT EXISTS/);
  assert.match(queries[2].sql, /"767524024827354"\."sorting"/);
  assert.match(queries[3].sql, /ALTER TABLE/);
  assert.match(queries[3].sql, /"allocationcomplete" boolean/);
  assert.match(queries[4].sql, /SET "status" = 1001/);
  assert.equal(Number(result.status), 1001);
  assert.match(queries[4].sql, /WHERE "date" = \$1::date/);
  assert.match(queries[4].sql, /AND "number" = \$2::numeric/);
  assert.match(queries[5].sql, /INSERT INTO/);
  assert.match(queries[5].sql, /jsonb_to_recordset/);
  assert.match(queries[5].sql, /"allocatedquantity"/);
  assert.match(queries[5].sql, /"allocationcomplete"/);
  assert.match(queries[5].sql, /NULL, false/);
  assert.equal(JSON.parse(queries[5].params[2]).length, 4);
  assert.equal(queries[6].sql, 'COMMIT');
  assert.equal(result.sortingNumber, '583920174625');
  assert.equal(result.insertedCount, 4);
  assert.equal(result.sortingRows.every((row) =>
    row.allocatedquantity === null
  ), true);
  assert.equal(result.sortingRows.every((row) =>
    row.allocationcomplete === false
  ), true);
  assert.equal(released, true);
});

test('reports when no purchase exists for the date and purchase number', async () => {
  let rolledBack = false;
  const client = {
    async query(sql) {
      const query = String(sql);
      if (query === 'ROLLBACK') {
        rolledBack = true;
      }
      if (query.includes('UPDATE') && query.includes('"purchase"')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  const repository = createPurchaseRepository({
    async connect() {
      return client;
    }
  });
  await assert.rejects(
    repository.updateSorting(
      '767524024827354',
      validateCreateSortingPayload(validPayload).sorting
    ),
    (error) => error.code === 'PURCHASE_NOT_FOUND'
  );
  assert.equal(rolledBack, true);
});

test('create sorting endpoint returns the updated sorting JSON', async (t) => {
  const sorting = validateCreateSortingPayload(validPayload).sorting;
  const purchaseService = {
    async updateSorting(orgid, input) {
      assert.equal(orgid, '767524024827354');
      assert.deepEqual(input, sorting);
      return {
        id: '8',
        date: '2026-08-01',
        number: '1785542400001',
        status: '1001',
        sortingNumber: '583920174625',
        insertedCount: 4,
        sortingRows: [{
          id: '1',
          purchasenumber: '1785542400001',
          number: '583920174625',
          allocatedquantity: null,
          allocationcomplete: false
        }],
        sortingdata: sorting
      };
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
  assert.equal(body.purchaseNumber, 1785542400001);
  assert.equal(body.purchaseStatus, 1001);
  assert.equal(body.sortingNumber, 583920174625);
  assert.equal(body.insertedCount, 4);
  assert.equal(body.sortingRows[0].allocatedquantity, null);
  assert.equal(body.sortingRows[0].allocationcomplete, false);
  assert.deepEqual(body.sortingdata, sorting);
});
