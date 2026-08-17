CREATE UNIQUE INDEX IF NOT EXISTS supplier_phone_unique_idx
  ON "{{schema}}".supplier (phone)
  WHERE phone IS NOT NULL;
