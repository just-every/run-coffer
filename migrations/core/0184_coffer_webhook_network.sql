-- Stable outcomes only; DNS answers and receiver response bodies stay unretained.
ALTER TABLE cf_webhook_attempts ADD COLUMN failure_code TEXT;
ALTER TABLE cf_webhook_deliveries ADD COLUMN last_failure_code TEXT;
