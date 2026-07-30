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

## Create customers

Use strings for `orgid` and `phone` so JSON clients do not lose numeric
precision or leading zeroes:

```bash
curl -X POST https://YOUR_CLOUD_RUN_URL/wholesale/createcustomers \
  -H "Content-Type: application/json" \
  -d '{
    "orgid": "767524024827354",
    "customers": [
      {
        "name": "Asha Das",
        "phone": "9876543210"
      },
      {
        "name": "Bina Roy",
        "phone": "9876543211"
      }
    ]
  }'
```

A successful atomic batch insert returns HTTP `201`:

```json
{
  "status": "success",
  "requestId": "fcb274d1-fc5b-4a03-a2c6-ab682fb294f1",
  "orgid": "767524024827354",
  "insertedCount": 2,
  "customers": [
    {
      "id": "10277",
      "number": "10277",
      "name": "Asha Das",
      "phone": "9876543210",
      "createdAt": "2026-07-28T15:00:00.000Z"
    }
  ]
}
```

Validation and technical errors use one structure:

```json
{
  "status": "error",
  "requestId": "fcb274d1-fc5b-4a03-a2c6-ab682fb294f1",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid customer data",
    "details": [
      {
        "index": 0,
        "field": "phone",
        "message": "phone must contain 6 to 15 digits"
      }
    ]
  }
}
```

The endpoint accepts 1–500 customers and inserts all records in one transaction.
It assigns the first new `number` as `MAX(customers.number) + 1`, increments
subsequent records in the same batch by one, and keeps `id` equal to `number`.
A transaction-level organization lock prevents concurrent batches from
allocating duplicate numbers, and the existing number sequence is synchronized
after each insert for compatibility with legacy writers. The organization
customer cache is cleared after success. The endpoint handles malformed JSON,
oversized payloads, invalid fields, missing schema resources, conflicts,
database type errors, temporary database failures, and unexpected failures with
appropriate HTTP status codes.

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

## POST_SALES_DATA_Sub_Customer processing

Configure `POST_SALES_DATA_Sub_Customer` as a push subscription targeting:

```text
https://YOUR_CLOUD_RUN_URL/pubsub/post-sales-data-customer
```

The Pub/Sub message data is:

```json
{
  "orgid": "767524024827354",
  "date": "2026-07-29"
}
```

Each sales record must contain an explicit credit/debit marker using one of:

```json
{
  "transactionType": "credit"
}
```

```json
{
  "paymentType": "debit"
}
```

Boolean or `y` markers in `credit` and `debit` are also accepted when exactly
one is set. The consumer never interprets `weightdiscount` as a payment type.

For every customer ID, the consumer creates or updates one `payment` record.
The boolean columns reflect the customer's overall net position after
processing: `credit=true` when total credit exceeds total debit, `debit=true`
when total debit exceeds total credit, and both are false when the balance is
zero. Monetary balances and the per-fish purchase ledger are stored in
`payment.data`:

```json
{
  "orgid": "767524024827354",
  "customerId": "10014",
  "creditTotal": 350,
  "debitTotal": 50,
  "netBalance": 300,
  "transactions": [
    {
      "transactionKey": "6:note_1_line_1",
      "salesDate": "2026-07-29",
      "customerId": "10014",
      "customerName": "Altab",
      "fish": "Rui",
      "supplier": "Skj",
      "quantity": 3,
      "unitPrice": 220,
      "weightDiscountApplied": true,
      "weightDiscountPerKg": 0.05,
      "weightDiscountQuantity": 0.15,
      "billableQuantity": 2.85,
      "totalAmount": 627,
      "transactionType": "credit",
      "creditAmount": 627,
      "debitAmount": 0
    }
  ],
  "lastProcessedDate": "2026-07-29"
}
```

The calculation starts with the existing totals in `payment.data`, adds every
new credit or debit sale, creates a payment row when the customer is absent,
and updates it when present. A deterministic transaction key prevents Pub/Sub
redelivery from adding the same sale twice. Malformed records are reported by
count and skipped without blocking valid customer records.

## Notes

- The verified organization schema is `767524024827354`, containing the
  `customers` table with `number`, `name`, and `phone` columns.
- The cache is process-local. For multiple service instances, use Redis so all
  instances share the same cache.
- The schema name is strictly restricted to digits to prevent SQL identifier
  injection.
- The supplied password contains `@`, so it is encoded as `%40` in the URL.
