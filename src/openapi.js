'use strict';

const jsonContent = (schema, example) => ({
  'application/json': { schema, ...(example ? { example } : {}) }
});

const errorResponses = {
  400: { description: 'Invalid request JSON or validation failure' },
  404: { description: 'Organization resource or matching record not found' },
  500: { description: 'Unexpected service error' },
  503: { description: 'Database, Pub/Sub, or service dependency unavailable' }
};

function postOperation(summary, tag, requestSchema, options = {}) {
  return {
    summary,
    tags: [tag],
    operationId: options.operationId,
    requestBody: {
      required: true,
      content: jsonContent(requestSchema, options.example)
    },
    responses: {
      [options.successStatus || 200]: {
        description: options.successDescription || 'Successful response',
        content: options.responseSchema
          ? jsonContent(options.responseSchema, options.responseExample)
          : undefined
      },
      ...errorResponses
    }
  };
}

const orgRequest = {
  type: 'object', required: ['orgid'],
  properties: { orgid: { $ref: '#/components/schemas/OrgId' } }
};
const datedOrgRequest = {
  type: 'object', required: ['orgid', 'salesDate'],
  properties: {
    orgid: { $ref: '#/components/schemas/OrgId' },
    salesDate: { type: 'string', format: 'date', example: '2026-08-10' }
  }
};
const jsonArray = { type: 'array', items: { type: 'object', additionalProperties: true } };
const jsonObject = { type: 'object', additionalProperties: true };

const openapiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'MaachWala Wholesale Service API',
    version: '1.0.0',
    description: 'Wholesale customer, purchase, sorting, allocation, sales, payment, and Pub/Sub APIs.'
  },
  servers: [{
    url: 'https://maachwala-wholesale-972943436476.asia-south1.run.app',
    description: 'Production Cloud Run'
  }],
  tags: [
    { name: 'System' }, { name: 'Customers' }, { name: 'Purchases' },
    { name: 'Sorting' }, { name: 'Groups' }, { name: 'Allocations' },
    { name: 'Sales' }, { name: 'Payments' }, { name: 'Master Data' },
    { name: 'Pub/Sub Consumers' }
  ],
  paths: {
    '/health': {
      get: { summary: 'Service health check', tags: ['System'], responses: { 200: { description: 'Service is healthy' } } }
    },
    '/wholesale/customers': {
      post: postOperation('Get customers (cached)', 'Customers', orgRequest, { responseSchema: jsonArray })
    },
    '/wholesale/customers/refresh': {
      post: postOperation('Refresh and return the customer cache', 'Customers', orgRequest, { responseSchema: jsonArray })
    },
    '/wholesale/createcustomers': {
      post: postOperation('Create customers in a batch', 'Customers', { $ref: '#/components/schemas/CreateCustomersRequest' }, { successStatus: 201, responseSchema: jsonObject })
    },
    '/wholesale/createpurchases': {
      post: postOperation('Create a purchase', 'Purchases', { $ref: '#/components/schemas/CreatePurchaseRequest' }, { successStatus: 201, responseSchema: jsonObject })
    },
    '/wholesale/getpurchases/sorting': {
      post: postOperation('Get purchases awaiting sorting', 'Purchases', orgRequest, { responseSchema: jsonArray })
    },
    '/wholesale/getpurchaselistbystatus': {
      post: postOperation('Get purchases and source organizations by status', 'Purchases', { $ref: '#/components/schemas/GetPurchasesByStatusRequest' }, { responseSchema: { type: 'array', items: { $ref: '#/components/schemas/PurchaseByStatus' } } })
    },
    '/wholesale/createsorting': {
      post: postOperation('Create sorting rows for a purchase', 'Sorting', { $ref: '#/components/schemas/CreateSortingRequest' }, { responseSchema: jsonObject })
    },
    '/wholesale/notdistributed': {
      post: postOperation('Get incomplete sorting allocations', 'Sorting', orgRequest, { responseSchema: jsonArray })
    },
    '/wholesale/creategroup': {
      post: postOperation('Create a business-associate group', 'Groups', { $ref: '#/components/schemas/CreateGroupRequest' }, { successStatus: 201, responseSchema: jsonObject })
    },
    '/wholesale/getgroups': {
      post: postOperation('Get all business-associate groups', 'Groups', orgRequest, { responseSchema: jsonArray })
    },
    '/wholesale/updategroup': {
      post: postOperation('Add or update group associates', 'Groups', { $ref: '#/components/schemas/UpdateGroupRequest' }, { responseSchema: jsonObject })
    },
    '/wholesale/buyerallocation': {
      post: postOperation('Publish buyer allocations', 'Allocations', { $ref: '#/components/schemas/BuyerAllocationRequest' }, { successStatus: 202, responseSchema: jsonObject })
    },
    '/wholesale/sellresponse': {
      post: postOperation('Get buyer allocations by purchase date', 'Allocations', datedOrgRequest, { responseSchema: jsonArray })
    },
    '/wholesale/updatepurchaseresponse': {
      post: postOperation('Publish a purchase sales response', 'Purchases', { $ref: '#/components/schemas/UpdatePurchaseResponseRequest' }, { successStatus: 202, responseSchema: jsonObject })
    },
    '/wholesale/getsales': {
      post: postOperation('Get sales data with calculated weights and totals', 'Sales', datedOrgRequest, { responseSchema: jsonArray })
    },
    '/wholesale/salesummary': {
      post: postOperation('Get a sales summary by date', 'Sales', datedOrgRequest, { responseSchema: jsonObject })
    },
    '/wholesale/updatesalesummary': {
      post: postOperation('Replace a sales summary by date', 'Sales', { $ref: '#/components/schemas/UpdateSalesSummaryRequest' }, { responseSchema: jsonObject })
    },
    '/wholesale/getdiscountmaster': {
      post: postOperation('Get discount master rows', 'Master Data', orgRequest, { responseSchema: jsonArray })
    },
    '/wholesale/getcreditedcustomers': {
      post: postOperation('Get customers with an outstanding credit balance', 'Payments', orgRequest, { responseSchema: { type: 'array', items: { $ref: '#/components/schemas/CreditedCustomer' } } })
    },
    '/wholesale/updatecustomerpayment': {
      post: postOperation('Record a customer payment', 'Payments', { $ref: '#/components/schemas/UpdateCustomerPaymentRequest' }, { responseSchema: jsonObject })
    },
    '/pubsub/wholesale-create-sale-purchase': {
      post: postOperation('Consume wholesale buyer allocations', 'Pub/Sub Consumers', { $ref: '#/components/schemas/PubSubEnvelope' }, { responseSchema: jsonObject })
    },
    '/pubsub/buyer-allocation-distribution': {
      post: postOperation('Distribute allocations to onboarded buyers', 'Pub/Sub Consumers', { $ref: '#/components/schemas/PubSubEnvelope' }, { responseSchema: jsonObject })
    },
    '/pubsub/post-sales-data': {
      post: postOperation('Build sales summary and buy data', 'Pub/Sub Consumers', { $ref: '#/components/schemas/PubSubEnvelope' }, { responseSchema: jsonObject })
    },
    '/pubsub/post-sales-data-customer': {
      post: postOperation('Update customer credit and debit ledgers', 'Pub/Sub Consumers', { $ref: '#/components/schemas/PubSubEnvelope' }, { responseSchema: jsonObject })
    },
    '/pubsub/update-purchase-sales-response': {
      post: postOperation('Apply buyer purchase response to purchase and allocation rows', 'Pub/Sub Consumers', { $ref: '#/components/schemas/PubSubEnvelope' }, { responseSchema: jsonObject })
    }
  },
  components: {
    schemas: {
      OrgId: { oneOf: [{ type: 'integer', format: 'int64' }, { type: 'string', pattern: '^\\d+$' }], example: 767524024827354 },
      Associate: { type: 'object', required: ['name', 'phone'], properties: { name: { type: 'string' }, phone: { oneOf: [{ type: 'string' }, { type: 'integer' }] } } },
      CreateCustomersRequest: { type: 'object', required: ['orgid', 'customers'], properties: { orgid: { $ref: '#/components/schemas/OrgId' }, customers: { type: 'array', items: { $ref: '#/components/schemas/Associate' } } } },
      PurchaseProduct: { type: 'object', required: ['productId', 'name', 'grossWeightKg'], properties: { productId: { type: 'integer' }, name: { type: 'string' }, size: { type: 'integer', nullable: true }, sizedesc: { type: 'string', nullable: true }, unitprice: { type: 'number' }, grossWeightKg: { type: 'number' } } },
      CreatePurchaseRequest: { type: 'object', required: ['orgid', 'purchaseDate', 'totalCost', 'products'], properties: { orgid: { $ref: '#/components/schemas/OrgId' }, purchaseDate: { type: 'string', format: 'date' }, totalCost: { type: 'number' }, currency: { type: 'string', example: 'INR' }, products: { type: 'array', items: { $ref: '#/components/schemas/PurchaseProduct' } }, notes: { type: 'string' } } },
      GetPurchasesByStatusRequest: { type: 'object', required: ['orgid', 'statuscode'], properties: { orgid: { $ref: '#/components/schemas/OrgId' }, statuscode: { type: 'integer', minimum: 0, example: 1003 } } },
      PurchaseByStatus: { type: 'object', properties: { purchaseNumber: { oneOf: [{ type: 'string' }, { type: 'number' }], nullable: true }, date: { type: 'string', format: 'date', nullable: true }, statusCode: { type: 'integer' }, productName: { type: 'string' }, productId: { oneOf: [{ type: 'string' }, { type: 'number' }], nullable: true }, sizeDesc: { type: 'string' }, sizeId: { oneOf: [{ type: 'string' }, { type: 'number' }], nullable: true }, maxPrice: { type: 'number', nullable: true }, minPrice: { type: 'number', nullable: true }, grossWeightWithKg: { type: 'number', nullable: true }, orgnisationNumber: { oneOf: [{ type: 'string' }, { type: 'number' }], nullable: true }, organisationName: { type: 'string' }, owner: { type: 'string' }, ownerphone: { oneOf: [{ type: 'string' }, { type: 'number' }], nullable: true } } },
      CreateSortingRequest: { type: 'object', required: ['orgid'], additionalProperties: true, properties: { orgid: { $ref: '#/components/schemas/OrgId' }, purchaseDate: { type: 'string', format: 'date' }, purchaseNumber: { type: 'integer', format: 'int64' }, products: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
      CreateGroupRequest: { type: 'object', required: ['orgid', 'name', 'associates'], properties: { orgid: { $ref: '#/components/schemas/OrgId' }, name: { type: 'string' }, associates: { type: 'array', items: { $ref: '#/components/schemas/Associate' } } } },
      UpdateGroupRequest: { type: 'object', required: ['orgid', 'number', 'data'], properties: { orgid: { $ref: '#/components/schemas/OrgId' }, number: { type: 'integer' }, data: { type: 'array', items: { allOf: [{ $ref: '#/components/schemas/Associate' }, { type: 'object', required: ['isnew'], properties: { isnew: { type: 'boolean' } } }] } } } },
      BuyerAllocationRequest: { type: 'object', required: ['orgid', 'purchaseDate', 'products'], additionalProperties: true, properties: { orgid: { $ref: '#/components/schemas/OrgId' }, purchaseDate: { type: 'string', format: 'date' }, products: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
      UpdatePurchaseResponseRequest: { type: 'object', required: ['purchaseNumber', 'quantity', 'weightDiscount', 'unitPrice', 'orgid'], properties: { purchaseNumber: { type: 'integer', format: 'int64', example: 1785542400001 }, quantity: { type: 'number', example: 475.5 }, weightDiscount: { type: 'number', example: 24.5 }, unitPrice: { type: 'number', example: 425.75 }, orgid: { type: 'string', pattern: '^\\d+$', example: '43423423408878724', description: 'Use a string when the organization ID exceeds JavaScript safe-integer precision.' } } },
      UpdateSalesSummaryRequest: { type: 'object', required: ['orgid', 'date', 'data'], properties: { orgid: { $ref: '#/components/schemas/OrgId' }, date: { type: 'string', format: 'date', example: '2026-08-10' }, data: { type: 'object', additionalProperties: true, properties: { date: { type: 'string', format: 'date' }, orgid: { $ref: '#/components/schemas/OrgId' }, groups: { type: 'array', items: { type: 'object', additionalProperties: true } }, groupCount: { type: 'integer' }, generatedAt: { type: 'string', format: 'date-time' }, discountWeight: { type: 'number' }, invalidRecords: { type: 'array', items: { type: 'object' } }, invalidRecordCount: { type: 'integer' } } } } },
      CreditedCustomer: { type: 'object', properties: { id: { type: 'string' }, customerid: { type: 'string' }, customerName: { type: 'string' }, totalCreditAmount: { type: 'number', nullable: true } } },
      UpdateCustomerPaymentRequest: { type: 'object', required: ['orgid', 'customerid', 'paymentAmount'], properties: { orgid: { $ref: '#/components/schemas/OrgId' }, customerid: { oneOf: [{ type: 'integer' }, { type: 'string' }] }, paymentAmount: { type: 'number', exclusiveMinimum: true, minimum: 0 } } },
      PubSubEnvelope: { type: 'object', required: ['message'], properties: { message: { type: 'object', required: ['data'], properties: { data: { type: 'string', format: 'byte', description: 'Base64-encoded JSON payload' }, messageId: { type: 'string' }, attributes: { type: 'object', additionalProperties: { type: 'string' } } } }, subscription: { type: 'string' } } }
    }
  }
};

module.exports = { openapiDocument };
