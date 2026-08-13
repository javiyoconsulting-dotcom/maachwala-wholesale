'use strict';

function valueOrNull(value) {
  return value === undefined || value === null ? null : value;
}

function normalizeProduct(product) {
  const source = product && typeof product === 'object' &&
    !Array.isArray(product) ? product : {};
  return {
    productId: valueOrNull(source.productId),
    name: valueOrNull(source.name),
    size: valueOrNull(source.size),
    sizedesc: valueOrNull(source.sizedesc),
    unitprice: valueOrNull(source.unitprice),
    grossWeightKg: valueOrNull(source.grossWeightKg)
  };
}

function validateCreatePurchasePayload(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body)
    ? body
    : {};
  const products = Array.isArray(source.products)
    ? source.products.map(normalizeProduct)
    : valueOrNull(source.products);

  return {
    errors: [],
    purchase: {
      purchaseDate: valueOrNull(source.purchaseDate),
      totalCost: valueOrNull(source.totalCost),
      currency: valueOrNull(source.currency),
      products,
      notes: valueOrNull(source.notes)
    }
  };
}

module.exports = { normalizeProduct, validateCreatePurchasePayload };
