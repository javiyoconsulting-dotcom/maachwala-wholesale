'use strict';

const JSONbig = require('json-bigint')({ storeAsString: true });

function parseTenantOnboardingMessage(body) {
  if (!body?.message?.data) return null;

  let payload;
  try {
    payload = JSONbig.parse(
      Buffer.from(body.message.data, 'base64').toString('utf8')
    );
  } catch {
    return null;
  }

  const orgid = String(
    payload?.orgid ?? body.message.attributes?.orgid ?? ''
  ).trim();
  return /^\d+$/.test(orgid) ? { orgid } : null;
}

function createTenantProvisioningConsumer(pool, migrateTenant) {
  return {
    parseMessage: parseTenantOnboardingMessage,
    process: ({ orgid }) => migrateTenant(pool, orgid)
  };
}

module.exports = {
  createTenantProvisioningConsumer,
  parseTenantOnboardingMessage
};
