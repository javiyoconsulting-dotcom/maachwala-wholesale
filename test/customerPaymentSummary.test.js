'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCustomerPaymentUpdates,
  transactionType
} = require('../src/customerPaymentSummary');

test('accumulates multiple credit sales on the existing customer credit', () => {
  const salesRows = [{
    id: '6',
    data: {
      rows: [
        {
          lineId: 'line_1',
          customerId: '10014',
          customerName: 'Altab',
          supplier: 'Skj',
          product: 'Rui',
          weight: '2',
          unitprice: '100',
          transactionType: 'credit',
          weightdiscount: ''
        },
        {
          lineId: 'line_2',
          customerId: '10014',
          customerName: 'Altab',
          supplier: 'Kul',
          product: 'Katla',
          weight: '3',
          unitprice: '50',
          credit: true,
          weightdiscount: ''
        }
      ]
    }
  }];
  const existing = [{
    id: '1',
    customerid: '10014',
    data: {
      creditTotal: 75,
      debitTotal: 10,
      transactions: []
    }
  }];

  const result = buildCustomerPaymentUpdates(
    salesRows,
    existing,
    0.05,
    '767524024827354',
    '2026-07-29'
  );

  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].data.creditTotal, 425);
  assert.equal(result.payments[0].data.debitTotal, 10);
  assert.equal(result.payments[0].data.netBalance, 415);
  assert.equal(result.payments[0].credit, true);
  assert.equal(result.payments[0].debit, false);
  assert.equal(result.payments[0].data.transactions.length, 2);
  assert.equal(result.payments[0].newTransactionCount, 2);
});

test('calculates debit and weight-discounted total amount', () => {
  const result = buildCustomerPaymentUpdates([{
    id: '6',
    data: {
      rows: [{
        sourceNoteRowId: 'note_1_line_1',
        customerId: '10055',
        supplier: 'Kul',
        product: 'Rui',
        weight: '30.8',
        unitprice: '100',
        paymentType: 'debit',
        weightdiscount: 'y'
      }]
    }
  }], [], 0.05, '767524024827354', '2026-07-29');

  const payment = result.payments[0];
  const transaction = payment.data.transactions[0];
  assert.equal(transaction.weightDiscountQuantity, 1.5);
  assert.equal(transaction.billableQuantity, 29.3);
  assert.equal(transaction.totalAmount, 2930);
  assert.equal(transaction.debitAmount, 2930);
  assert.equal(payment.data.debitTotal, 2930);
  assert.equal(payment.credit, false);
  assert.equal(payment.debit, true);
});

test('treats cash sales as debit transactions', () => {
  const result = buildCustomerPaymentUpdates([{
    id: '8',
    data: {
      rows: [{
        lineId: 'line_1',
        customerId: '10099',
        customerName: 'Gobinda',
        supplier: 'Sjk',
        product: 'Rui',
        weight: '3',
        unitprice: '220',
        transactionType: 'cash'
      }]
    }
  }], [], 0.05, '767524024827354', '2026-07-31');

  const payment = result.payments[0];
  const transaction = payment.data.transactions[0];
  assert.equal(transaction.transactionType, 'debit');
  assert.equal(transaction.creditAmount, 0);
  assert.equal(transaction.debitAmount, 660);
  assert.equal(payment.data.debitTotal, 660);
  assert.equal(payment.credit, false);
  assert.equal(payment.debit, true);
  assert.equal(result.invalidRecords.length, 0);
});

test('marks both balance flags false when credit and debit are equal', () => {
  const result = buildCustomerPaymentUpdates([{
    id: '7',
    data: {
      rows: [{
        lineId: 'line_2',
        customerId: '10014',
        supplier: 'Skj',
        product: 'Rui',
        weight: '1',
        unitprice: '100',
        transactionType: 'debit'
      }]
    }
  }], [{
    id: '1',
    customerid: '10014',
    data: {
      creditTotal: 100,
      debitTotal: 0,
      transactions: []
    }
  }], 0.05, '767524024827354', '2026-07-29');

  assert.equal(result.payments[0].data.netBalance, 0);
  assert.equal(result.payments[0].credit, false);
  assert.equal(result.payments[0].debit, false);
});

test('does not apply a previously processed sales record twice', () => {
  const record = {
    lineId: 'line_1',
    customerId: '10014',
    supplier: 'Skj',
    product: 'Rui',
    weight: '2',
    unitprice: '100',
    transactionType: 'credit'
  };
  const existingTransaction = {
    transactionKey: '6:line_1',
    totalAmount: 200
  };

  const result = buildCustomerPaymentUpdates(
    [{ id: '6', data: { rows: [record] } }],
    [{
      id: '1',
      customerid: '10014',
      data: {
        creditTotal: 200,
        debitTotal: 0,
        transactions: [existingTransaction]
      }
    }],
    0.05,
    '767524024827354',
    '2026-07-29'
  );

  assert.equal(result.duplicateRecordCount, 1);
  assert.equal(result.payments[0].newTransactionCount, 0);
  assert.equal(result.payments[0].data.creditTotal, 200);
});

test('requires an explicit and unambiguous credit, debit, or cash marker', () => {
  assert.equal(transactionType({ transactionType: 'Credit' }), 'credit');
  assert.equal(transactionType({ debit: 'y' }), 'debit');
  assert.equal(transactionType({ transactionType: 'Cash' }), 'debit');
  assert.equal(transactionType({ credit: true, debit: true }), null);
  assert.equal(transactionType({ weightdiscount: 'y' }), null);
});
