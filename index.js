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
  process: (orgid, date) =>
    salesSummaryRepository.summarizeForDate(orgid, date, buildSalesSummary)
};
const customerPaymentRepository = createCustomerPaymentRepository(pool);
const customerPaymentService = {
  parseMessage: parseSalesMessage,
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
  findDataByDate: (orgid, date) =>
    purchaseRepository.findDataByDate(orgid, date)
};

// Google Cloud Functions HTTP entry point. Objects are created at module scope
// so warm function instances reuse the connection pool and cache.
exports.wholesellerService = createApp(
  customerService,
  salesSummaryService,
  customerPaymentService,
  purchaseService
);
