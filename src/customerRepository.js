'use strict';

// orgid is strictly validated before interpolation. PostgreSQL identifiers
// cannot be supplied as query parameters, so the schema is double-quoted.
function schemaFromOrgid(orgid) {
  const value = String(orgid);
  if (!/^\d+$/.test(value)) {
    throw new TypeError('orgid must contain digits only');
  }
  return `"${value}"`;
}

function createCustomerRepository(pool) {
  return {
    async findAll(orgid) {
      const schema = schemaFromOrgid(orgid);
      const sql = `
        SELECT "number", "name", "phone"
        FROM ${schema}."customers"
        ORDER BY "number"
      `;
      const result = await pool.query(sql);
      return result.rows;
    },

    async createMany(orgid, customers) {
      const schema = schemaFromOrgid(orgid);
      const names = customers.map((customer) => customer.name);
      const phones = customers.map((customer) => customer.phone);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        // Serialize number allocation per organization so concurrent batches
        // cannot calculate the same MAX(number) value.
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('customers:' || $1))`,
          [orgid]
        );

        const result = await client.query(`
          WITH current_number AS (
            SELECT COALESCE(MAX("number"), 0) AS "last_number"
            FROM ${schema}."customers"
          ),
          input AS (
            SELECT *
            FROM unnest($1::text[], $2::numeric[])
              WITH ORDINALITY AS item("name", "phone", "position")
          ),
          numbered AS (
            SELECT
              current_number."last_number" + input."position" AS "number",
              "name",
              "phone",
              "position"
            FROM input
            CROSS JOIN current_number
          )
          INSERT INTO ${schema}."customers"
            ("id", "number", "name", "phone")
          SELECT "number"::bigint, "number", "name", "phone"
          FROM numbered
          ORDER BY "position"
          RETURNING "id", "number", "name", "phone", "created_at"
        `, [names, phones]);

        // Keep the existing sequence aligned for any legacy code that still
        // relies on the number column's database default.
        await client.query(`
          SELECT setval(
            '${schema}."customers_number_seq"'::regclass,
            (SELECT MAX("number")::bigint FROM ${schema}."customers"),
            true
          )
        `);
        await client.query('COMMIT');

        return result.rows.sort((left, right) => {
          const leftNumber = BigInt(left.number);
          const rightNumber = BigInt(right.number);
          return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
        });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

module.exports = { createCustomerRepository, schemaFromOrgid };
