'use strict';

const { randomUUID } = require('node:crypto');
const { schemaFromOrgid } = require('./customerRepository');

function numericValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function createCustomerPaymentRepository(pool) {
  return {
    async updateCustomerPayment(orgid, customerid, paymentAmount) {
      const schema = schemaFromOrgid(orgid);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const result = await client.query(`
          SELECT "id", "customerid", "credit", "debit", "data"
          FROM ${schema}."payment"
          WHERE "customerid" = $1::numeric
          ORDER BY "id" DESC
          LIMIT 1
          FOR UPDATE
        `, [customerid]);
        if (result.rowCount === 0) {
          const error = new Error(
            'No payment record exists for the supplied customer'
          );
          error.code = 'CUSTOMER_PAYMENT_NOT_FOUND';
          throw error;
        }

        const payment = result.rows[0];
        const data = payment.data && typeof payment.data === 'object' &&
          !Array.isArray(payment.data) ? payment.data : {};
        const previousCreditAmount = roundMoney(numericValue(
          data.creditTotal ?? data.credit
        ));
        const balanceAfterPayment = roundMoney(
          previousCreditAmount - paymentAmount
        );
        const totalCreditAmount = Math.max(0, balanceAfterPayment);
        const totalDebitAmount = Math.max(0, -balanceAfterPayment);
        const paidAt = new Date().toISOString();
        const paymentEntry = {
          paymentId: randomUUID(),
          amount: paymentAmount,
          previousCreditAmount,
          totalCreditAmount,
          totalDebitAmount,
          paidAt
        };
        const payments = Array.isArray(data.payments)
          ? [...data.payments, paymentEntry]
          : [paymentEntry];
        const updatedData = {
          ...data,
          creditTotal: totalCreditAmount,
          debitTotal: totalDebitAmount,
          netBalance: balanceAfterPayment,
          payments,
          updatedAt: paidAt
        };

        await client.query(`
          UPDATE ${schema}."payment"
          SET "credit" = $1,
              "debit" = $2,
              "data" = $3::jsonb
          WHERE "id" = $4
        `, [
          balanceAfterPayment > 0,
          balanceAfterPayment < 0,
          JSON.stringify(updatedData),
          payment.id
        ]);
        await client.query('COMMIT');

        return {
          id: payment.id,
          customerid: String(payment.customerid),
          paymentAmount,
          previousCreditAmount,
          totalCreditAmount,
          totalDebitAmount,
          credit: balanceAfterPayment > 0,
          debit: balanceAfterPayment < 0,
          payment: paymentEntry
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '42P01' || error.code === '3F000') {
          const notFound = new Error(
            'The payment table does not exist for the supplied organization'
          );
          notFound.code = 'PAYMENT_TABLE_NOT_FOUND';
          throw notFound;
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async findCreditedCustomers(orgid) {
      const schema = schemaFromOrgid(orgid);
      try {
        const result = await pool.query(`
          SELECT "id", "customerid", "data"
          FROM ${schema}."payment"
          WHERE "credit" IS TRUE
          ORDER BY "customerid", "id"
        `);

        return result.rows.map((row) => {
          const rawCreditTotal = row.data?.creditTotal ?? row.data?.credit;
          const creditTotal = rawCreditTotal === null ||
            rawCreditTotal === undefined || rawCreditTotal === ''
            ? null
            : Number(rawCreditTotal);
          return {
            id: row.id,
            customerid: row.customerid,
            totalCreditAmount: Number.isFinite(creditTotal)
              ? creditTotal
              : null
          };
        });
      } catch (error) {
        if (error.code === '42P01' || error.code === '3F000') {
          const notFound = new Error(
            'The payment table does not exist for the supplied organization'
          );
          notFound.code = 'PAYMENT_TABLE_NOT_FOUND';
          throw notFound;
        }
        throw error;
      }
    },

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
