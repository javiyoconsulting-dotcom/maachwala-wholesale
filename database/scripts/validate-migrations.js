'use strict';

require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const migrationsDirectory = path.resolve(__dirname, '..', 'migrations');
const migrationPattern = /^V(\d{3})__[a-z0-9_]+\.sql$/;

async function loadMigrations() {
  const filenames = (await fs.readdir(migrationsDirectory)).sort();
  const migrations = [];
  const versions = new Set();

  for (const filename of filenames) {
    const match = migrationPattern.exec(filename);
    if (!match) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }

    const version = Number(match[1]);
    if (versions.has(version)) {
      throw new Error(`Duplicate migration version: ${match[1]}`);
    }
    versions.add(version);
    migrations.push({
      filename,
      version,
      sql: await fs.readFile(path.join(migrationsDirectory, filename), 'utf8')
    });
  }

  migrations.sort((left, right) => left.version - right.version);
  migrations.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new Error(`Expected migration V${String(expected).padStart(3, '0')}`);
    }
  });
  return migrations;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to validate migration SQL');
  }

  const migrations = await loadMigrations();
  const testSchema = `999${Date.now()}`;
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
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
