'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createBuyerAllocationRepository(pool) {
  return {
    async findNotSettled(orgid) {
      const schema = schemaFromOrgid(orgid);
      const result = await pool.query(`
        SELECT allocation."allocatedweight", allocation."maxprice",
               allocation."minprice", allocation."buyerquantity",
               allocation."buyerprice", allocation."buyerweightdiscount",
               allocation."sortingnumber", sorting."productdesc",
               sorting."sizedesc", sorting."purchasedate"::text,
               sorting."purchasenumber"
        FROM ${schema}."buyerallocation" AS allocation
        INNER JOIN ${schema}."sorting" AS sorting
          ON sorting."number" = allocation."sortingnumber"
         AND sorting."productid" = allocation."product"
         AND sorting."sizeid" = allocation."size"
        WHERE allocation."buyerprice" IS NULL
           OR allocation."buyerquantity"
                IS DISTINCT FROM allocation."allocatedweight"
        ORDER BY sorting."purchasedate", sorting."purchasenumber",
                 allocation."sortingnumber", allocation."id"
      `);

      return result.rows.map((row) => ({
        actualWeight: row.allocatedweight,
        maximumPrice: row.maxprice,
        minimumPrice: row.minprice,
        buyerWeight: row.buyerquantity,
        buyerPrice: row.buyerprice,
        buyerWeightDiscount: row.buyerweightdiscount,
        sortingNumber: row.sortingnumber === null
          ? null
          : Number(row.sortingnumber),
        productDescription: row.productdesc,
        sizeDescription: row.sizedesc,
        purchaseDate: row.purchasedate,
        purchaseNumber: row.purchasenumber === null
          ? null
          : Number(row.purchasenumber)
      }));
    },

    async findByPurchaseDate(orgid, purchaseDate) {
      const schema = schemaFromOrgid(orgid);
      const result = await pool.query(`
        SELECT "id", "created_at", "purchasedate"::text, "sortingnumber",
               "product", "productdesc", "size", "sizedesc", "buyerphone",
               "buyername", "allocatedweight", "maxprice", "minprice",
               "buyerprice", "buyerquantity", "buyerweightdiscount"
        FROM ${schema}."buyerallocation"
        WHERE "purchasedate" = $1::date
        ORDER BY "sortingnumber", "product", "size", "id"
      `, [purchaseDate]);

      return result.rows.map((row) => ({
        id: Number(row.id),
        createdAt: row.created_at,
        purchaseDate: row.purchasedate,
        sortingNumber: row.sortingnumber === null
          ? null
          : Number(row.sortingnumber),
        productId: row.product === null ? null : Number(row.product),
        productName: row.productdesc,
        sizeId: row.size === null ? null : Number(row.size),
        sizeDescription: row.sizedesc,
        buyerPhone: row.buyerphone === null ? null : String(row.buyerphone),
        buyerName: row.buyername,
        allocatedWeightKg: row.allocatedweight,
        maximumPrice: row.maxprice,
        minimumPrice: row.minprice,
        buyerPrice: row.buyerprice,
        buyerQuantity: row.buyerquantity,
        buyerWeightDiscount: row.buyerweightdiscount
      }));
    },

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
          ALTER TABLE ${schema}."buyerallocation"
          ADD COLUMN IF NOT EXISTS "sortingnumber" numeric
        `);
        await client.query(`
          DELETE FROM ${schema}."buyerallocation" AS existing
          USING jsonb_to_recordset($1::jsonb) AS incoming(
            "product" bigint,
            "size" bigint,
            "sortingnumber" numeric,
            "buyerphone" numeric
          )
          WHERE existing."purchasedate" = $2::date
            AND existing."product" = incoming."product"
            AND existing."size" = incoming."size"
            AND existing."sortingnumber" = incoming."sortingnumber"
            AND existing."buyerphone" = incoming."buyerphone"
        `, [JSON.stringify(rows), message.purchaseDate]);
        const result = await client.query(`
          INSERT INTO ${schema}."buyerallocation" (
            "purchasedate", "product", "productdesc", "size", "sizedesc",
            "buyerphone", "buyername", "allocatedweight", "maxprice",
            "minprice", "buyerprice", "buyerquantity",
            "buyerweightdiscount", "sortingnumber"
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
            NULL,
            incoming."sortingnumber"
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
            "minprice" double precision,
            "sortingnumber" numeric
          )
          RETURNING "id"
        `, [JSON.stringify(rows)]);
        const sortingResult = await client.query(`
          WITH targets AS (
            SELECT DISTINCT "sortingnumber", "product", "size"
            FROM jsonb_to_recordset($1::jsonb) AS incoming(
              "sortingnumber" numeric,
              "product" bigint,
              "size" bigint
            )
          ), allocation_totals AS (
            SELECT targets."sortingnumber", targets."product", targets."size",
                   COALESCE(SUM(allocation."allocatedweight"), 0)
                     AS "allocatedquantity"
            FROM targets
            LEFT JOIN ${schema}."buyerallocation" AS allocation
              ON allocation."sortingnumber" = targets."sortingnumber"
             AND allocation."product" = targets."product"
             AND allocation."size" = targets."size"
            GROUP BY targets."sortingnumber", targets."product", targets."size"
          )
          UPDATE ${schema}."sorting" AS sorting
          SET "allocatedquantity" = totals."allocatedquantity",
              "allocationcomplete" =
                totals."allocatedquantity" >= sorting."quantity"
          FROM allocation_totals AS totals
          WHERE sorting."number" = totals."sortingnumber"
            AND sorting."productid" = totals."product"
            AND sorting."sizeid" = totals."size"
          RETURNING sorting."id", sorting."number",
                    sorting."allocatedquantity", sorting."allocationcomplete"
        `, [JSON.stringify(rows)]);

        const expectedSortingRows = new Set(rows.map((row) =>
          `${row.sortingnumber}:${row.product}:${row.size}`
        )).size;
        if (sortingResult.rowCount !== expectedSortingRows) {
          const error = new Error(
            'One or more matching sorting rows were not found'
          );
          error.code = 'SORTING_NOT_FOUND';
          throw error;
        }
        await client.query('COMMIT');
        return {
          insertedCount: result.rowCount,
          updatedSortingCount: sortingResult.rowCount
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

module.exports = { createBuyerAllocationRepository };
