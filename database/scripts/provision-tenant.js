'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { migrateTenant } = require('../lib/migration-runner');

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 1
  });
}

async function main() {
  const orgid = process.argv[2];
  if (!orgid) {
    throw new Error('Usage: node database/scripts/provision-tenant.js <orgid>');
  }

  const pool = createPool();
  try {
    const result = await migrateTenant(pool, orgid);
    console.log(JSON.stringify({ status: 'success', ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: 'error',
      message: error.message
    }));
    process.exitCode = 1;
  });
}

module.exports = { createPool, main };
