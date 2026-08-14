'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTenantProvisioningConsumer,
  parseTenantOnboardingMessage
} = require('../src/tenantProvisioningConsumer');
const { createApp } = require('../src/app');

function envelope(payload) {
  return {
    message: {
      messageId: 'message-1',
      data: Buffer.from(JSON.stringify(payload)).toString('base64')
    }
  };
}

test('parses a lossless numeric tenant onboarding message', () => {
  const body = {
    message: {
      data: Buffer.from('{"orgid":43423423408878724}').toString('base64')
    }
  };
  assert.deepEqual(parseTenantOnboardingMessage(body), {
    orgid: '43423423408878724'
  });
  assert.equal(parseTenantOnboardingMessage(envelope({ orgid: 'bad-id' })), null);
});

test('delegates tenant provisioning to the migration runner', async () => {
  const pool = { name: 'pool' };
  const calls = [];
  const consumer = createTenantProvisioningConsumer(pool, async (...args) => {
    calls.push(args);
    return { orgid: args[1], applied: [{ version: 1 }], alreadyCurrent: false };
  });

  const result = await consumer.process({ orgid: '767524024827355' });
  assert.equal(calls[0][0], pool);
  assert.equal(calls[0][1], '767524024827355');
  assert.equal(result.applied[0].version, 1);
});

test('customer-onboarded endpoint provisions and acknowledges the tenant', async () => {
  const customerService = { getCustomers: async () => ({ customers: [] }) };
  const consumer = {
    parseMessage: parseTenantOnboardingMessage,
    process: async ({ orgid }) => ({ orgid, applied: [], alreadyCurrent: true })
  };
  const app = createApp(
    customerService, null, null, null, null, null, null, null,
    null, null, null, null, consumer
  );
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/pubsub/customer-onboarded`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope({ orgid: '767524024827355' }))
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'processed',
      orgid: '767524024827355',
      applied: [],
      alreadyCurrent: true
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
