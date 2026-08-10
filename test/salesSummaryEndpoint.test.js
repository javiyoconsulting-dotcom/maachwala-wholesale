'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  createSalesSummaryRepository
} = require('../src/salesSummaryRepository');

const summary = {
  orgid: '767524024827354',
  date: '2026-08-10',
  discountWeight: 0.05,
  groupCount: 1,
  groups: [{ supplier: 'Kulgachi', product: 'Rui' }]
};

test('fetches the latest non-null sales summary by date', async () => {
  const queries = [];
  const repository = createSalesSummaryRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [{ summary }] };
    }
  });

  assert.deepEqual(
    await repository.findSummaryByDate('767524024827354', '2026-08-10'),
    summary
  );
  assert.match(queries[0].sql, /"767524024827354"\."sales"/);
  assert.match(queries[0].sql, /WHERE "date" = \$1::date/);
  assert.match(queries[0].sql, /"summary" IS NOT NULL/);
  assert.match(queries[0].sql, /ORDER BY "id" DESC/);
  assert.deepEqual(queries[0].params, ['2026-08-10']);
});

test('reports when no sales summary exists for the date', async () => {
  const repository = createSalesSummaryRepository({
    async query() {
      return { rows: [] };
    }
  });
  await assert.rejects(
    repository.findSummaryByDate('767524024827354', '2026-08-10'),
    (error) => error.code === 'SALES_SUMMARY_NOT_FOUND'
  );
});

test('sales summary endpoint returns summary JSON', async (t) => {
  const service = {
    async findSummaryByDate(orgid, salesDate) {
      assert.equal(orgid, '767524024827354');
      assert.equal(salesDate, '2026-08-10');
      return summary;
    }
  };
  const app = createApp(null, service);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/salesummary`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: 767524024827354,
        salesDate: '2026-08-10'
      })
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), summary);
});

test('sales summary endpoint validates orgid and sales date', async (t) => {
  const app = createApp(null, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/salesummary`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 'invalid', salesDate: '2026-02-30' })
    }
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});
