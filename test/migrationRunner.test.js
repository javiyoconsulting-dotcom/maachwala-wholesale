'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  migrateTenant,
  normalizeOrgid
} = require('../database/lib/migration-runner');
const {
  readConcurrency,
  runWorkers
} = require('../database/scripts/migrate-all-tenants');

test('accepts only numeric organization schema identifiers', () => {
  assert.equal(normalizeOrgid(767524024827355n), '767524024827355');
  assert.throws(() => normalizeOrgid('7675; DROP SCHEMA core'), /digits only/);
});

test('applies and records a missing migration in one transaction', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT version, checksum/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    release() {
      calls.push({ sql: 'RELEASE' });
    }
  };
  const pool = { async connect() { return client; } };
  const migrations = [{
    version: 1,
    description: 'initial_schema',
    filename: 'V001__initial_schema.sql',
    checksum: 'abc123',
    sql: 'CREATE SCHEMA "{{schema}}"'
  }];

  const result = await migrateTenant(pool, '767524024827355', { migrations });

  assert.equal(result.alreadyCurrent, false);
  assert.equal(result.applied[0].version, 1);
  assert.ok(calls.some(({ sql }) => sql === 'BEGIN'));
  assert.ok(calls.some(({ sql }) => sql === 'CREATE SCHEMA "767524024827355"'));
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(calls.some(({ sql }) => /INSERT INTO core\.tenant_schema_migrations/.test(sql)));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('rejects a migration changed after installation', async () => {
  const client = {
    async query(sql) {
      if (/SELECT version, checksum/.test(sql)) {
        return { rows: [{ version: 1, checksum: 'old-checksum' }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };

  await assert.rejects(
    migrateTenant(pool, '767524024827355', { migrations: [{
      version: 1,
      description: 'initial_schema',
      filename: 'V001__initial_schema.sql',
      checksum: 'new-checksum',
      sql: 'SELECT 1'
    }] }),
    /changed after it was applied/
  );
});

test('limits migration concurrency and processes every tenant', async () => {
  assert.equal(readConcurrency(undefined), 3);
  assert.throws(() => readConcurrency(0), /between 1 and 20/);

  let active = 0;
  let maximumActive = 0;
  const completed = [];
  await runWorkers(['1', '2', '3', '4'], 2, async (orgid) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    completed.push(orgid);
    active -= 1;
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(completed.sort(), ['1', '2', '3', '4']);
});
