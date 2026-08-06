'use strict';

const { parseDate } = require('./pubsub');

const MAX_PRODUCTS = 500;
const MAX_SIZES = 100;
const MAX_BUYERS = 500;
const MAX_TEXT_LENGTH = 200;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizePhone(value) {
  if (typeof value === 'string') return value.trim();
  if (Number.isSafeInteger(value)) return String(value);
  return '';
}

function validateSendToBuyerPayload(body) {
  const errors = [];
  const purchaseDate = parseDate(body?.purchaseDate);
  if (!purchaseDate) {
    errors.push({
      field: 'purchaseDate',
      message: 'purchaseDate is required and must be a valid YYYY-MM-DD date'
    });
  }
  if (!Array.isArray(body?.products)) {
    errors.push({
      field: 'products',
      message: 'products is required and must be an array'
    });
    return { errors, payload: null };
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
    const productName = typeof product?.productName === 'string'
      ? product.productName.trim()
      : '';
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
        message: 'productId must be unique within the request'
      });
    } else {
      productIds.add(productId);
    }
    if (!productName || productName.length > MAX_TEXT_LENGTH) {
      errors.push({
        productIndex,
        field: 'productName',
        message: `productName is required and cannot exceed ${MAX_TEXT_LENGTH} characters`
      });
    }

    if (!Array.isArray(product?.sizes)) {
      errors.push({
        productIndex,
        field: 'sizes',
        message: 'sizes is required and must be an array'
      });
      return { productId, productName, sizes: [] };
    }
    if (product.sizes.length === 0 || product.sizes.length > MAX_SIZES) {
      errors.push({
        productIndex,
        field: 'sizes',
        message: `sizes must contain between 1 and ${MAX_SIZES} items`
      });
    }

    const sizeIds = new Set();
    const sizes = product.sizes.map((sizeItem, sizeIndex) => {
      const sortingNumber = sizeItem?.sortingNumber;
      const sizeId = sizeItem?.sizeId;
      const sizeDescription = typeof sizeItem?.sizeDescription === 'string'
        ? sizeItem.sizeDescription.trim()
        : '';
      const grossWeightKg = finiteNumber(sizeItem?.grossWeightKg);
      const allocatedWeightKg = finiteNumber(sizeItem?.allocatedWeightKg);

      if (!Number.isSafeInteger(sortingNumber) || sortingNumber <= 0) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'sortingNumber',
          message: 'sortingNumber is required and must be a positive safe integer'
        });
      }

      if (!Number.isSafeInteger(sizeId) || sizeId <= 0) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'sizeId',
          message: 'sizeId must be a positive safe integer'
        });
      } else if (sizeIds.has(sizeId)) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'sizeId',
          message: 'sizeId must be unique within the product'
        });
      } else {
        sizeIds.add(sizeId);
      }
      if (!sizeDescription || sizeDescription.length > MAX_TEXT_LENGTH) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'sizeDescription',
          message: `sizeDescription is required and cannot exceed ${MAX_TEXT_LENGTH} characters`
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
      if (allocatedWeightKg === null || allocatedWeightKg < 0) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'allocatedWeightKg',
          message: 'allocatedWeightKg must be a non-negative number'
        });
      } else if (grossWeightKg !== null && allocatedWeightKg > grossWeightKg) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'allocatedWeightKg',
          message: 'allocatedWeightKg cannot exceed grossWeightKg'
        });
      }

      if (!Array.isArray(sizeItem?.buyers)) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'buyers',
          message: 'buyers is required and must be an array'
        });
        return {
          sortingNumber,
          sizeId,
          sizeDescription,
          grossWeightKg,
          allocatedWeightKg,
          buyers: []
        };
      }
      if (sizeItem.buyers.length === 0 || sizeItem.buyers.length > MAX_BUYERS) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'buyers',
          message: `buyers must contain between 1 and ${MAX_BUYERS} items`
        });
      }

      const buyerPhones = new Set();
      const buyers = sizeItem.buyers.map((buyer, buyerIndex) => {
        const name = typeof buyer?.name === 'string' ? buyer.name.trim() : '';
        const phone = normalizePhone(buyer?.phone);
        const weightKg = finiteNumber(buyer?.weightKg);
        const minimumPrice = finiteNumber(buyer?.minimumPrice);
        const maximumPrice = finiteNumber(buyer?.maximumPrice);

        if (!name || name.length > MAX_TEXT_LENGTH) {
          errors.push({
            productIndex,
            sizeIndex,
            buyerIndex,
            field: 'name',
            message: `name is required and cannot exceed ${MAX_TEXT_LENGTH} characters`
          });
        }
        if (!/^\d{6,15}$/.test(phone)) {
          errors.push({
            productIndex,
            sizeIndex,
            buyerIndex,
            field: 'phone',
            message: 'phone must contain 6 to 15 digits'
          });
        } else if (buyerPhones.has(phone)) {
          errors.push({
            productIndex,
            sizeIndex,
            buyerIndex,
            field: 'phone',
            message: 'phone must be unique within the size allocation'
          });
        } else {
          buyerPhones.add(phone);
        }
        if (weightKg === null || weightKg <= 0) {
          errors.push({
            productIndex,
            sizeIndex,
            buyerIndex,
            field: 'weightKg',
            message: 'weightKg must be a positive number'
          });
        }
        if (minimumPrice === null || minimumPrice < 0) {
          errors.push({
            productIndex,
            sizeIndex,
            buyerIndex,
            field: 'minimumPrice',
            message: 'minimumPrice must be a non-negative number'
          });
        }
        if (maximumPrice === null || maximumPrice < 0) {
          errors.push({
            productIndex,
            sizeIndex,
            buyerIndex,
            field: 'maximumPrice',
            message: 'maximumPrice must be a non-negative number'
          });
        } else if (minimumPrice !== null && maximumPrice < minimumPrice) {
          errors.push({
            productIndex,
            sizeIndex,
            buyerIndex,
            field: 'maximumPrice',
            message: 'maximumPrice cannot be less than minimumPrice'
          });
        }

        return {
          name,
          phone,
          weightKg,
          minimumPrice,
          maximumPrice
        };
      });

      const buyerWeight = buyers.reduce(
        (total, buyer) => total + (buyer.weightKg || 0),
        0
      );
      if (allocatedWeightKg !== null &&
          Math.abs(buyerWeight - allocatedWeightKg) > 0.01) {
        errors.push({
          productIndex,
          sizeIndex,
          field: 'allocatedWeightKg',
          message: 'allocatedWeightKg must equal the sum of buyer weights'
        });
      }

      return {
        sortingNumber,
        sizeId,
        sizeDescription,
        grossWeightKg,
        allocatedWeightKg,
        buyers
      };
    });

    return { productId, productName, sizes };
  });

  return { errors, payload: { purchaseDate, products } };
}

module.exports = { validateSendToBuyerPayload };
