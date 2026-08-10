'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { createApp } = require('./src/app');
const { CustomerCache } = require('./src/cache');
const { createCustomerRepository } = require('./src/customerRepository');
const { createCustomerService } = require('./src/customerService');
const { buildSalesSummary } = require('./src/salesSummary');
const { createSalesSummaryRepository } = require('./src/salesSummaryRepository');
const { parseSalesMessage } = require('./src/pubsub');
const {
  buildCustomerPaymentUpdates
} = require('./src/customerPaymentSummary');
const {
  createCustomerPaymentRepository
} = require('./src/customerPaymentRepository');
const { createPurchaseRepository } = require('./src/purchaseRepository');
const { buildNotDistributedPurchases } = require('./src/notDistributed');
const { createGroupRepository } = require('./src/groupRepository');
const { PubSub } = require('@google-cloud/pubsub');
const { createBuyerPublisher } = require('./src/buyerPublisher');
const {
  createBuyerAllocationConsumerService
} = require('./src/buyerAllocationConsumer');
const {
  createBuyerAllocationRepository
} = require('./src/buyerAllocationRepository');
const {
  createBuyerAllocationDistributionPublisher
} = require('./src/buyerAllocationDistributionPublisher');
const {
  createBuyerDistributionConsumerService
} = require('./src/buyerDistributionConsumer');
const {
  createBuyerDistributionRepository
} = require('./src/buyerDistributionRepository');
const { createDiscountRepository } = require('./src/discountRepository');
const {
  createPurchaseResponsePublisher
} = require('./src/purchaseResponsePublisher');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

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
  findByPurchaseDate: (orgid, purchaseDate) =>
    buyerAllocationRepository.findByPurchaseDate(orgid, purchaseDate)
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

// Google Cloud Functions HTTP entry point. Objects are created at module scope
// so warm function instances reuse the connection pool and cache.
exports.wholesellerService = createApp(
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
  purchaseResponsePublisher
);
