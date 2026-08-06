'use strict';

const { parseDate } = require('./pubsub');

const MAX_PRODUCTS = 500;
const MAX_NOTES_LENGTH = 2000;
const MAX_PRODUCT_TEXT_LENGTH = 200;

function numericValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function validateCreatePurchasePayload(body) {
  const errors = [];
  const purchaseDate = parseDate(body?.purchaseDate);
  const totalCost = numericValue(body?.totalCost);
  const currency = typeof body?.currency === 'string'
    ? body.currency.trim().toUpperCase()
    : '';
  const notes = body?.notes === undefined || body?.notes === null
    ? null
    : typeof body.notes === 'string' ? body.notes.trim() : null;

  if (!purchaseDate) {
    errors.push({
      field: 'purchaseDate',
      message: 'purchaseDate is required and must be a valid YYYY-MM-DD date'
    });
  }
  if (totalCost === null || totalCost < 0) {
    errors.push({
      field: 'totalCost',
      message: 'totalCost is required and must be a non-negative number'
    });
  } else if (Number(totalCost.toFixed(2)) !== totalCost) {
    errors.push({
      field: 'totalCost',
      message: 'totalCost cannot have more than two decimal places'
    });
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    errors.push({
      field: 'currency',
      message: 'currency is required and must be a three-letter code'
    });
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
    return { errors, purchase: null };
  }
  if (body.products.length === 0) {
    errors.push({
      field: 'products',
      message: 'products must contain at least one item'
    });
  }
  if (body.products.length > MAX_PRODUCTS) {
    errors.push({
      field: 'products',
      message: `products cannot contain more than ${MAX_PRODUCTS} items`
    });
  }

  const seenProductIds = new Set();
  const products = body.products.map((product, index) => {
    const productId = product?.productId;
    const name = typeof product?.name === 'string' ? product.name.trim() : '';
    const size = product?.size;
    const hasSize = size !== undefined && size !== null;
    const hasSizeDescription = product?.sizedesc !== undefined &&
      product?.sizedesc !== null;
    const sizeDescription = typeof product?.sizedesc === 'string'
      ? product.sizedesc.trim()
      : '';
    const unitPrice = numericValue(product?.unitprice);
    const grossWeightKg = numericValue(product?.grossWeightKg);

    if (!Number.isSafeInteger(productId) || productId <= 0) {
      errors.push({
        index,
        field: 'productId',
        message: 'productId must be a positive safe integer'
      });
    } else if (seenProductIds.has(productId)) {
      errors.push({
        index,
        field: 'productId',
        message: 'productId must be unique within the purchase'
      });
    } else {
      seenProductIds.add(productId);
    }

    if (!name || name.length > MAX_PRODUCT_TEXT_LENGTH) {
      errors.push({
        index,
        field: 'name',
        message: `name is required and cannot exceed ${MAX_PRODUCT_TEXT_LENGTH} characters`
      });
    }
    if (hasSize && (!Number.isSafeInteger(size) || size <= 0)) {
      errors.push({
        index,
        field: 'size',
        message: 'size must be a positive safe integer'
      });
    } else if (!hasSize && hasSizeDescription) {
      errors.push({
        index,
        field: 'size',
        message: 'size is required when sizedesc is provided'
      });
    }
    if (hasSize &&
        (!sizeDescription || sizeDescription.length > MAX_PRODUCT_TEXT_LENGTH)) {
      errors.push({
        index,
        field: 'sizedesc',
        message: `sizedesc is required with size and cannot exceed ${MAX_PRODUCT_TEXT_LENGTH} characters`
      });
    } else if (!hasSize && hasSizeDescription && !sizeDescription) {
      errors.push({
        index,
        field: 'sizedesc',
        message: 'sizedesc cannot be blank when provided'
      });
    }
    if (unitPrice === null || unitPrice < 0) {
      errors.push({
        index,
        field: 'unitprice',
        message: 'unitprice must be a non-negative number'
      });
    } else if (Number(unitPrice.toFixed(2)) !== unitPrice) {
      errors.push({
        index,
        field: 'unitprice',
        message: 'unitprice cannot have more than two decimal places'
      });
    }

    if (grossWeightKg === null || grossWeightKg <= 0) {
      errors.push({
        index,
        field: 'grossWeightKg',
        message: 'grossWeightKg must be a positive number'
      });
    }

    return {
      productId,
      name,
      size: hasSize ? size : null,
      sizedesc: hasSizeDescription ? sizeDescription : null,
      unitprice: unitPrice,
      grossWeightKg
    };
  });

  return {
    errors,
    purchase: {
      purchaseDate,
      totalCost,
      currency,
      products,
      notes
    }
  };
}

module.exports = { MAX_PRODUCTS, validateCreatePurchasePayload };
