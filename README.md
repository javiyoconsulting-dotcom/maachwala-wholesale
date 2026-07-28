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

## POST_SALES_DATA Pub/Sub processing

Configure the `POST_SALES_DATA-sub` push subscription to send requests to:

```text
https://YOUR_CLOUD_RUN_URL/pubsub/post-sales-data
```

Publish JSON in the Pub/Sub message data:

```json
{
  "orgid": 767524024827354,
  "date": "2026-07-28"
}
```

The handler:

1. Selects all rows from `<orgid>.sales` for the supplied date.
2. Reads the latest configured `weight` from `<orgid>.discount`.
3. Extracts individual sales records from each `data.rows` JSON array.
4. Groups valid records by supplier and product, case-insensitively.
5. Calculates total sales quantity, average unit price, and weight discount.
6. Keeps the individual sales records inside each group and records malformed
   rows separately.
7. Writes the generated JSON summary to the `summary` column of every matching
   sales row in one database transaction.

The weight-discount formula is:

```text
total quantity - (floor(total quantity) * configured discount weight)
```

For example, quantity `30.8` and discount weight `0.05` produce `29.3`.
Processing is idempotent: Pub/Sub retries replace the same date's summary.

## Notes

- The verified organization schema is `767524024827354`, containing the
  `customers` table with `number`, `name`, and `phone` columns.
- The cache is process-local. For multiple service instances, use Redis so all
  instances share the same cache.
- The schema name is strictly restricted to digits to prevent SQL identifier
  injection.
- The supplied password contains `@`, so it is encoded as `%40` in the URL.
