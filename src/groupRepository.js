'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createGroupRepository(pool) {
  return {
    async create(orgid, group) {
      const schema = schemaFromOrgid(orgid);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('group:' || $1))`,
          [orgid]
        );
        const result = await client.query(`
          WITH next_number AS (
            SELECT GREATEST(COALESCE(MAX("number"), 999), 999) + 1 AS "number"
            FROM ${schema}."group"
          )
          INSERT INTO ${schema}."group" ("id", "number", "name", "data")
          SELECT "number"::bigint, "number", $1, $2::jsonb
          FROM next_number
          RETURNING "id", "number", "name", "data", "created_at"
        `, [group.name, JSON.stringify(group.associates)]);
        await client.query('COMMIT');
        return result.rows[0];
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

module.exports = { createGroupRepository };
