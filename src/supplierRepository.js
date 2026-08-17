'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createSupplierRepository(pool) {
  return {
    async findAll(orgid) {
      const schema = schemaFromOrgid(orgid);
      try {
        const result = await pool.query(`
          SELECT "name", "phone"::text AS "phone"
          FROM ${schema}."supplier"
          ORDER BY "name" NULLS LAST, "id"
        `);
        return result.rows;
      } catch (error) {
        if (error.code === '42P01' || error.code === '3F000') {
          const notFound = new Error(
            'The supplier table does not exist for the supplied organization'
          );
          notFound.code = 'SUPPLIER_TABLE_NOT_FOUND';
          throw notFound;
        }
        throw error;
      }
    }
  };
}

module.exports = { createSupplierRepository };
