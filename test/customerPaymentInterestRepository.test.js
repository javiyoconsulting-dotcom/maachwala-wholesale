'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCustomerPaymentRepository
} = require('../src/customerPaymentRepository');

test('loads the joined interest policy once for the entire processing run', async () => {
  const queries = [];
  let receivedPolicy;
  const client = {
    async query(sql) {
      const statement = String(sql);
      queries.push(statement);
      if (statement.includes('FROM "767524024827354"."discount"')) {
        return { rowCount: 1, rows: [{ weight: 0.05 }] };
      }
      if (statement.includes('to_regclass')) {
        return {
          rowCount: 1,
          rows: [{ relation: '767524024827354.interest_calculation' }]
        };
      }
      if (statement.includes('AS "interest"')) {
        return {
          rowCount: 1,
          rows: [{ weightLimit: '10', interestValue: 1, weightUnit: 'KG' }]
        };
      }
      if (statement.includes('FROM "767524024827354"."sales"')) {
        return {
          rowCount: 1,
          rows: [{
            id: '1',
            data: {
              rows: [{
                lineId: 'line_1',
                customerId: '10014',
                supplier: 'Skj',
                product: 'Rui',
                weight: '18',
                unitprice: '100',
                transactionType: 'credit'
              }]
            }
          }]
        };
      }
      if (statement.includes('WHERE "customerid" = ANY')) {
        return { rowCount: 0, rows: [] };
      }
      if (statement.includes('MAX("id")')) {
        return { rowCount: 1, rows: [{ last_id: '0' }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  const repository = createCustomerPaymentRepository({
    async connect() {
      return client;
    }
  });

  const result = await repository.processForDate(
    '767524024827354',
    '2026-10-03',
    (salesRows, existingPayments, discountWeight, orgid, date, policy) => {
      receivedPolicy = policy;
      return {
        payments: [],
        duplicateRecordCount: 0,
        invalidRecords: []
      };
    }
  );

  assert.deepEqual(receivedPolicy, {
    weightLimit: 10,
    interestValue: 1,
    weightUnit: 'KG'
  });
  assert.equal(
    queries.filter((sql) => sql.includes('AS "interest"')).length,
    1
  );
  assert.match(
    queries.find((sql) => sql.includes('AS "interest"')),
    /"core"\."weight_unit"/
  );
  assert.equal(result.customerCount, 0);
});

test('continues without interest when the tenant has no interest table', async () => {
  let receivedPolicy = 'not-set';
  const client = {
    async query(sql) {
      const statement = String(sql);
      if (statement.includes('FROM "767524024827356"."discount"')) {
        return { rowCount: 0, rows: [] };
      }
      if (statement.includes('to_regclass')) {
        return { rowCount: 1, rows: [{ relation: null }] };
      }
      if (statement.includes('FROM "767524024827356"."sales"')) {
        return { rowCount: 1, rows: [{ id: '1', data: { rows: [] } }] };
      }
      if (statement.includes('MAX("id")')) {
        return { rowCount: 1, rows: [{ last_id: '0' }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  const repository = createCustomerPaymentRepository({
    async connect() {
      return client;
    }
  });

  await repository.processForDate(
    '767524024827356',
    '2026-10-03',
    (...args) => {
      receivedPolicy = args[5];
      return {
        payments: [],
        duplicateRecordCount: 0,
        invalidRecords: []
      };
    }
  );

  assert.equal(receivedPolicy, null);
});
