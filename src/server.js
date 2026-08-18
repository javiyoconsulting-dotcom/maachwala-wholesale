'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { createApp } = require('./app');
const { CustomerCache } = require('./cache');
const { createCustomerRepository } = require('./customerRepository');
const { createCustomerService } = require('./customerService');
const { buildSalesSummary } = require('./salesSummary');
const { createSalesSummaryRepository } = require('./salesSummaryRepository');
const { parseSalesMessage } = require('./pubsub');
const { buildCustomerPaymentUpdates } = require('./customerPaymentSummary');
const {
  createCustomerPaymentRepository
} = require('./customerPaymentRepository');
const { createPurchaseRepository } = require('./purchaseRepository');
const { buildNotDistributedPurchases } = require('./notDistributed');
const { createGroupRepository } = require('./groupRepository');
const { PubSub } = require('@google-cloud/pubsub');
const { createBuyerPublisher } = require('./buyerPublisher');
const {
  createBuyerAllocationConsumerService
} = require('./buyerAllocationConsumer');
const {
  createBuyerAllocationRepository
} = require('./buyerAllocationRepository');
const {
  createBuyerAllocationDistributionPublisher
} = require('./buyerAllocationDistributionPublisher');
const {
  createBuyerDistributionConsumerService
} = require('./buyerDistributionConsumer');
const {
  createBuyerDistributionRepository
} = require('./buyerDistributionRepository');
const { createDiscountRepository } = require('./discountRepository');
const {
  createPurchaseResponsePublisher
} = require('./purchaseResponsePublisher');
const {
  createPurchaseSalesResponseConsumerService
} = require('./purchaseSalesResponseConsumer');
const {
  createPurchaseSalesResponseRepository
} = require('./purchaseSalesResponseRepository');
const { migrateTenant } = require('../database/lib/migration-runner');
const {
  createTenantProvisioningConsumer
} = require('./tenantProvisioningConsumer');
const { createSupplierRepository } = require('./supplierRepository');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const port = Number(process.env.PORT || 3000);
const ttlSeconds = Number(process.env.CACHE_TTL_SECONDS || 300);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

const cache = new CustomerCache(ttlSeconds * 1000);
const repository = createCustomerRepository(pool);
const customerService = createCustomerService(repository, cache);
const salesSummaryRepository = createSalesSummaryRepository(pool);
const salesSummaryService = {
  parseMessage: parseSalesMessage,
  updateSummaryByDate: (orgid, salesDate, data) =>
    salesSummaryRepository.updateSummaryByDate(orgid, salesDate, data),
  findSummaryByDate: (orgid, salesDate) =>
    salesSummaryRepository.findSummaryByDate(orgid, salesDate),
  findDataByDate: (orgid, purchaseDate) =>
    salesSummaryRepository.findDataByDate(orgid, purchaseDate),
  process: (orgid, date) =>
    salesSummaryRepository.summarizeForDate(orgid, date, buildSalesSummary)
};
const customerPaymentRepository = createCustomerPaymentRepository(pool);
const customerPaymentService = {
  parseMessage: parseSalesMessage,
  updateCustomerPayment: (orgid, customerid, paymentAmount) =>
    customerPaymentRepository.updateCustomerPayment(
      orgid,
      customerid,
      paymentAmount
    ),
  findCreditedCustomers: (orgid) =>
    customerPaymentRepository.findCreditedCustomers(orgid),
  process: (orgid, date) =>
    customerPaymentRepository.processForDate(
      orgid,
      date,
      buildCustomerPaymentUpdates
    )
};
const purchaseRepository = createPurchaseRepository(pool);
const purchaseService = {
  create: (orgid, purchase) => purchaseRepository.create(orgid, purchase),
  findByStatus: (orgid, statusCode) =>
    purchaseRepository.findByStatus(orgid, statusCode),
  findDataForSorting: (orgid) =>
    purchaseRepository.findDataForSorting(orgid),
  updateSorting: (orgid, sorting) =>
    purchaseRepository.updateSorting(orgid, sorting),
  findNotDistributed: (orgid) =>
    purchaseRepository.findNotDistributed(orgid, buildNotDistributedPurchases)
};
const groupRepository = createGroupRepository(pool);
const groupService = {
  create: (orgid, group) => groupRepository.create(orgid, group),
  findAll: (orgid) => groupRepository.findAll(orgid),
  updateAssociates: (orgid, update) =>
    groupRepository.updateAssociates(orgid, update)
};
const pubsub = new PubSub({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'maachwala'
});
const buyerPublisher = createBuyerPublisher(
  pubsub,
  process.env.WHOLESALE_CREATE_SALE_PURCHASE_TOPIC ||
    'projects/maachwala/topics/WHOLESALE_CREATE_SALE_PURCHASE'
);
const buyerAllocationRepository = createBuyerAllocationRepository(pool);
const buyerAllocationDistributionPublisher =
  createBuyerAllocationDistributionPublisher(
    pubsub,
    process.env.BUYER_ALLOCATION_DISTRIBUTION_TOPIC ||
      'projects/maachwala/topics/BUYER_ALLOCATION_DISTRIBUTION'
  );
const buyerAllocationConsumer = createBuyerAllocationConsumerService(
  buyerAllocationRepository,
  buyerAllocationDistributionPublisher
);
const sellResponseService = {
  findNotSettled: (orgid) =>
    buyerAllocationRepository.findNotSettled(orgid),
  findByPurchaseDate: (orgid, purchaseDate) =>
    buyerAllocationRepository.findByPurchaseDate(orgid, purchaseDate),
  updateSalesResponse: (response) =>
    buyerAllocationRepository.updateSalesResponse(response)
};
const buyerDistributionRepository = createBuyerDistributionRepository(pool);
const buyerDistributionConsumer = createBuyerDistributionConsumerService(
  buyerDistributionRepository
);
const discountRepository = createDiscountRepository(pool);
const discountService = {
  findAll: (orgid) => discountRepository.findAll(orgid)
};
const purchaseResponsePublisher = createPurchaseResponsePublisher(
  pubsub,
  process.env.UPDATE_PURCHASE_SALES_RESPONSE_TOPIC ||
    'projects/maachwala/topics/UPDATE_PURCHASE_SALES_RESPONSE'
);
const purchaseSalesResponseRepository =
  createPurchaseSalesResponseRepository(pool);
const purchaseSalesResponseConsumer =
  createPurchaseSalesResponseConsumerService(purchaseSalesResponseRepository);
const tenantProvisioningConsumer = createTenantProvisioningConsumer(
  pool,
  migrateTenant
);
const supplierService = createSupplierRepository(pool);
const app = createApp(
  customerService,
  salesSummaryService,
  customerPaymentService,
  purchaseService,
  groupService,
  buyerPublisher,
  buyerAllocationConsumer,
  sellResponseService,
  buyerDistributionConsumer,
  discountService,
  purchaseResponsePublisher,
  purchaseSalesResponseConsumer,
  tenantProvisioningConsumer,
  supplierService
);

const server = app.listen(port, () => {
  console.log(`wholesellerservice listening on port ${port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
