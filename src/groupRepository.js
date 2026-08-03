'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createGroupRepository(pool) {
  return {
    async findAll(orgid) {
      const schema = schemaFromOrgid(orgid);
      const result = await pool.query(`
        SELECT "number", "name", "data"
        FROM ${schema}."group"
        ORDER BY "number"
      `);
      return result.rows;
    },

    async updateAssociates(orgid, update) {
      const schema = schemaFromOrgid(orgid);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const groupResult = await client.query(`
          SELECT "id", "number", "name", "data"
          FROM ${schema}."group"
          WHERE "number" = $1::numeric
          FOR UPDATE
        `, [update.groupNumber]);
        if (groupResult.rowCount === 0) {
          const error = new Error('No group exists for the supplied groupNumber');
          error.code = 'GROUP_NOT_FOUND';
          throw error;
        }

        const group = groupResult.rows[0];
        const associates = Array.isArray(group.data) ? [...group.data] : [];
        const indexByPhone = new Map(
          associates.map((associate, index) => [String(associate.phone), index])
        );

        for (const associate of update.associates) {
          const existingIndex = indexByPhone.get(associate.phone);
          if (associate.isnew) {
            if (existingIndex !== undefined) {
              const error = new Error(
                `Associate phone ${associate.phone} already exists in the group`
              );
              error.code = 'ASSOCIATE_CONFLICT';
              throw error;
            }
            indexByPhone.set(associate.phone, associates.length);
            associates.push({ name: associate.name, phone: associate.phone });
          } else {
            if (existingIndex === undefined) {
              const error = new Error(
                `Associate phone ${associate.phone} does not exist in the group`
              );
              error.code = 'ASSOCIATE_NOT_FOUND';
              throw error;
            }
            associates[existingIndex] = {
              ...associates[existingIndex],
              name: associate.name,
              phone: associate.phone
            };
          }
        }

        const result = await client.query(`
          UPDATE ${schema}."group"
          SET "data" = $1::jsonb
          WHERE "number" = $2::numeric
          RETURNING "id", "number", "name", "data", "created_at"
        `, [JSON.stringify(associates), update.groupNumber]);
        await client.query('COMMIT');
        return result.rows[0];
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

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
