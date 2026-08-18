'use strict';

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateUpdateSalesResponsePayload(body) {
  const errors = [];
  const orgid = String(body?.orgid ?? '').trim();
  const sortingnumber = String(body?.sortingnumber ?? '').trim();
  const buyerunitprice = finiteNumber(body?.buyerunitprice);
  const buyerquantity = finiteNumber(body?.buyerquantity);
  const buyerweightdiscount = finiteNumber(body?.buyerweightdiscount);

  if (!/^\d+$/.test(orgid) ||
      (typeof body?.orgid === 'number' && !Number.isSafeInteger(body.orgid))) {
    errors.push({
      field: 'orgid',
      message: 'orgid must be a digit string or a safe integer'
    });
  }
  if (!/^\d+$/.test(sortingnumber) || sortingnumber === '0' ||
      (typeof body?.sortingnumber === 'number' &&
       !Number.isSafeInteger(body.sortingnumber))) {
    errors.push({
      field: 'sortingnumber',
      message: 'sortingnumber must be a positive digit string or safe integer'
    });
  }
  if (buyerunitprice === null || buyerunitprice < 0) {
    errors.push({
      field: 'buyerunitprice',
      message: 'buyerunitprice must be zero or greater'
    });
  }
  if (buyerquantity === null || buyerquantity < 0) {
    errors.push({
      field: 'buyerquantity',
      message: 'buyerquantity must be zero or greater'
    });
  }
  if (buyerweightdiscount === null || buyerweightdiscount < 0) {
    errors.push({
      field: 'buyerweightdiscount',
      message: 'buyerweightdiscount must be zero or greater'
    });
  }

  return {
    errors,
    payload: errors.length === 0
      ? {
          orgid,
          sortingnumber,
          buyerunitprice,
          buyerquantity,
          buyerweightdiscount
        }
      : null
  };
}

module.exports = { validateUpdateSalesResponsePayload };
