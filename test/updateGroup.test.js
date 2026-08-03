'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createGroupRepository } = require('../src/groupRepository');
const { validateUpdateGroupPayload } = require('../src/updateGroup');

const validPayload = {
  orgid: 767524024827354,
  groupNumber: 1000,
  data: [
    { phone: '9876543210', name: 'Asha Updated', isnew: false },
    { phone: '9876543212', name: 'New Member', isnew: true }
  ]
};

test('validates and normalizes a group update', () => {
  assert.deepEqual(validateUpdateGroupPayload(validPayload), {
    errors: [],
    update: {
      groupNumber: 1000,
      associates: [
        { phone: '9876543210', name: 'Asha Updated', isnew: false },
        { phone: '9876543212', name: 'New Member', isnew: true }
      ]
    }
  });
});

test('requires a group number and boolean isnew values', () => {
  const result = validateUpdateGroupPayload({
    groupNumber: 999,
    data: [{ phone: '9876543210', name: 'Asha', isnew: 'true' }]
  });
  assert.ok(result.errors.some((error) => error.field === 'groupNumber'));
  assert.ok(result.errors.some((error) =>
    error.index === 0 && error.field === 'isnew'
  ));
});

test('atomically adds new and updates existing group associates', async () => {
  const queries = [];
  const updatedData = [
    { name: 'Asha Updated', phone: '9876543210' },
    { name: 'Bina Roy', phone: '9876543211' },
    { name: 'New Member', phone: '9876543212' }
  ];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('SELECT "id"')) {
        return {
          rowCount: 1,
          rows: [{
            id: '1000',
            number: '1000',
            name: 'Morning Market Partners',
            data: [
              { name: 'Asha Das', phone: '9876543210' },
              { name: 'Bina Roy', phone: '9876543211' }
            ]
          }]
        };
      }
      if (String(sql).includes('UPDATE')) {
        return {
          rowCount: 1,
          rows: [{
            id: '1000',
            number: '1000',
            name: 'Morning Market Partners',
            data: updatedData,
            created_at: '2026-08-03T00:00:00.000Z'
          }]
        };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = createGroupRepository({
    async connect() {
      return client;
    }
  });

  const result = await repository.updateAssociates(
    '767524024827354',
    validateUpdateGroupPayload(validPayload).update
  );

  assert.deepEqual(result.data, updatedData);
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /FOR UPDATE/);
  assert.match(queries[2].sql, /SET "data" = \$1::jsonb/);
  assert.deepEqual(queries[2].params, [JSON.stringify(updatedData), 1000]);
  assert.equal(queries[3].sql, 'COMMIT');
});

test('rejects a new associate whose phone already exists', async () => {
  const client = {
    async query(sql) {
      if (String(sql).includes('SELECT "id"')) {
        return {
          rowCount: 1,
          rows: [{
            id: '1000',
            number: '1000',
            name: 'Group',
            data: [{ name: 'Asha', phone: '9876543210' }]
          }]
        };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = createGroupRepository({
    async connect() {
      return client;
    }
  });

  await assert.rejects(
    repository.updateAssociates('767524024827354', {
      groupNumber: 1000,
      associates: [{
        phone: '9876543210',
        name: 'Duplicate',
        isnew: true
      }]
    }),
    (error) => error.code === 'ASSOCIATE_CONFLICT'
  );
});

test('update group endpoint returns the updated data', async (t) => {
  const update = validateUpdateGroupPayload(validPayload).update;
  const updatedData = update.associates.map(({ name, phone }) => ({
    name,
    phone
  }));
  const groupService = {
    async updateAssociates(orgid, input) {
      assert.equal(orgid, '767524024827354');
      assert.deepEqual(input, update);
      return {
        id: '1000',
        number: '1000',
        name: 'Morning Market Partners',
        data: updatedData,
        created_at: '2026-08-03T00:00:00.000Z'
      };
    }
  };
  const app = createApp(null, null, null, null, groupService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/updategroup`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPayload)
    }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'success');
  assert.equal(body.group.number, '1000');
  assert.deepEqual(body.group.data, updatedData);
});
