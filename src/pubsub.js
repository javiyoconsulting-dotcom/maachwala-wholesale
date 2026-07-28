'use strict';

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function parseSalesMessage(body) {
  let payload = body;

  // Google Pub/Sub push subscriptions wrap JSON in message.data as base64.
  if (body?.message?.data) {
    try {
      payload = JSON.parse(
        Buffer.from(body.message.data, 'base64').toString('utf8')
      );
    } catch {
      return null;
    }
  }

  if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'orgid')) {
    return null;
  }

  const orgid = String(payload.orgid);
  const date = parseDate(payload.date);
  if (!/^\d+$/.test(orgid) || !date) return null;

  return { orgid, date };
}

module.exports = { parseDate, parseSalesMessage };
