'use strict';

const { schemaFromOrgid } = require('./customerRepository');

function createSupplierRepository(pool) {
  return {
    async createMany(orgid, suppliers) {
      const schema = schemaFromOrgid(orgid);
      const names = suppliers.map((supplier) => supplier.name);
      const phones = suppliers.map((supplier) => supplier.phone);
      try {
        const result = await pool.query(`
          INSERT INTO ${schema}."supplier" ("name", "phone")
          SELECT input."name", input."phone"
          FROM unnest($1::text[], $2::numeric[])
            WITH ORDINALITY AS input("name", "phone", "position")
          ORDER BY input."position"
          RETURNING "id"::text AS "id", "name", "phone"::text AS "phone",
                    "created_at" AS "createdAt"
        `, [names, phones]);
        return result.rows;
      } catch (error) {
        if (error.code === '23505') {
          const conflict = new Error(
            'A supplier with one of the supplied phone numbers already exists'
          );
          conflict.code = 'SUPPLIER_PHONE_CONFLICT';
          throw conflict;
        }
        if (error.code === '42P01' || error.code === '3F000') {
          const notFound = new Error(
            'The supplier table does not exist for the supplied organization'
          );
          notFound.code = 'SUPPLIER_TABLE_NOT_FOUND';
          throw notFound;
        }
        throw error;
      }
    },

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
