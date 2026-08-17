'use strict';

const MAX_SUPPLIER_BATCH_SIZE = 500;
const MAX_SUPPLIER_NAME_LENGTH = 200;

function validateCreateSuppliersPayload(body) {
  const errors = [];
  const orgid = body && Object.prototype.hasOwnProperty.call(body, 'orgid')
    ? String(body.orgid)
    : '';

  if (!/^\d+$/.test(orgid)) {
    errors.push({
      field: 'orgid',
      message: 'orgid is required and must contain digits only'
    });
  }

  if (!Array.isArray(body?.suppliers)) {
    errors.push({
      field: 'suppliers',
      message: 'suppliers is required and must be an array'
    });
    return { errors, orgid, suppliers: [] };
  }

  if (body.suppliers.length === 0) {
    errors.push({
      field: 'suppliers',
      message: 'suppliers must contain at least one item'
    });
  }
  if (body.suppliers.length > MAX_SUPPLIER_BATCH_SIZE) {
    errors.push({
      field: 'suppliers',
      message: `suppliers cannot contain more than ${MAX_SUPPLIER_BATCH_SIZE} items`
    });
  }

  const seenPhones = new Set();
  const suppliers = body.suppliers.map((supplier, index) => {
    const name = typeof supplier?.name === 'string' ? supplier.name.trim() : '';
    let phone = '';
    if (typeof supplier?.phone === 'string') {
      phone = supplier.phone.trim();
    } else if (Number.isSafeInteger(supplier?.phone)) {
      phone = String(supplier.phone);
    }

    if (!name) {
      errors.push({ index, field: 'name', message: 'name is required' });
    } else if (name.length > MAX_SUPPLIER_NAME_LENGTH) {
      errors.push({
        index,
        field: 'name',
        message: `name cannot exceed ${MAX_SUPPLIER_NAME_LENGTH} characters`
      });
    }

    if (!/^\d{6,15}$/.test(phone)) {
      errors.push({
        index,
        field: 'phone',
        message: 'phone must contain 6 to 15 digits'
      });
    } else if (seenPhones.has(phone)) {
      errors.push({
        index,
        field: 'phone',
        message: 'phone must be unique within the request'
      });
    } else {
      seenPhones.add(phone);
    }

    return { name, phone };
  });

  return { errors, orgid, suppliers };
}

module.exports = {
  MAX_SUPPLIER_BATCH_SIZE,
  validateCreateSuppliersPayload
};
