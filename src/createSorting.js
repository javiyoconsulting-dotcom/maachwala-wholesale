'use strict';

function validateCreateSortingPayload(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body)
    ? body
    : {};
  const { orgid: _orgid, ...sorting } = source;
  return { errors: [], sorting };
}

module.exports = { validateCreateSortingPayload };
