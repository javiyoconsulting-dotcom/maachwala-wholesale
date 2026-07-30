'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createCustomerPaymentRepository(pool) {
  return {
    async processForDate(orgid, date, buildUpdates) {
      const schema = schemaFromOrgid(orgid);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('payment:' || $1))`,
          [orgid]
        );

        const discountResult = await client.query(`
          SELECT "weight"
          FROM ${schema}."discount"
          WHERE "weight" IS NOT NULL
          ORDER BY "created_at" DESC, "id" DESC
          LIMIT 1
        `);
        const discountWeight = discountResult.rowCount > 0
          ? Number(discountResult.rows[0].weight)
          : 0;
        if (!Number.isFinite(discountWeight) || discountWeight < 0) {
          const error = new Error('Discount weight is not a valid number');
          error.code = 'INVALID_DISCOUNT';
          throw error;
        }

        const salesResult = await client.query(`
          SELECT "id", "data"
          FROM ${schema}."sales"
          WHERE "date" = $1::date
          FOR SHARE
        `, [date]);
        if (salesResult.rowCount === 0) {
          const error = new Error('No sales rows exist for the supplied date');
          error.code = 'SALES_NOT_FOUND';
          throw error;
        }

        const customerIds = Array.from(new Set(
          salesResult.rows.flatMap((salesRow) =>
            (Array.isArray(salesRow.data?.rows) ? salesRow.data.rows : [])
              .map((record) => String(record.customerId || '').trim())
              .filter((customerId) => /^\d+$/.test(customerId))
          )
        ));

        const paymentResult = customerIds.length > 0
          ? await client.query(`
              SELECT "id", "customerid", "credit", "debit", "data"
              FROM ${schema}."payment"
              WHERE "customerid" = ANY($1::numeric[])
              ORDER BY "id"
              FOR UPDATE
            `, [customerIds])
          : { rows: [] };

        const calculation = buildUpdates(
          salesResult.rows,
          paymentResult.rows,
          discountWeight,
          orgid,
          date
        );

        let nextId = BigInt((await client.query(`
          SELECT COALESCE(MAX("id"), 0) AS "last_id"
          FROM ${schema}."payment"
        `)).rows[0].last_id);
        let createdCount = 0;
        let updatedCount = 0;
        let processedTransactionCount = 0;

        for (const payment of calculation.payments) {
          processedTransactionCount += payment.newTransactionCount;
          if (payment.newTransactionCount === 0) continue;

          if (payment.paymentId) {
            await client.query(`
              UPDATE ${schema}."payment"
              SET "credit" = $1, "debit" = $2, "data" = $3::jsonb
              WHERE "id" = $4
            `, [
              payment.credit,
              payment.debit,
              JSON.stringify(payment.data),
              payment.paymentId
            ]);
            updatedCount += 1;
          } else {
            nextId += 1n;
            await client.query(`
              INSERT INTO ${schema}."payment"
                ("id", "customerid", "credit", "debit", "data")
              VALUES ($1, $2::numeric, $3, $4, $5::jsonb)
            `, [
              nextId.toString(),
              payment.customerId,
              payment.credit,
              payment.debit,
              JSON.stringify(payment.data)
            ]);
            createdCount += 1;
          }
        }

        await client.query('COMMIT');
        return {
          createdCount,
          updatedCount,
          customerCount: calculation.payments.length,
          processedTransactionCount,
          duplicateRecordCount: calculation.duplicateRecordCount,
          invalidRecordCount: calculation.invalidRecords.length
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

module.exports = { createCustomerPaymentRepository };
