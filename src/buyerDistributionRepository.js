'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createBuyerDistributionRepository(pool) {
  return {
    async distribute(sourceOrgid, message, buildPurchases) {
      const sourceSchema = schemaFromOrgid(sourceOrgid);
      const buyerPurchases = buildPurchases(message);
      const phones = buyerPurchases.map((buyer) => buyer.phone);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(
             hashtext('buyer-distribution:' || $1 || ':' || $2)
           )`,
          [sourceOrgid, message.purchaseDate]
        );
        const organizationsResult = await client.query(`
          SELECT "number"::text AS "orgid", "name",
                 "data"->>'ownerphone' AS "phone"
          FROM "core"."contractedorg"
          WHERE "status" = true
            AND "data"->>'ownerphone' = ANY($1::text[])
        `, [phones]);
        const organizations = new Map(
          organizationsResult.rows.map((row) => [row.phone, row])
        );
        const createdPurchases = [];
        let skippedNotOnboarded = 0;
        let skippedAlreadyProcessed = 0;

        for (const buyer of buyerPurchases) {
          const organization = organizations.get(buyer.phone);
          if (!organization) {
            skippedNotOnboarded += 1;
            continue;
          }

          const pendingResult = await client.query(`
            SELECT "id"
            FROM ${sourceSchema}."buyerallocation"
            WHERE "sortingnumber" = ANY($1::numeric[])
              AND "buyerphone" = $2::numeric
              AND COALESCE("isbuyeronboarded", false) = false
            FOR UPDATE
          `, [buyer.sortingNumbers, buyer.phone]);
          if (pendingResult.rowCount === 0) {
            skippedAlreadyProcessed += 1;
            continue;
          }

          const targetSchema = schemaFromOrgid(organization.orgid);
          await client.query(
            `SELECT pg_advisory_xact_lock(hashtext('purchase:' || $1))`,
            [organization.orgid]
          );
          await client.query(`
            CREATE TABLE IF NOT EXISTS ${targetSchema}."purchase" (
              "id" bigint PRIMARY KEY,
              "created_at" timestamptz NOT NULL DEFAULT now(),
              "date" date,
              "data" jsonb,
              "status" bigint,
              "sortingdata" jsonb,
              "number" numeric,
              "fromorg" numeric
            )
          `);
          await client.query(`
            ALTER TABLE ${targetSchema}."purchase"
            ADD COLUMN IF NOT EXISTS "fromorg" numeric
          `);
          const purchaseResult = await client.query(`
            WITH next_id AS (
              SELECT COALESCE(MAX("id"), 0) + 1 AS "id"
              FROM ${targetSchema}."purchase"
            )
            INSERT INTO ${targetSchema}."purchase" (
              "id", "date", "data", "status", "number", "fromorg"
            )
            SELECT "id", $1::date, $2::jsonb, 1003,
                   floor(extract(epoch FROM clock_timestamp()) * 1000)::numeric,
                   $3::numeric
            FROM next_id
            RETURNING "id", "number"
          `, [
            message.purchaseDate,
            JSON.stringify(buyer.purchase),
            sourceOrgid
          ]);
          const purchaseRow = purchaseResult.rows[0];
          await client.query(`
            UPDATE ${sourceSchema}."buyerallocation"
            SET "isbuyeronboarded" = true,
                "buyerpurchase" = $3::numeric
            WHERE "sortingnumber" = ANY($1::numeric[])
              AND "buyerphone" = $2::numeric
          `, [buyer.sortingNumbers, buyer.phone, purchaseRow.number]);
          createdPurchases.push({
            buyerPhone: buyer.phone,
            buyerName: buyer.name,
            organizationId: organization.orgid,
            organizationName: organization.name,
            purchaseId: purchaseRow.id,
            purchaseNumber: purchaseRow.number
          });
        }

        await client.query('COMMIT');
        return {
          createdCount: createdPurchases.length,
          skippedNotOnboarded,
          skippedAlreadyProcessed,
          purchases: createdPurchases
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

module.exports = { createBuyerDistributionRepository };
