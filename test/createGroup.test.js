'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { validateCreateGroupPayload } = require('../src/createGroup');
const { createGroupRepository } = require('../src/groupRepository');

const validPayload = {
  orgid: 767524024827354,
  name: 'Morning Market Partners',
  associates: [
    { name: 'Asha Das', phone: '9876543210' },
    { name: 'Bina Roy', phone: 9876543211 }
  ]
};

test('validates and normalizes a business associate group', () => {
  assert.deepEqual(validateCreateGroupPayload(validPayload), {
    errors: [],
    group: {
      name: 'Morning Market Partners',
      associates: [
        { name: 'Asha Das', phone: '9876543210' },
        { name: 'Bina Roy', phone: '9876543211' }
      ]
    }
  });
});

test('rejects malformed and duplicate associates', () => {
  const result = validateCreateGroupPayload({
    name: '',
    associates: [
      { name: '', phone: '123' },
      { name: 'Valid', phone: '9876543210' },
      { name: 'Duplicate', phone: '9876543210' }
    ]
  });

  assert.ok(result.errors.some((error) =>
    error.field === 'name' && error.index === undefined
  ));
  assert.ok(result.errors.some((error) =>
    error.index === 0 && error.field === 'phone'
  ));
  assert.ok(result.errors.some((error) =>
    error.index === 2 && error.field === 'phone'
  ));
});

test('allocates a group number starting at 1000 under a lock', async () => {
  const group = validateCreateGroupPayload(validPayload).group;
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('RETURNING')) {
        return {
          rows: [{
            id: '1000',
            number: '1000',
            name: group.name,
            data: group.associates,
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

  const result = await repository.create('767524024827354', group);

  assert.equal(result.number, '1000');
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /pg_advisory_xact_lock/);
  assert.match(queries[2].sql, /"767524024827354"\."group"/);
  assert.match(queries[2].sql, /GREATEST\(COALESCE\(MAX\("number"\), 999\), 999\) \+ 1/);
  assert.match(queries[2].sql, /"data"/);
  assert.deepEqual(queries[2].params, [
    group.name,
    JSON.stringify(group.associates)
  ]);
  assert.equal(queries[3].sql, 'COMMIT');
});

test('create group endpoint returns the new group', async (t) => {
  const normalized = validateCreateGroupPayload(validPayload).group;
  const groupService = {
    async create(orgid, group) {
      assert.equal(orgid, '767524024827354');
      assert.deepEqual(group, normalized);
      return {
        id: '1000',
        number: '1000',
        name: group.name,
        data: group.associates,
        created_at: '2026-08-03T00:00:00.000Z'
      };
    }
  };
  const app = createApp(null, null, null, null, groupService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/creategroup`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPayload)
    }
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.status, 'success');
  assert.equal(body.group.number, '1000');
  assert.deepEqual(body.group.associates, normalized.associates);
});

test('returns all groups ordered by number', async () => {
  const expected = [{
    number: '1000',
    name: 'Morning Market Partners',
    data: validPayload.associates.map((associate) => ({
      ...associate,
      phone: String(associate.phone)
    }))
  }];
  const queries = [];
  const repository = createGroupRepository({
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: expected };
    }
  });

  const result = await repository.findAll('767524024827354');

  assert.deepEqual(result, expected);
  assert.match(queries[0].sql, /SELECT "number", "name", "data"/);
  assert.match(queries[0].sql, /"767524024827354"\."group"/);
  assert.match(queries[0].sql, /ORDER BY "number"/);
  assert.equal(queries[0].params, undefined);
});

test('get groups endpoint returns name and data JSON', async (t) => {
  const expected = [{
    number: '1000',
    name: 'Morning Market Partners',
    data: [{ name: 'Asha Das', phone: '9876543210' }]
  }];
  const groupService = {
    async findAll(orgid) {
      assert.equal(orgid, '767524024827354');
      return expected;
    }
  };
  const app = createApp(null, null, null, null, groupService);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/wholesale/getgroups`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgid: 767524024827354 })
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-result-count'), '1');
  assert.deepEqual(await response.json(), expected);
});
