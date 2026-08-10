'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const {
  createSalesSummaryRepository
} = require('../src/salesSummaryRepository');

const summary = {
  date: '2026-08-10',
  orgid: '767524024827354',
  groups: [{
    supplier: 'Kulgachi',
    product: 'Rui',
    totalSalesQuantity: 10,
    salesRecords: []
  }],
  groupCount: 1,
  discountWeight: 0.05,
  invalidRecords: [],
  invalidRecordCount: 0
};

test('updates sales summary JSON for the supplied date', async () => {
  const queries = [];
  const repository = createSalesSummaryRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rowCount: 1, rows: [{ id: '8' }] };
    }
  });

  assert.deepEqual(
    await repository.updateSummaryByDate(
      '767524024827354', '2026-08-10', summary
    ),
    { updatedRows: 1, summary }
  );
  assert.match(queries[0].sql, /UPDATE "767524024827354"\."sales"/);
  assert.match(queries[0].sql, /SET "summary" = \$1::jsonb/);
  assert.match(queries[0].sql, /WHERE "date" = \$2::date/);
  assert.deepEqual(queries[0].params, [JSON.stringify(summary), '2026-08-10']);
});

test('reports when there is no sales row to update', async () => {
  const repository = createSalesSummaryRepository({
    async query() { return { rowCount: 0, rows: [] }; }
  });
  await assert.rejects(
    repository.updateSummaryByDate(
      '767524024827354', '2026-08-10', summary
    ),
    (error) => error.code === 'SALES_NOT_FOUND'
  );
});

test('update sales summary endpoint replaces summary JSON', async (t) => {
  const service = {
    async updateSummaryByDate(orgid, salesDate, data) {
      assert.equal(orgid, '767524024827354');
      assert.equal(salesDate, '2026-08-10');
      assert.deepEqual(data, summary);
      return { updatedRows: 1, summary: data };
    }
  };
  const app = createApp(null, service);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/updatesalesummary`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: 767524024827354,
        date: '2026-08-10',
        data: summary
      })
    }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'success');
  assert.equal(body.updatedRows, 1);
  assert.deepEqual(body.summary, summary);
});

test('update sales summary endpoint requires a data object', async (t) => {
  const app = createApp(null, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/updatesalesummary`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgid: 767524024827354,
        date: '2026-08-10',
        data: []
      })
    }
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});
