'use strict';

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateUpdatePurchaseResponsePayload(body) {
  const errors = [];
  const purchaseNumber = finiteNumber(body?.purchaseNumber);
  const quantity = finiteNumber(body?.quantity);
  const weightDiscount = finiteNumber(body?.weightDiscount);
  const unitPrice = finiteNumber(body?.unitPrice);

  if (!Number.isSafeInteger(purchaseNumber) || purchaseNumber <= 0) {
    errors.push({
      field: 'purchaseNumber',
      message: 'purchaseNumber must be a positive safe integer'
    });
  }
  if (quantity === null || quantity < 0) {
    errors.push({ field: 'quantity', message: 'quantity must be zero or greater' });
  }
  if (weightDiscount === null || weightDiscount < 0) {
    errors.push({
      field: 'weightDiscount',
      message: 'weightDiscount must be zero or greater'
    });
  }
  if (unitPrice === null || unitPrice < 0) {
    errors.push({ field: 'unitPrice', message: 'unitPrice must be zero or greater' });
  }

  return {
    errors,
    payload: errors.length === 0
      ? { purchaseNumber, quantity, weightDiscount, unitPrice }
      : null
  };
}

module.exports = { validateUpdatePurchaseResponsePayload };
