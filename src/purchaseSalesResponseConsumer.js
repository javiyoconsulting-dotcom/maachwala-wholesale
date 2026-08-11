'use strict';

const JSONbig = require('json-bigint')({ storeAsString: true });

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePurchaseSalesResponseMessage(body) {
  let payload = body;
  if (body?.message?.data) {
    try {
      payload = JSONbig.parse(
        Buffer.from(body.message.data, 'base64').toString('utf8')
      );
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object') return null;

  if (typeof payload.orgid === 'number' &&
      !Number.isSafeInteger(payload.orgid)) return null;
  const orgid = String(payload.orgid ?? '').trim();
  const purchaseNumber = numericValue(payload.purchaseNumber);
  const quantity = numericValue(payload.quantity);
  const weightDiscount = numericValue(payload.weightDiscount);
  const unitPrice = numericValue(payload.unitPrice);

  if (!/^\d+$/.test(orgid) || !Number.isSafeInteger(purchaseNumber) ||
      purchaseNumber <= 0 || quantity === null || quantity < 0 ||
      weightDiscount === null || weightDiscount < 0 ||
      unitPrice === null || unitPrice < 0) return null;

  return { orgid, purchaseNumber, quantity, weightDiscount, unitPrice };
}

function createPurchaseSalesResponseConsumerService(repository) {
  return {
    parseMessage: parsePurchaseSalesResponseMessage,
    process: (message) => repository.process(message)
  };
}

module.exports = {
  createPurchaseSalesResponseConsumerService,
  parsePurchaseSalesResponseMessage
};
