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
    customerId: '10014',
    customerName: '',
    fish: 'Rui',
    supplier: 'Skj',
    quantity: 2,
    unitPrice: 100,
    weightDiscountApplied: false,
    weightDiscountPerKg: 0,
    weightDiscountQuantity: 0,
    billableQuantity: 2,
    totalAmount: 200,
    transactionType: 'credit',
    creditAmount: 200,
    debitAmount: 0
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

test('adds one parent-level daily interest entry for total credit quantity', () => {
  const result = buildCustomerPaymentUpdates([{
    id: '10',
    data: {
      rows: [
        {
          lineId: 'line_1',
          customerId: '10014',
          customerName: 'Altab',
          supplier: 'Skj',
          product: 'Rui',
          weight: '8',
          unitprice: '100',
          transactionType: 'credit'
        },
        {
          lineId: 'line_2',
          customerId: '10014',
          customerName: 'Altab',
          supplier: 'Kul',
          product: 'Katla',
          weight: '10',
          unitprice: '50',
          transactionType: 'credit'
        },
        {
          lineId: 'line_3',
          customerId: '10014',
          customerName: 'Altab',
          supplier: 'Kul',
          product: 'Chingri',
          weight: '5',
          unitprice: '200',
          transactionType: 'cash'
        }
      ]
    }
  }], [], 0, '767524024827354', '2026-10-03', {
    weightLimit: 10,
    interestValue: 1,
    weightUnit: 'KG'
  });

  const payment = result.payments[0];
  assert.equal(payment.data.transactions.length, 3);
  assert.equal(payment.data.interestEntries.length, 1);
  assert.deepEqual(
    {
      date: payment.data.interestEntries[0].date,
      totalCreditQuantity:
        payment.data.interestEntries[0].totalCreditQuantity,
      weightLimit: payment.data.interestEntries[0].weightLimit,
      weightUnit: payment.data.interestEntries[0].weightUnit,
      interestValue: payment.data.interestEntries[0].interestValue,
      interestAmount: payment.data.interestEntries[0].interestAmount
    },
    {
      date: '2026-10-03',
      totalCreditQuantity: 18,
      weightLimit: 10,
      weightUnit: 'KG',
      interestValue: 1,
      interestAmount: 2
    }
  );
  assert.equal(payment.data.outstandingInterest, 2);
  assert.equal(payment.data.creditTotal, 1302);
  assert.equal(payment.data.debitTotal, 1000);
  assert.equal(payment.data.netBalance, 302);
  assert.equal(payment.interestChanged, true);
  assert.equal(
    Object.hasOwn(payment.data.transactions[0], 'interestAmount'),
    false
  );
});

test('reprocessing the same business day replaces rather than duplicates interest', () => {
  const record = {
    lineId: 'line_1',
    customerId: '10014',
    supplier: 'Skj',
    product: 'Rui',
    weight: '18',
    unitprice: '100',
    transactionType: 'credit'
  };
  const existing = [{
    id: '1',
    customerid: '10014',
    data: {
      creditTotal: 1802,
      debitTotal: 0,
      outstandingInterest: 2,
      interestEntries: [{
        date: '2026-10-03',
        totalCreditQuantity: 18,
        weightLimit: 10,
        weightUnit: 'KG',
        interestValue: 1,
        interestAmount: 2
      }],
      transactions: [{
        transactionKey: '10:line_1',
        customerId: '10014',
        customerName: '',
        fish: 'Rui',
        supplier: 'Skj',
        quantity: 18,
        unitPrice: 100,
        weightDiscountApplied: false,
        weightDiscountPerKg: 0,
        weightDiscountQuantity: 0,
        billableQuantity: 18,
        totalAmount: 1800,
        transactionType: 'credit',
        creditAmount: 1800,
        debitAmount: 0
      }]
    }
  }];

  const result = buildCustomerPaymentUpdates(
    [{ id: '10', data: { rows: [record] } }],
    existing,
    0,
    '767524024827354',
    '2026-10-03',
    { weightLimit: 10, interestValue: 1, weightUnit: 'KG' }
  );
  const payment = result.payments[0];
  assert.equal(payment.newTransactionCount, 0);
  assert.equal(payment.interestChanged, false);
  assert.equal(payment.data.creditTotal, 1802);
  assert.equal(payment.data.outstandingInterest, 2);
  assert.equal(payment.data.interestEntries.length, 1);
});

test('reverses and replaces an amended cash sale that becomes credit', () => {
  const transactionKey = '4:note_8697352251_2026-10-03_line_1';
  const existing = [{
    id: '4',
    customerid: '10002',
    data: {
      creditTotal: 0,
      debitTotal: 753,
      outstandingInterest: 0,
      interestEntries: [],
      transactions: [{
        transactionKey,
        salesRowId: '4',
        salesDate: '2026-10-03',
        customerId: '10002',
        customerName: 'Rr',
        fish: 'Rui',
        supplier: 'Kulgachi',
        quantity: 3,
        unitPrice: 251,
        weightDiscountApplied: false,
        weightDiscountPerKg: 0,
        weightDiscountQuantity: 0,
        billableQuantity: 3,
        totalAmount: 753,
        transactionType: 'debit',
        creditAmount: 0,
        debitAmount: 753
      }]
    }
  }];
  const salesRows = [{
    id: '4',
    data: {
      rows: [{
        lineId: 'line_1',
        sourceNoteRowId: 'note_8697352251_2026-10-03_line_1',
        customerId: '10002',
        customerName: 'Rr',
        supplier: 'Kulgachi',
        product: 'Rui',
        weight: '4',
        unitprice: '2510',
        weightdiscount: 'N',
        transactionType: 'credit'
      }]
    }
  }];

  const result = buildCustomerPaymentUpdates(
    salesRows,
    existing,
    0.05,
    '767524024827356',
    '2026-10-03',
    { weightLimit: 10, interestValue: 1, weightUnit: 'KG' }
  );

  const payment = result.payments[0];
  const transaction = payment.data.transactions[0];
  assert.equal(result.duplicateRecordCount, 0);
  assert.equal(result.amendedTransactionCount, 1);
  assert.equal(payment.newTransactionCount, 0);
  assert.equal(payment.amendedTransactionCount, 1);
  assert.equal(payment.data.transactions.length, 1);
  assert.equal(transaction.transactionKey, transactionKey);
  assert.equal(transaction.transactionType, 'credit');
  assert.equal(transaction.quantity, 4);
  assert.equal(transaction.unitPrice, 2510);
  assert.equal(transaction.creditAmount, 10040);
  assert.equal(transaction.debitAmount, 0);
  assert.equal(payment.data.debitTotal, 0);
  assert.equal(payment.data.outstandingInterest, 1);
  assert.equal(payment.data.creditTotal, 10041);
  assert.equal(payment.data.netBalance, 10041);
  assert.equal(payment.credit, true);
  assert.equal(payment.debit, false);
});
