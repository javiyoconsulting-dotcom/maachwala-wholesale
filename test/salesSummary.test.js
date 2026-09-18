'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCustomerBuyData,
  buildSalesSummary,
  parseNumber
} = require('../src/salesSummary');
const { parseSalesMessage } = require('../src/pubsub');
const {
  createSalesSummaryRepository
} = require('../src/salesSummaryRepository');

test('groups sales by supplier and product and applies per-kg discount', () => {
  const salesRows = [{
    id: '5',
    data: {
      rows: [
        { supplier: 'Skj', product: 'Rui', weight: '20.3', unitprice: '200', weightdiscount: 'Y', transactionType: 'cash' },
        { supplier: 'skj', product: 'rui', weight: '10.5', unitprice: '220', weightdiscount: true, transactionType: 'credit' },
        { supplier: 'Other', product: 'Katla', weight: '2', unitprice: '100' }
      ]
    }
  }];

  const summary = buildSalesSummary(
    salesRows,
    0.05,
    '767524024827354',
    '2026-07-28'
  );

  assert.equal(summary.groupCount, 2);
  assert.equal(summary.invalidRecordCount, 0);
  assert.equal(summary.totalCashCollection, 3860);
  assert.equal(summary.totalCredit, 2200);
  assert.deepEqual(summary.groups[0], {
    supplier: 'Skj',
    product: 'Rui',
    totalSalesQuantity: 30.8,
    averageUnitPrice: 206.83,
    cashCollection: 3860,
    creditCollection: 2200,
    totalCost: 6060,
    weightDiscount: 29.3,
    salesRecords: [
      {
        salesRowId: '5',
        supplier: 'Skj',
        product: 'Rui',
        weight: '20.3',
        unitprice: '200',
        weightdiscount: 'Y',
        transactionType: 'cash'
      },
      {
        salesRowId: '5',
        supplier: 'skj',
        product: 'rui',
        weight: '10.5',
        unitprice: '220',
        weightdiscount: true,
        transactionType: 'credit'
      }
    ]
  });
  assert.equal(
    summary.groups[0].totalCost,
    summary.groups[0].cashCollection + summary.groups[0].creditCollection
  );
  assert.notEqual(
    summary.groups[0].averageUnitPrice,
    Number(((20.3 * 200 + 10.5 * 220) / 30.8).toFixed(2))
  );
  assert.equal(
    summary.groups[0].averageUnitPrice,
    Number((summary.groups[0].totalCost /
      summary.groups[0].weightDiscount).toFixed(2))
  );
});

test('keeps malformed sales records out of calculations and reports them', () => {
  const invalid = {
    supplier: 'Kulgechi',
    product: 'Rui lakhidi',
    weight: '9 4',
    unitprice: '56.89'
  };
  const summary = buildSalesSummary(
    [{ id: '5', data: { rows: [invalid] } }],
    0.05,
    '767524024827354',
    '2026-07-28'
  );

  assert.equal(summary.groupCount, 0);
  assert.equal(summary.invalidRecordCount, 1);
  assert.equal(summary.totalCashCollection, 0);
  assert.equal(summary.totalCredit, 0);
  assert.deepEqual(summary.invalidRecords[0].record, invalid);
  assert.equal(parseNumber('9 4'), null);
});

test('sums per-record discounted weights before calculating collections and average price', () => {
  const summary = buildSalesSummary([{
    id: '6',
    data: { rows: [
      { supplier: 'Rkj', product: 'Kata', weight: '1.6', unitprice: '100', weightdiscount: 'Y', transactionType: 'cash' },
      { supplier: 'Rkj', product: 'Kata', weight: '1.6', unitprice: '200', weightdiscount: 'Y', transactionType: 'credit' }
    ] }
  }], 0.05, '767524024827354', '2026-09-10');

  const group = summary.groups[0];
  assert.equal(group.totalSalesQuantity, 3.2);
  assert.equal(group.weightDiscount, 3.1);
  assert.equal(group.cashCollection, 155);
  assert.equal(group.creditCollection, 310);
  assert.equal(group.totalCost, 465);
  assert.equal(group.averageUnitPrice, 150);
  assert.equal(summary.totalCashCollection, 155);
  assert.equal(summary.totalCredit, 310);
});

test('builds and stores summary and buydata with zero discount when no policy exists', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      const statement = String(sql);
      queries.push({ sql: statement, params });
      if (statement.includes('FROM "767524024827356"."discount"')) {
        return { rowCount: 0, rows: [] };
      }
      if (statement.includes('FROM "767524024827356"."sales"')) {
        return {
          rowCount: 1,
          rows: [{
            id: '2',
            data: {
              rows: [{
                supplier: 'Supplier',
                product: 'Rui',
                weight: '3.5',
                unitprice: '100',
                weightdiscount: 'Y',
                transactionType: 'cash'
              }]
            }
          }]
        };
      }
      if (statement.includes('UPDATE "767524024827356"."sales"')) {
        return { rowCount: 1, rows: [{ id: '2' }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  const repository = createSalesSummaryRepository({
    async connect() {
      return client;
    }
  });

  const result = await repository.summarizeForDate(
    '767524024827356',
    '2026-09-17',
    buildSalesSummary
  );

  assert.equal(result.updatedRows, 1);
  assert.equal(result.summary.discountWeight, 0);
  assert.equal(result.summary.totalCashCollection, 350);
  assert.equal(result.summary.totalCredit, 0);
  assert.equal(result.summary.groups[0].weightDiscount, 3.5);
  assert.equal(result.summary.groups[0].totalCost, 350);
  assert.deepEqual(result.buydata, { customers: [] });
  assert.match(queries.at(-2).sql, /SET "summary" = \$1::jsonb/);
});

test('builds customer buydata with customer details and discounted totals', () => {
  const salesRows = [{
    id: '8',
    data: {
      rows: [
        {
          customerId: '10099',
          product: 'Rui',
          weight: '8.93',
          unitprice: '100',
          weightdiscount: 'y'
        },
        {
          customerId: '10099',
          product: 'Katla',
          weight: '2',
          unitprice: '75',
          weightdiscount: ''
        },
        {
          customerId: '99999',
          product: 'Unknown customer fish',
          weight: '1',
          unitprice: '20'
        }
      ]
    }
  }];

  const buydata = buildCustomerBuyData(salesRows, [{
    number: '10099',
    name: 'Gobinda',
    phone: '8792349234'
  }], 0.05);

  assert.deepEqual(buydata, {
    customers: [{
      id: 10099,
      name: 'Gobinda',
      phone: 8792349234,
      transactions: [
        {
          product: 'Rui',
          quantity: 8.93,
          price: 100,
          weightdiscount: 0.4,
          total: 853
        },
        {
          product: 'Katla',
          quantity: 2,
          price: 75,
          weightdiscount: 0,
          total: 150
        }
      ]
    }]
  });
});

test('parses a Pub/Sub push envelope', () => {
  const payload = { orgid: 767524024827354, date: '2026-07-28' };
  const body = {
    message: {
      data: Buffer.from(JSON.stringify(payload)).toString('base64')
    },
    subscription: 'projects/maachwala/subscriptions/POST_SALES_DATA-sub'
  };

  assert.deepEqual(parseSalesMessage(body), {
    orgid: '767524024827354',
    date: '2026-07-28'
  });
});

test('rejects malformed Pub/Sub payloads and impossible dates', () => {
  assert.equal(parseSalesMessage({ message: { data: 'not-json' } }), null);
  assert.equal(parseSalesMessage({
    orgid: 'public',
    date: '2026-02-28'
  }), null);
  assert.equal(parseSalesMessage({
    orgid: '767524024827354',
    date: '2026-02-30'
  }), null);
});
