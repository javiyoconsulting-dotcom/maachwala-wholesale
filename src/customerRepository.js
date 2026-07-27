'use strict';

// orgid is strictly validated before interpolation. PostgreSQL identifiers
// cannot be supplied as query parameters, so the schema is double-quoted.
function schemaFromOrgid(orgid) {
  const value = String(orgid);
  if (!/^\d+$/.test(value)) {
    throw new TypeError('orgid must contain digits only');
  }
  return `"${value}"`;
}

function createCustomerRepository(pool) {
  return {
    async findAll(orgid) {
      const schema = schemaFromOrgid(orgid);
      const sql = `
        SELECT "number", "name", "phone"
        FROM ${schema}."customers"
        ORDER BY "number"
      `;
      const result = await pool.query(sql);
      return result.rows;
    }
  };
}

module.exports = { createCustomerRepository, schemaFromOrgid };
