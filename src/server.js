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
  process: (orgid, date) =>
    salesSummaryRepository.summarizeForDate(orgid, date, buildSalesSummary)
};
const app = createApp(customerService, salesSummaryService);

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
