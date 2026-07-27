# wholesellerservice

Node.js microservice for wholesale customer lookup. Each `orgid` is used as a
PostgreSQL schema name and customer records are read from its `customers`
table.

## Google Cloud Functions

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

The exported HTTP entry point is `wholesellerService`. Deploy from the
repository root using Google Cloud Functions (2nd gen):

```bash
gcloud functions deploy wholesellerService \
  --gen2 \
  --runtime=nodejs20 \
  --region=asia-south1 \
  --source=. \
  --entry-point=wholesellerService \
  --trigger-http \
  --set-env-vars=CACHE_TTL_SECONDS=300,DB_SSL=true \
  --set-secrets=DATABASE_URL=wholeseller-database-url:latest
```

Create the `wholeseller-database-url` Secret Manager secret separately. Do not
commit the PostgreSQL URL. For local development, copy `.env.example` to `.env`
and set `DATABASE_URL`; `.env` is ignored by Git.

## Get customers

```bash
curl -X POST http://localhost:3000/wholesale/customers \
  -H "Content-Type: application/json" \
  -d '{"orgid":767524024827354}'
```

Response:

```json
[
  {
    "number": 1,
    "name": "Example Customer",
    "phone": "9999999999"
  }
]
```

`X-Cache` is `MISS` on the database load and `HIT` when served from the
in-memory cache. Cache entries expire after `CACHE_TTL_SECONDS` (default: 300).

## Refresh cache

Either call the dedicated endpoint:

```bash
curl -X POST http://localhost:3000/wholesale/customers/refresh \
  -H "Content-Type: application/json" \
  -d '{"orgid":767524024827354}'
```

Or add `?refresh=true` to the regular endpoint:

```text
POST /wholesale/customers?refresh=true
```

Both options bypass the cached value, reload the table, and replace the cache
entry. The response contains `X-Cache: REFRESH`.

## Notes

- The verified organization schema is `767524024827354`, containing the
  `customers` table with `number`, `name`, and `phone` columns.
- The cache is process-local. For multiple service instances, use Redis so all
  instances share the same cache.
- The schema name is strictly restricted to digits to prevent SQL identifier
  injection.
- The supplied password contains `@`, so it is encoded as `%40` in the URL.
