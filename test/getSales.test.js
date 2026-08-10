'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  applySalesWeightDiscount,
  createSalesSummaryRepository
} = require('../src/salesSummaryRepository');

const expected = [
  { rows: [{ product: 'Pomfret', weight: 10 }] },
  { rows: [{ product: 'Katla', weight: 20 }] }
];

test('fetches sales data JSON by purchase date', async () => {
  const queries = [];
  const repository = createSalesSummaryRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('"discount"')) {
        return { rows: [{ weight: 5 }] };
      }
      return { rows: expected.map((data) => ({ data })) };
    }
  });

  const result = await repository.findDataByDate(
    '767524024827354',
    '2026-08-10'
  );

  assert.deepEqual(result, expected);
  assert.match(queries[0].sql, /"767524024827354"\."discount"/);
  assert.match(queries[1].sql, /"767524024827354"\."sales"/);
  assert.match(queries[1].sql, /WHERE "date" = \$1::date/);
  assert.match(queries[1].sql, /ORDER BY "id"/);
  assert.deepEqual(queries[1].params, ['2026-08-10']);
});

test('applies percentage discount using the nearest whole kilogram', () => {
  const data = {
    rows: [
      { weight: 3.3, unitprice: 200, weightdiscount: 'Y' },
      { weight: 3.5, unitprice: 100, weightdiscount: true },
      { weight: 8, unitprice: 25.5, weightdiscount: 'n' }
    ]
  };

  assert.deepEqual(applySalesWeightDiscount(data, 5), {
    rows: [
      {
        weight: 3.3,
        unitprice: 200,
        weightdiscount: 'Y',
        discountedweight: 3.15,
        totalprice: 630
      },
      {
        weight: 3.5,
        unitprice: 100,
        weightdiscount: true,
        discountedweight: 3.3,
        totalprice: 330
      },
      {
        weight: 8,
        unitprice: 25.5,
        weightdiscount: 'n',
        totalprice: 204
      }
    ]
  });
});

test('leaves a sales row unchanged when weight or unit price is invalid', () => {
  const data = {
    rows: [
      { weight: 'invalid', unitprice: 100, weightdiscount: 'Y' },
      { weight: 2, weightdiscount: 'n' }
    ]
  };

  assert.deepEqual(applySalesWeightDiscount(data, 5), data);
});

test('maps a missing sales table to a not-found error', async () => {
  const repository = createSalesSummaryRepository({
    async query(sql) {
      if (String(sql).includes('"discount"')) {
        return { rows: [{ weight: 5 }] };
      }
      const error = new Error('relation does not exist');
      error.code = '42P01';
      throw error;
    }
  });

  await assert.rejects(
    repository.findDataByDate('767524024827354', '2026-08-10'),
    (error) => error.code === 'SALES_TABLE_NOT_FOUND'
  );
});

test('maps a missing discount table to a not-found error', async () => {
  const repository = createSalesSummaryRepository({
    async query() {
      const error = new Error('relation does not exist');
      error.code = '42P01';
      throw error;
    }
  });

  await assert.rejects(
    repository.findDataByDate('767524024827354', '2026-08-10'),
    (error) => error.code === 'DISCOUNT_TABLE_NOT_FOUND'
  );
});

test('get sales endpoint returns matching data values', async (t) => {
  const salesService = {
    async findDataByDate(orgid, purchaseDate) {
      assert.equal(orgid, '767524024827354');
      assert.equal(purchaseDate, '2026-08-10');
      return expected;
    }
  };
  const app = createApp(null, salesService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getsales`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: 767524024827354,
        purchasedate: '2026-08-10'
      })
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-result-count'), '2');
  assert.deepEqual(await response.json(), expected);
});

test('get sales endpoint validates organization and date', async (t) => {
  const app = createApp(null, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getsales`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 'invalid', purchasedate: '2026-02-30' })
    }
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});
