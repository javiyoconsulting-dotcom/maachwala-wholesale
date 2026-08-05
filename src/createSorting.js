'use strict';

const { parseDate } = require('./pubsub');

const MAX_PRODUCTS = 500;
const MAX_SIZES_PER_PRODUCT = 100;
const MAX_TEXT_LENGTH = 200;
const MAX_NOTES_LENGTH = 2000;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validateCreateSortingPayload(body) {
  const errors = [];
  const purchaseDate = parseDate(body?.purchaseDate);
  const purchaseNumber = body?.purchaseNumber;
  const status = typeof body?.status === 'string'
    ? body.status.trim().toUpperCase()
    : '';
  const totalPurchasedWeightKg = finiteNumber(body?.totalPurchasedWeightKg);
  const totalSortedWeightKg = finiteNumber(body?.totalSortedWeightKg);
  const sortingDifferenceKg = finiteNumber(body?.sortingDifferenceKg);
  const notes = body?.notes === undefined || body?.notes === null
    ? null
    : typeof body.notes === 'string' ? body.notes.trim() : null;

  if (!purchaseDate) {
    errors.push({
      field: 'purchaseDate',
      message: 'purchaseDate is required and must be a valid YYYY-MM-DD date'
    });
  }
  if (!Number.isSafeInteger(purchaseNumber) || purchaseNumber <= 0) {
    errors.push({
      field: 'purchaseNumber',
      message: 'purchaseNumber is required and must be a positive safe integer'
    });
  }
  if (!/^[A-Z][A-Z0-9_ -]{0,49}$/.test(status)) {
    errors.push({
      field: 'status',
      message: 'status is required and must contain at most 50 valid characters'
    });
  }
  for (const [field, value] of [
    ['totalPurchasedWeightKg', totalPurchasedWeightKg],
    ['totalSortedWeightKg', totalSortedWeightKg],
    ['sortingDifferenceKg', sortingDifferenceKg]
  ]) {
    if (value === null || value < 0) {
      errors.push({ field, message: `${field} must be a non-negative number` });
    }
  }
  if (notes === null && body?.notes !== undefined && body?.notes !== null) {
    errors.push({ field: 'notes', message: 'notes must be a string' });
  } else if (notes && notes.length > MAX_NOTES_LENGTH) {
    errors.push({
      field: 'notes',
      message: `notes cannot exceed ${MAX_NOTES_LENGTH} characters`
    });
  }

  if (!Array.isArray(body?.products)) {
    errors.push({
      field: 'products',
      message: 'products is required and must be an array'
    });
    return { errors, sorting: null };
  }
  if (body.products.length === 0 || body.products.length > MAX_PRODUCTS) {
    errors.push({
      field: 'products',
      message: `products must contain between 1 and ${MAX_PRODUCTS} items`
    });
  }

  const productIds = new Set();
  const products = body.products.map((product, productIndex) => {
    const productId = product?.productId;
    const name = typeof product?.name === 'string' ? product.name.trim() : '';

    if (!Number.isSafeInteger(productId) || productId <= 0) {
      errors.push({
        productIndex,
        field: 'productId',
        message: 'productId must be a positive safe integer'
      });
    } else if (productIds.has(productId)) {
      errors.push({
        productIndex,
        field: 'productId',
        message: 'productId must be unique within the sorting request'
      });
    } else {
      productIds.add(productId);
    }
    if (!name || name.length > MAX_TEXT_LENGTH) {
      errors.push({
        productIndex,
        field: 'name',
        message: `name is required and cannot exceed ${MAX_TEXT_LENGTH} characters`
      });
    }

    if (!Array.isArray(product?.sizes)) {
      errors.push({
        productIndex,
        field: 'sizes',
        message: 'sizes is required and must be an array'
      });
      return { productId, name, sizes: [] };
    }
    if (product.sizes.length === 0 ||
        product.sizes.length > MAX_SIZES_PER_PRODUCT) {
      errors.push({
        productIndex,
        field: 'sizes',
        message: `sizes must contain between 1 and ${MAX_SIZES_PER_PRODUCT} items`
      });
    }

    const sizeIds = new Set();
    const sizes = product.sizes.map((sizeItem, sizeIndex) => {
      const size = sizeItem?.size;
      const sizedesc = typeof sizeItem?.sizedesc === 'string'
        ? sizeItem.sizedesc.trim()
        : '';
      const grossWeightKg = finiteNumber(sizeItem?.grossWeightKg);

      if (!Number.isSafeInteger(size) || size <= 0) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'size',
          message: 'size must be a positive safe integer'
        });
      } else if (sizeIds.has(size)) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'size',
          message: 'size must be unique within the product'
        });
      } else {
        sizeIds.add(size);
      }
      if (!sizedesc || sizedesc.length > MAX_TEXT_LENGTH) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'sizedesc',
          message: `sizedesc is required and cannot exceed ${MAX_TEXT_LENGTH} characters`
        });
      }
      if (grossWeightKg === null || grossWeightKg <= 0) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'grossWeightKg',
          message: 'grossWeightKg must be a positive number'
        });
      }

      return { size, sizedesc, grossWeightKg };
    });

    return { productId, name, sizes };
  });

  const calculatedSortedWeight = products.reduce(
    (productTotal, product) => productTotal + product.sizes.reduce(
      (sizeTotal, size) => sizeTotal + (size.grossWeightKg || 0),
      0
    ),
    0
  );
  if (totalSortedWeightKg !== null &&
      Math.abs(calculatedSortedWeight - totalSortedWeightKg) > 0.01) {
    errors.push({
      field: 'totalSortedWeightKg',
      message: 'totalSortedWeightKg must equal the sum of all size weights'
    });
  }
  if (totalPurchasedWeightKg !== null && totalSortedWeightKg !== null &&
      sortingDifferenceKg !== null &&
      Math.abs(
        totalPurchasedWeightKg - totalSortedWeightKg - sortingDifferenceKg
      ) > 0.01) {
    errors.push({
      field: 'sortingDifferenceKg',
      message: 'sortingDifferenceKg must equal purchased weight minus sorted weight'
    });
  }

  return {
    errors,
    sorting: {
      purchaseDate,
      purchaseNumber,
      status,
      products,
      totalPurchasedWeightKg,
      totalSortedWeightKg,
      sortingDifferenceKg,
      notes
    }
  };
}

module.exports = { validateCreateSortingPayload };
