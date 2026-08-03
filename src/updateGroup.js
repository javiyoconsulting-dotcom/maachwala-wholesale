'use strict';

const { MAX_ASSOCIATES } = require('./createGroup');

const MAX_NAME_LENGTH = 200;

function normalizePhone(value) {
  if (typeof value === 'string') return value.trim();
  if (Number.isSafeInteger(value)) return String(value);
  return '';
}

function validateUpdateGroupPayload(body) {
  const errors = [];
  const groupNumber = body?.groupNumber;

  if (!Number.isSafeInteger(groupNumber) || groupNumber < 1000) {
    errors.push({
      field: 'groupNumber',
      message: 'groupNumber is required and must be an integer of at least 1000'
    });
  }
  if (!Array.isArray(body?.data)) {
    errors.push({
      field: 'data',
      message: 'data is required and must be an array'
    });
    return { errors, update: null };
  }
  if (body.data.length === 0 || body.data.length > MAX_ASSOCIATES) {
    errors.push({
      field: 'data',
      message: `data must contain between 1 and ${MAX_ASSOCIATES} items`
    });
  }

  const phones = new Set();
  const associates = body.data.map((associate, index) => {
    const name = typeof associate?.name === 'string'
      ? associate.name.trim()
      : '';
    const phone = normalizePhone(associate?.phone);
    const isnew = associate?.isnew;

    if (!name || name.length > MAX_NAME_LENGTH) {
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
        message: 'phone must be unique within the update request'
      });
    } else {
      phones.add(phone);
    }
    if (typeof isnew !== 'boolean') {
      errors.push({
        index,
        field: 'isnew',
        message: 'isnew is required and must be true or false'
      });
    }

    return { phone, name, isnew };
  });

  return { errors, update: { groupNumber, associates } };
}

module.exports = { validateUpdateGroupPayload };
