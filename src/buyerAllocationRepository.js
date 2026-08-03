'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createBuyerAllocationRepository(pool) {
  return {
    async replaceAllocations(orgid, message, buildRows) {
      const schema = schemaFromOrgid(orgid);
      const rows = buildRows(message);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(
             hashtext('buyerallocation:' || $1 || ':' || $2)
           )`,
          [orgid, message.purchaseDate]
        );
        await client.query(`
          DELETE FROM ${schema}."buyerallocation" AS existing
          USING jsonb_to_recordset($1::jsonb) AS incoming(
            "product" bigint,
            "size" bigint,
            "buyerphone" numeric
          )
          WHERE existing."purchasedate" = $2::date
            AND existing."product" = incoming."product"
            AND existing."size" = incoming."size"
            AND existing."buyerphone" = incoming."buyerphone"
        `, [JSON.stringify(rows), message.purchaseDate]);
        const result = await client.query(`
          INSERT INTO ${schema}."buyerallocation" (
            "purchasedate", "product", "productdesc", "size", "sizedesc",
            "buyerphone", "buyername", "allocatedweight", "maxprice",
            "minprice", "buyerprice", "buyerquantity",
            "buyerweightdiscount"
          )
          SELECT
            incoming."purchasedate"::date,
            incoming."product",
            incoming."productdesc",
            incoming."size",
            incoming."sizedesc",
            incoming."buyerphone",
            incoming."buyername",
            incoming."allocatedweight",
            incoming."maxprice",
            incoming."minprice",
            NULL,
            NULL,
            NULL
          FROM jsonb_to_recordset($1::jsonb) AS incoming(
            "purchasedate" text,
            "product" bigint,
            "productdesc" text,
            "size" bigint,
            "sizedesc" text,
            "buyerphone" numeric,
            "buyername" text,
            "allocatedweight" double precision,
            "maxprice" double precision,
            "minprice" double precision
          )
          RETURNING "id"
        `, [JSON.stringify(rows)]);
        await client.query('COMMIT');
        return { insertedCount: result.rowCount };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

module.exports = { createBuyerAllocationRepository };
