#!/bin/bash
# Copy normalized_tokens from old DB to DB_READ

echo "Copying normalized_tokens from defiapi-db to defiapi-db-read..."

# Export all normalized_tokens
wrangler d1 execute defiapi-db --remote --command "SELECT * FROM normalized_tokens" --json > /tmp/normalized_tokens_export.json

# Count records
COUNT=$(cat /tmp/normalized_tokens_export.json | jq '.[0].results | length')
echo "Found $COUNT records to copy"

# Create SQL insert statements
cat /tmp/normalized_tokens_export.json | jq -r '.[0].results[] | 
  "INSERT OR REPLACE INTO normalized_tokens (symbol, exchange, original_symbol, mark_price, index_price, open_interest_usd, volume_24h, funding_rate, funding_rate_hourly, funding_rate_annual, funding_interval_hours, next_funding_time, price_change_24h, price_low_24h, price_high_24h, volatility_24h, volatility_7d, atr_14, bb_width, updated_at) VALUES (\"\(.symbol)\", \"\(.exchange)\", \"\(.original_symbol)\", \(.mark_price), \(.index_price), \(.open_interest_usd), \(.volume_24h), \(.funding_rate), \(.funding_rate_hourly), \(.funding_rate_annual), \(.funding_interval_hours), \(.next_funding_time // "NULL"), \(.price_change_24h), \(.price_low_24h), \(.price_high_24h), \(.volatility_24h // "NULL"), \(.volatility_7d // "NULL"), \(.atr_14 // "NULL"), \(.bb_width // "NULL"), \(.updated_at));"
' > /tmp/normalized_tokens_insert.sql

echo "Generated SQL insert statements"
echo "Importing to DB_READ (this may take a while)..."

# Import in batches of 100
split -l 100 /tmp/normalized_tokens_insert.sql /tmp/batch_
for batch in /tmp/batch_*; do
  echo -n "."
  wrangler d1 execute defiapi-db-read --remote --file="$batch" > /dev/null 2>&1
done
echo ""

# Verify
IMPORTED=$(wrangler d1 execute defiapi-db-read --remote --command "SELECT COUNT(*) as count FROM normalized_tokens" --json | jq '.[0].results[0].count')
echo "✓ Imported $IMPORTED records to DB_READ"

# Cleanup
rm -f /tmp/normalized_tokens_export.json /tmp/normalized_tokens_insert.sql /tmp/batch_*
