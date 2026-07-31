'use strict';

const { schemaFromOrgid } = require('./customerRepository');
const { buildCustomerBuyData } = require('./salesSummary');

function createSalesSummaryRepository(pool) {
  return {
    async summarizeForDate(orgid, date, buildSummary) {
      const schema = schemaFromOrgid(orgid);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const discountResult = await client.query(`
          SELECT "weight"
          FROM ${schema}."discount"
          WHERE "weight" IS NOT NULL
          ORDER BY "created_at" DESC, "id" DESC
          LIMIT 1
        `);
        if (discountResult.rowCount === 0) {
          const error = new Error('No discount weight is configured');
          error.code = 'DISCOUNT_NOT_FOUND';
          throw error;
        }

        const discountWeight = Number(discountResult.rows[0].weight);
        if (!Number.isFinite(discountWeight)) {
          const error = new Error('Discount weight is not numeric');
          error.code = 'INVALID_DISCOUNT';
          throw error;
        }

        const salesResult = await client.query(`
          SELECT "id", "data"
          FROM ${schema}."sales"
          WHERE "date" = $1::date
          FOR UPDATE
        `, [date]);
        if (salesResult.rowCount === 0) {
          const error = new Error('No sales rows exist for the supplied date');
          error.code = 'SALES_NOT_FOUND';
          throw error;
        }

        const summary = buildSummary(
          salesResult.rows,
          discountWeight,
          orgid,
          date
        );

        const customerIds = [...new Set(salesResult.rows.flatMap((salesRow) =>
          (Array.isArray(salesRow.data?.rows) ? salesRow.data.rows : [])
            .map((record) => String(record.customerId || '').trim())
            .filter((customerId) => /^\d+$/.test(customerId))
        ))];
        const customersResult = customerIds.length === 0
          ? { rows: [] }
          : await client.query(`
              SELECT "number", "name", "phone"
              FROM ${schema}."customers"
              WHERE "number"::text = ANY($1::text[])
            `, [customerIds]);
        const buydata = buildCustomerBuyData(
          salesResult.rows,
          customersResult.rows,
          discountWeight
        );

        const updateResult = await client.query(`
          UPDATE ${schema}."sales"
          SET "summary" = $1::jsonb,
              "buydata" = $2::jsonb
          WHERE "date" = $3::date
          RETURNING "id"
        `, [JSON.stringify(summary), JSON.stringify(buydata), date]);

        await client.query('COMMIT');
        return { summary, buydata, updatedRows: updateResult.rowCount };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

module.exports = { createSalesSummaryRepository };
