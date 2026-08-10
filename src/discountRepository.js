'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createDiscountRepository(pool) {
  return {
    async findAll(orgid) {
      const schema = schemaFromOrgid(orgid);
      try {
        const result = await pool.query(`
          SELECT *
          FROM ${schema}."discount"
          ORDER BY "id"
        `);
        return result.rows;
      } catch (error) {
        if (error.code === '42P01' || error.code === '3F000') {
          const notFound = new Error(
            'The discount table does not exist for the supplied organization'
          );
          notFound.code = 'DISCOUNT_TABLE_NOT_FOUND';
          throw notFound;
        }
        throw error;
      }
    }
  };
}

module.exports = { createDiscountRepository };
