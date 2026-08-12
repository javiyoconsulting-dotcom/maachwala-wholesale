'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { openapiDocument } = require('../src/openapi');

test('OpenAPI document lists every active canonical endpoint', () => {
  const requiredPaths = [
    '/health', '/wholesale/customers', '/wholesale/createcustomers',
    '/wholesale/createpurchases', '/wholesale/getpurchases/sorting',
    '/wholesale/getpurchaselistbystatus',
    '/wholesale/createsorting', '/wholesale/notdistributed',
    '/wholesale/creategroup', '/wholesale/getgroups',
    '/wholesale/updategroup', '/wholesale/buyerallocation',
    '/wholesale/sellresponse', '/wholesale/updatepurchaseresponse',
    '/wholesale/notsettledtransactions',
    '/wholesale/getsales', '/wholesale/salesummary',
    '/wholesale/updatesalesummary',
    '/wholesale/getdiscountmaster', '/wholesale/getcreditedcustomers',
    '/wholesale/updatecustomerpayment',
    '/pubsub/wholesale-create-sale-purchase',
    '/pubsub/buyer-allocation-distribution', '/pubsub/post-sales-data',
    '/pubsub/post-sales-data-customer'
    , '/pubsub/update-purchase-sales-response'
  ];
  for (const path of requiredPaths) assert.ok(openapiDocument.paths[path], path);
});

test('serves OpenAPI JSON and Swagger UI', async (t) => {
  const app = createApp(null);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const specResponse = await fetch(`${baseUrl}/openapi.json`);
  assert.equal(specResponse.status, 200);
  assert.equal((await specResponse.json()).openapi, '3.0.3');

  const docsResponse = await fetch(`${baseUrl}/api-docs/`);
  assert.equal(docsResponse.status, 200);
  assert.match(await docsResponse.text(), /MaachWala Wholesale API/);
});
