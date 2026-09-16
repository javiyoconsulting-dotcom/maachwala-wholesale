'use strict';

const MAX_BATCH_SIZE = 500;
const MAX_NAME_LENGTH = 200;

function validateCreateCustomersPayload(body) {
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

  if (!Array.isArray(body?.customers)) {
    errors.push({
      field: 'customers',
      message: 'customers is required and must be an array'
    });
    return { errors, orgid, customers: [] };
  }

  if (body.customers.length === 0) {
    errors.push({
      field: 'customers',
      message: 'customers must contain at least one item'
    });
  }

  if (body.customers.length > MAX_BATCH_SIZE) {
    errors.push({
      field: 'customers',
      message: `customers cannot contain more than ${MAX_BATCH_SIZE} items`
    });
  }

  const customers = body.customers.map((customer, index) => {
    const name = typeof customer?.name === 'string' ? customer.name.trim() : '';
    let phone = null;
    let suppliedPhone = '';
    if (typeof customer?.phone === 'string') {
      suppliedPhone = customer.phone.trim();
    } else if (Number.isSafeInteger(customer?.phone)) {
      suppliedPhone = String(customer.phone);
    } else if (customer?.phone !== undefined && customer?.phone !== null) {
      suppliedPhone = '__invalid__';
    }

    if (!name) {
      errors.push({
        index,
        field: 'name',
        message: 'name is required'
      });
    } else if (name.length > MAX_NAME_LENGTH) {
      errors.push({
        index,
        field: 'name',
        message: `name cannot exceed ${MAX_NAME_LENGTH} characters`
      });
    }

    if (suppliedPhone && !/^\d{6,15}$/.test(suppliedPhone)) {
      errors.push({
        index,
        field: 'phone',
        message: 'phone must contain 6 to 15 digits when supplied'
      });
    } else if (suppliedPhone) {
      phone = Number(suppliedPhone);
    }

    return { name, phone };
  });

  return { errors, orgid, customers };
}

module.exports = {
  MAX_BATCH_SIZE,
  validateCreateCustomersPayload
};
