'use strict';

require('dotenv').config();
const { Client } = require('pg');

const schema = process.argv[2];

if (!/^\d+$/.test(schema || '')) {
  throw new Error('Usage: node database/scripts/inspect-tenant-schema.js <numeric-orgid>');
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        c.relname AS table_name,
        pg_catalog.pg_get_userbyid(c.relowner) AS owner,
        obj_description(c.oid, 'pg_class') AS comment,
        COALESCE((
          SELECT json_agg(json_build_object(
            'position', a.attnum,
            'name', a.attname,
            'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
            'notNull', a.attnotnull,
            'identity', a.attidentity,
            'default', pg_get_expr(ad.adbin, ad.adrelid)
          ) ORDER BY a.attnum)
          FROM pg_attribute a
          LEFT JOIN pg_attrdef ad
            ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
          WHERE a.attrelid = c.oid
            AND a.attnum > 0
            AND NOT a.attisdropped
        ), '[]'::json) AS columns,
        COALESCE((
          SELECT json_agg(json_build_object(
            'name', con.conname,
            'type', con.contype,
            'definition', pg_get_constraintdef(con.oid, true)
          ) ORDER BY con.conname)
          FROM pg_constraint con
          WHERE con.conrelid = c.oid
        ), '[]'::json) AS constraints,
        COALESCE((
          SELECT json_agg(json_build_object(
            'name', i.relname,
            'definition', pg_get_indexdef(i.oid)
          ) ORDER BY i.relname)
          FROM pg_index ix
          JOIN pg_class i ON i.oid = ix.indexrelid
          WHERE ix.indrelid = c.oid
            AND NOT ix.indisprimary
        ), '[]'::json) AS indexes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'p')
      ORDER BY c.relname
    `, [schema]);

    const sequences = await client.query(`
      SELECT sequencename, start_value, min_value, max_value,
             increment_by, cycle, cache_size
      FROM pg_sequences
      WHERE schemaname = $1
      ORDER BY sequencename
    `, [schema]);

    process.stdout.write(`${JSON.stringify({
      schema,
      tables: result.rows,
      sequences: sequences.rows
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
