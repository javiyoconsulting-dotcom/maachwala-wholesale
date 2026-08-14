'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const defaultMigrationsDirectory = path.resolve(__dirname, '..', 'migrations');
const migrationPattern = /^V(\d{3})__([a-z0-9_]+)\.sql$/;

function normalizeOrgid(value) {
  const orgid = String(value ?? '').trim();
  if (!/^\d+$/.test(orgid)) {
    throw new Error('orgid is required and must contain digits only');
  }
  return orgid;
}

async function loadMigrations(directory = defaultMigrationsDirectory) {
  const filenames = (await fs.readdir(directory)).sort();
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

    const sql = await fs.readFile(path.join(directory, filename), 'utf8');
    migrations.push({
      version,
      description: match[2],
      filename,
      sql,
      checksum: crypto.createHash('sha256').update(sql).digest('hex')
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

async function ensureHistoryTable(client) {
  await client.query('CREATE SCHEMA IF NOT EXISTS core');
  await client.query(`
    CREATE TABLE IF NOT EXISTS core.tenant_schema_migrations (
      orgid text NOT NULL,
      version integer NOT NULL,
      description text NOT NULL,
      checksum text NOT NULL,
      installed_on timestamp with time zone NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL,
      PRIMARY KEY (orgid, version)
    )
  `);
}

async function migrateTenant(pool, orgidValue, options = {}) {
  const orgid = normalizeOrgid(orgidValue);
  const migrations = options.migrations || await loadMigrations(options.directory);
  const client = await pool.connect();
  const result = { orgid, applied: [], alreadyCurrent: false };

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [orgid]);
    await ensureHistoryTable(client);

    const history = await client.query(`
      SELECT version, checksum
      FROM core.tenant_schema_migrations
      WHERE orgid = $1
      ORDER BY version
    `, [orgid]);
    const applied = new Map(history.rows.map((row) => [Number(row.version), row.checksum]));

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        if (applied.get(migration.version) !== migration.checksum) {
          throw new Error(
            `${migration.filename} was changed after it was applied to org ${orgid}`
          );
        }
        continue;
      }

      const startedAt = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(migration.sql.replaceAll('{{schema}}', orgid));
        const executionMs = Date.now() - startedAt;
        await client.query(`
          INSERT INTO core.tenant_schema_migrations
            (orgid, version, description, checksum, execution_ms)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          orgid,
          migration.version,
          migration.description,
          migration.checksum,
          executionMs
        ]);
        await client.query('COMMIT');
        result.applied.push({
          version: migration.version,
          description: migration.description,
          executionMs
        });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`${migration.filename} failed for org ${orgid}: ${error.message}`);
      }
    }

    result.alreadyCurrent = result.applied.length === 0;
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [orgid]).catch(() => {});
    client.release();
  }
}

module.exports = {
  defaultMigrationsDirectory,
  ensureHistoryTable,
  loadMigrations,
  migrateTenant,
  normalizeOrgid
};
