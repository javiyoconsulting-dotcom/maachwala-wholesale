'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const { createApp } = require('./src/app');
const { CustomerCache } = require('./src/cache');
const { createCustomerRepository } = require('./src/customerRepository');
const { createCustomerService } = require('./src/customerService');

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

// Google Cloud Functions HTTP entry point. Objects are created at module scope
// so warm function instances reuse the connection pool and cache.
exports.wholesellerService = createApp(customerService);
