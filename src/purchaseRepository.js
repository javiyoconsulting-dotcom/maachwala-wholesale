'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createPurchaseRepository(pool) {
  return {
    async create(orgid, purchase) {
      const schema = schemaFromOrgid(orgid);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('purchases:' || $1))`,
          [orgid]
        );
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${schema}."purchases" (
            "id" bigserial PRIMARY KEY,
            "purchase_date" date NOT NULL,
            "total_cost" numeric(14, 2) NOT NULL CHECK ("total_cost" >= 0),
            "currency" varchar(3) NOT NULL,
            "products" jsonb NOT NULL CHECK (jsonb_typeof("products") = 'array'),
            "notes" text,
            "created_at" timestamptz NOT NULL DEFAULT now()
          )
        `);
        const result = await client.query(`
          INSERT INTO ${schema}."purchases"
            ("purchase_date", "total_cost", "currency", "products", "notes")
          VALUES ($1::date, $2::numeric, $3, $4::jsonb, $5)
          RETURNING "id", "purchase_date"::text, "total_cost", "currency",
                    "products", "notes", "created_at"
        `, [
          purchase.purchaseDate,
          purchase.totalCost,
          purchase.currency,
          JSON.stringify(purchase.products),
          purchase.notes
        ]);
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

module.exports = { createPurchaseRepository };
