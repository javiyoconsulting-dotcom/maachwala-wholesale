'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createPurchaseSalesResponseRepository(pool) {
  return {
    async process(message) {
      const buyerSchema = schemaFromOrgid(message.orgid);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const purchaseResult = await client.query(`
          SELECT "id", "fromorg"
          FROM ${buyerSchema}."purchase"
          WHERE "number" = $1::numeric
          ORDER BY "id" DESC
          LIMIT 1
          FOR UPDATE
        `, [message.purchaseNumber]);
        if (purchaseResult.rowCount === 0) {
          const error = new Error(
            'No purchase exists for the supplied purchase number'
          );
          error.code = 'PURCHASE_NOT_FOUND';
          throw error;
        }

        const purchase = purchaseResult.rows[0];
        const sourceOrgid = String(purchase.fromorg ?? '').trim();
        if (!/^\d+$/.test(sourceOrgid)) {
          const error = new Error(
            'The purchase does not contain a valid source organization'
          );
          error.code = 'PURCHASE_SOURCE_ORG_NOT_FOUND';
          throw error;
        }
        const sellerSchema = schemaFromOrgid(sourceOrgid);

        await client.query(`
          UPDATE ${buyerSchema}."purchase"
          SET "status" = 1004
          WHERE "id" = $1
        `, [purchase.id]);
        const allocationResult = await client.query(`
          UPDATE ${sellerSchema}."buyerallocation"
          SET "buyerprice" = $1,
              "buyerweightdiscount" = $2,
              "buyerquantity" = $3
          WHERE "buyerpurchase" = $4::numeric
          RETURNING "id"
        `, [
          message.unitPrice,
          message.weightDiscount,
          message.quantity,
          message.purchaseNumber
        ]);
        if (allocationResult.rowCount === 0) {
          const error = new Error(
            'No buyer allocation exists for the supplied purchase number'
          );
          error.code = 'BUYER_ALLOCATION_NOT_FOUND';
          throw error;
        }

        await client.query('COMMIT');
        return {
          purchaseNumber: message.purchaseNumber,
          buyerOrgid: message.orgid,
          sourceOrgid,
          purchaseStatus: 1004,
          updatedAllocationCount: allocationResult.rowCount
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

module.exports = { createPurchaseSalesResponseRepository };
