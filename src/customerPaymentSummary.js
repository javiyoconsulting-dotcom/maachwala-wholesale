'use strict';

const { parseNumber } = require('./salesSummary');

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function positiveMarker(value) {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['true', 'yes', 'y', '1'].includes(value.trim().toLowerCase());
}

function transactionType(record) {
  const explicit = [
    record.transactionType,
    record.paymentType,
    record.creditDebit,
    record.creditOrDebit
  ].find((value) => typeof value === 'string' && value.trim());

  if (explicit) {
    const normalized = explicit.trim().toLowerCase();
    if (normalized === 'credit') return 'credit';
    if (normalized === 'debit' || normalized === 'cash') return 'debit';
  }

  if (positiveMarker(record.credit) && !positiveMarker(record.debit)) {
    return 'credit';
  }
  if (positiveMarker(record.debit) && !positiveMarker(record.credit)) {
    return 'debit';
  }
  return null;
}

function transactionKey(salesRowId, record) {
  const recordId = record.sourceNoteRowId || record.lineId || record.noteId;
  return recordId ? `${salesRowId}:${recordId}` : null;
}

function existingLedger(payment, customerId) {
  const data = payment?.data && typeof payment.data === 'object'
    ? payment.data
    : {};
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];

  return {
    paymentId: payment?.id || null,
    customerId,
    creditTotal: parseNumber(data.creditTotal ?? data.credit) ?? 0,
    debitTotal: parseNumber(data.debitTotal ?? data.debit) ?? 0,
    transactions: [...transactions],
    processedKeys: new Set(
      transactions.map((item) => item.transactionKey).filter(Boolean)
    ),
    newTransactionCount: 0
  };
}

function buildCustomerPaymentUpdates(
  salesRows,
  existingPayments,
  discountWeight,
  orgid,
  date
) {
  const paymentByCustomer = new Map(
    existingPayments.map((payment) => [String(payment.customerid), payment])
  );
  const ledgers = new Map();
  const invalidRecords = [];
  let duplicateRecordCount = 0;

  for (const salesRow of salesRows) {
    const records = Array.isArray(salesRow.data?.rows) ? salesRow.data.rows : [];

    for (const record of records) {
      const customerId = String(record.customerId || '').trim();
      const supplier = String(record.supplier || '').trim();
      const product = String(record.product || '').trim();
      const quantity = parseNumber(record.weight);
      const unitPrice = parseNumber(record.unitprice);
      const type = transactionType(record);
      const key = transactionKey(salesRow.id, record);

      if (!/^\d+$/.test(customerId) || !supplier || !product ||
          quantity === null || quantity < 0 ||
          unitPrice === null || unitPrice < 0 || !type || !key) {
        invalidRecords.push({
          salesRowId: salesRow.id,
          record,
          reason: 'customerId, supplier, product, numeric weight/unitprice, record identity, and credit/debit/cash marker are required'
        });
        continue;
      }

      let ledger = ledgers.get(customerId);
      if (!ledger) {
        ledger = existingLedger(paymentByCustomer.get(customerId), customerId);
        ledgers.set(customerId, ledger);
      }

      if (ledger.processedKeys.has(key)) {
        duplicateRecordCount += 1;
        continue;
      }

      const discountApplied = positiveMarker(record.weightdiscount);
      const discountQuantity = discountApplied
        ? Math.floor(quantity) * discountWeight
        : 0;
      const billableQuantity = roundQuantity(quantity - discountQuantity);
      const totalAmount = roundMoney(billableQuantity * unitPrice);
      const creditAmount = type === 'credit' ? totalAmount : 0;
      const debitAmount = type === 'debit' ? totalAmount : 0;

      ledger.creditTotal = roundMoney(ledger.creditTotal + creditAmount);
      ledger.debitTotal = roundMoney(ledger.debitTotal + debitAmount);
      ledger.newTransactionCount += 1;
      ledger.processedKeys.add(key);
      ledger.transactions.push({
        transactionKey: key,
        salesRowId: String(salesRow.id),
        salesDate: date,
        customerId,
        customerName: String(record.customerName || '').trim(),
        fish: product,
        supplier,
        quantity,
        unitPrice,
        weightDiscountApplied: discountApplied,
        weightDiscountPerKg: discountApplied ? discountWeight : 0,
        weightDiscountQuantity: roundQuantity(discountQuantity),
        billableQuantity,
        totalAmount,
        transactionType: type,
        creditAmount,
        debitAmount,
        sourceRecord: record
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const payments = Array.from(ledgers.values()).map((ledger) => {
    const netBalance = roundMoney(ledger.creditTotal - ledger.debitTotal);
    return {
      paymentId: ledger.paymentId,
      customerId: ledger.customerId,
      credit: netBalance > 0,
      debit: netBalance < 0,
      data: {
        orgid,
        customerId: ledger.customerId,
        creditTotal: ledger.creditTotal,
        debitTotal: ledger.debitTotal,
        netBalance,
        transactions: ledger.transactions,
        lastProcessedDate: date,
        updatedAt: generatedAt
      },
      newTransactionCount: ledger.newTransactionCount
    };
  });

  return {
    payments,
    invalidRecords,
    duplicateRecordCount
  };
}

module.exports = {
  buildCustomerPaymentUpdates,
  positiveMarker,
  transactionType
};
