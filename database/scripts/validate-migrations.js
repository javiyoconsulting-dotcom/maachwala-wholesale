'use strict';

require('dotenv').config();
const { Client } = require('pg');
const { loadMigrations } = require('../lib/migration-runner');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to validate migration SQL');
  }

  const migrations = await loadMigrations();
  const testSchema = `999${Date.now()}`;
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query('BEGIN');
    for (const migration of migrations) {
      const sql = migration.sql.replaceAll('{{schema}}', testSchema);
      await client.query(sql);
      console.log(`Validated ${migration.filename}`);
    }
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Migration validation failed: ${error.message}`);
  process.exitCode = 1;
});
