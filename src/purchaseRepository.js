'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createPurchaseRepository(pool) {
  return {
    async findDataForSorting(orgid) {
      const schema = schemaFromOrgid(orgid);
      const result = await pool.query(`
        SELECT "data"
        FROM ${schema}."purchase"
        WHERE "status" = 1000
        ORDER BY "id"
      `);
      return result.rows.map((row) => row.data);
    },

    async updateSorting(orgid, sorting) {
      const schema = schemaFromOrgid(orgid);
      const result = await pool.query(`
        WITH target AS (
          SELECT "id"
          FROM ${schema}."purchase"
          WHERE "date" = $1::date
          ORDER BY "id" DESC
          LIMIT 1
          FOR UPDATE
        )
        UPDATE ${schema}."purchase" AS purchase
        SET "sortingdata" = $2::jsonb,
            "status" = 1001
        FROM target
        WHERE purchase."id" = target."id"
        RETURNING purchase."id", purchase."date"::text, purchase."status",
                  purchase."sortingdata"
      `, [sorting.purchaseDate, JSON.stringify(sorting)]);

      if (result.rowCount === 0) {
        const error = new Error('No purchase row exists for the supplied date');
        error.code = 'PURCHASE_NOT_FOUND';
        throw error;
      }
      return result.rows[0];
    },

    async create(orgid, purchase) {
      const schema = schemaFromOrgid(orgid);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('purchase:' || $1))`,
          [orgid]
        );
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${schema}."purchase" (
            "id" bigint PRIMARY KEY,
            "created_at" timestamptz NOT NULL DEFAULT now(),
            "date" date,
            "data" jsonb,
            "status" bigint,
            "sortingdata" jsonb
          )
        `);
        const result = await client.query(`
          WITH next_id AS (
            SELECT COALESCE(MAX("id"), 0) + 1 AS "id"
            FROM ${schema}."purchase"
          )
          INSERT INTO ${schema}."purchase" ("id", "date", "data", "status")
          SELECT "id", $1::date, $2::jsonb, 1000
          FROM next_id
          RETURNING "id", "date"::text, "data", "status", "created_at"
        `, [
          purchase.purchaseDate,
          JSON.stringify(purchase)
        ]);
        await client.query('COMMIT');
        const row = result.rows[0];
        return {
          id: row.id,
          purchase_date: row.date,
          total_cost: row.data.totalCost,
          currency: row.data.currency,
          products: row.data.products,
          notes: row.data.notes,
          status: Number(row.status),
          created_at: row.created_at
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

module.exports = { createPurchaseRepository };
