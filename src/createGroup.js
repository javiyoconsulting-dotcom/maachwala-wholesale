'use strict';

const MAX_ASSOCIATES = 500;
const MAX_NAME_LENGTH = 200;

function normalizePhone(value) {
  if (typeof value === 'string') return value.trim();
  if (Number.isSafeInteger(value)) return String(value);
  return '';
}

function validateCreateGroupPayload(body) {
  const errors = [];
  const name = typeof body?.name === 'string' ? body.name.trim() : '';

  if (!name || name.length > MAX_NAME_LENGTH) {
    errors.push({
      field: 'name',
      message: `name is required and cannot exceed ${MAX_NAME_LENGTH} characters`
    });
  }
  if (!Array.isArray(body?.associates)) {
    errors.push({
      field: 'associates',
      message: 'associates is required and must be an array'
    });
    return { errors, group: null };
  }
  if (body.associates.length === 0 ||
      body.associates.length > MAX_ASSOCIATES) {
    errors.push({
      field: 'associates',
      message: `associates must contain between 1 and ${MAX_ASSOCIATES} items`
    });
  }

  const phones = new Set();
  const associates = body.associates.map((associate, index) => {
    const associateName = typeof associate?.name === 'string'
      ? associate.name.trim()
      : '';
    const phone = normalizePhone(associate?.phone);

    if (!associateName || associateName.length > MAX_NAME_LENGTH) {
      errors.push({
        index,
        field: 'name',
        message: `name is required and cannot exceed ${MAX_NAME_LENGTH} characters`
      });
    }
    if (!/^\d{6,15}$/.test(phone)) {
      errors.push({
        index,
        field: 'phone',
        message: 'phone must contain 6 to 15 digits'
      });
    } else if (phones.has(phone)) {
      errors.push({
        index,
        field: 'phone',
        message: 'phone must be unique within the group'
      });
    } else {
      phones.add(phone);
    }

    return { name: associateName, phone };
  });

  return { errors, group: { name, associates } };
}

module.exports = { MAX_ASSOCIATES, validateCreateGroupPayload };
