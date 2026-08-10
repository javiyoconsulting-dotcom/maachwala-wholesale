'use strict';

const { schemaFromOrgid } = require('./customerRepository');
const { buildCustomerBuyData, parseNumber } = require('./salesSummary');

function roundWeight(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function roundPrice(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hasWeightDiscount(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['y', 'true'].includes(value.trim().toLowerCase());
}

function applySalesWeightDiscount(data, discountWeight) {
  if (!data || !Array.isArray(data.rows)) return data;

  return {
    ...data,
    rows: data.rows.map((record) => {
      if (!record) return record;

      const actualWeight = parseNumber(record.weight);
      const unitPrice = parseNumber(record.unitprice);
      if (actualWeight === null || unitPrice === null) return record;

      if (!hasWeightDiscount(record.weightdiscount)) {
        return {
          ...record,
          totalprice: roundPrice(actualWeight * unitPrice)
        };
      }

      const discountedWeight = roundWeight(
        actualWeight - Math.round(actualWeight) * discountWeight
      );
      return {
        ...record,
        discountedweight: discountedWeight,
        totalprice: roundPrice(discountedWeight * unitPrice)
      };
    })
  };
}

function createSalesSummaryRepository(pool) {
  return {
    async findSummaryByDate(orgid, salesDate) {
      const schema = schemaFromOrgid(orgid);
      try {
        const result = await pool.query(`
          SELECT "summary"
          FROM ${schema}."sales"
          WHERE "date" = $1::date
            AND "summary" IS NOT NULL
          ORDER BY "id" DESC
          LIMIT 1
        `, [salesDate]);
        if (result.rows.length === 0) {
          const error = new Error(
            'No sales summary exists for the supplied date'
          );
          error.code = 'SALES_SUMMARY_NOT_FOUND';
          throw error;
        }
        return result.rows[0].summary;
      } catch (error) {
        if (error.code === '42P01' || error.code === '3F000') {
          const notFound = new Error(
            'The sales table does not exist for the supplied organization'
          );
          notFound.code = 'SALES_TABLE_NOT_FOUND';
          throw notFound;
        }
        throw error;
      }
    },

    async findDataByDate(orgid, purchaseDate) {
      const schema = schemaFromOrgid(orgid);
      let queriedResource = 'discount';
      try {
        const discountResult = await pool.query(`
          SELECT "weight"
          FROM ${schema}."discount"
          WHERE "weight" IS NOT NULL
          ORDER BY "created_at" DESC, "id" DESC
          LIMIT 1
        `);
        if (discountResult.rows.length === 0) {
          const error = new Error('No discount weight is configured');
          error.code = 'DISCOUNT_NOT_FOUND';
          throw error;
        }

        const discountWeight = Number(discountResult.rows[0].weight);
        if (!Number.isFinite(discountWeight) || discountWeight < 0) {
          const error = new Error('Discount weight is not a valid number');
          error.code = 'INVALID_DISCOUNT';
          throw error;
        }

        queriedResource = 'sales';
        const result = await pool.query(`
          SELECT "data"
          FROM ${schema}."sales"
          WHERE "date" = $1::date
          ORDER BY "id"
        `, [purchaseDate]);
        return result.rows.map((row) =>
          applySalesWeightDiscount(row.data, discountWeight)
        );
      } catch (error) {
        if (error.code === '42P01' || error.code === '3F000') {
          const notFound = new Error(
            `The ${queriedResource} table does not exist for the supplied organization`
          );
          notFound.code = queriedResource === 'discount'
            ? 'DISCOUNT_TABLE_NOT_FOUND'
            : 'SALES_TABLE_NOT_FOUND';
          throw notFound;
        }
        throw error;
      }
    },

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

module.exports = {
  applySalesWeightDiscount,
  createSalesSummaryRepository,
  hasWeightDiscount
};
