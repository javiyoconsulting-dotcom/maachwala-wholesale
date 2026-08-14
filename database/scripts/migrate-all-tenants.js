'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { loadMigrations, migrateTenant } = require('../lib/migration-runner');

function readConcurrency(value) {
  const concurrency = Number(value ?? 3);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
    throw new Error('MIGRATION_CONCURRENCY must be an integer between 1 and 20');
  }
  return concurrency;
}

async function runWorkers(items, concurrency, worker) {
  let position = 0;
  async function run() {
    while (position < items.length) {
      const item = items[position];
      position += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

async function migrateAllTenants(pool, options = {}) {
  const concurrency = readConcurrency(options.concurrency);
  const migrations = options.migrations || await loadMigrations(options.directory);
  const organizations = await pool.query(`
    SELECT DISTINCT number::text AS orgid
    FROM core.contractedorg
    WHERE number IS NOT NULL
      AND status IS DISTINCT FROM false
    ORDER BY orgid
  `);
  const orgids = organizations.rows.map((row) => row.orgid);
  const report = {
    total: orgids.length,
    upgraded: 0,
    alreadyCurrent: 0,
    failed: 0,
    failures: []
  };

  await runWorkers(orgids, concurrency, async (orgid) => {
    try {
      const result = await migrateTenant(pool, orgid, { migrations });
      if (result.alreadyCurrent) {
        report.alreadyCurrent += 1;
      } else {
        report.upgraded += 1;
      }
      console.log(JSON.stringify({ event: 'tenant_migrated', ...result }));
    } catch (error) {
      report.failed += 1;
      report.failures.push({ orgid, error: error.message });
      console.error(JSON.stringify({
        severity: 'ERROR',
        event: 'tenant_migration_failed',
        orgid,
        error: error.message
      }));
    }
  });
  return report;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: readConcurrency(process.env.MIGRATION_CONCURRENCY)
  });

  try {
    const report = await migrateAllTenants(pool, {
      concurrency: process.env.MIGRATION_CONCURRENCY
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'error', message: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { migrateAllTenants, readConcurrency, runWorkers };
