#!/bin/bash

# Sync gap data (Feb 2, 03:00 - 20:00) from DB_WRITE to DB_READ

DB_WRITE="defiapi-db-write"
DB_READ="defiapi-db-read"
REMOTE="--remote"

START_TS=1770007200  # Feb 2, 2026 03:00:00 UTC
END_TS=1770069600    # Feb 2, 2026 20:00:00 UTC

echo "=========================================="
echo "Sync Gap Data: DB_WRITE → DB_READ"
echo "=========================================="
echo "Period: Feb 2, 03:00 - 20:00, 2026"
echo ""

echo "Checking data in DB_WRITE..."
SOURCE_COUNT=$(npx wrangler d1 execute "$DB_WRITE" $REMOTE --command "
SELECT COUNT(*) as cnt FROM market_history 
WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS
" --json 2>/dev/null | jq -r '.[] | .results[0].cnt' || echo "0")
echo "Records to sync: $SOURCE_COUNT"

if [ "$SOURCE_COUNT" -eq 0 ]; then
  echo "No data to sync."
  exit 0
fi

echo ""
echo "Syncing data..."

# Fetch all data from DB_WRITE
BATCH_DATA=$(npx wrangler d1 execute "$DB_WRITE" $REMOTE --command "
SELECT * FROM market_history 
WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS
ORDER BY hour_timestamp, exchange, symbol
" --json 2>/dev/null)

# Create SQL file
SQL_FILE=$(mktemp)

# Generate INSERT statements
echo "$BATCH_DATA" | jq -r '.[] | .results[] | 
"INSERT OR REPLACE INTO market_history (
  exchange, symbol, normalized_symbol, hour_timestamp,
  avg_mark_price, avg_index_price, avg_funding_rate, avg_funding_rate_annual,
  min_price, max_price, price_volatility,
  volume_base, volume_quote,
  avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
  min_funding_rate, max_funding_rate,
  sample_count, aggregated_at
) VALUES (
  \"\(.exchange)\", \"\(.symbol)\", \"\(.normalized_symbol)\", \(.hour_timestamp),
  \(.avg_mark_price), \(.avg_index_price), \(.avg_funding_rate), \(.avg_funding_rate_annual),
  \(.min_price), \(.max_price), \(.price_volatility),
  \(.volume_base), \(.volume_quote),
  \(.avg_open_interest), \(.avg_open_interest_usd), \(.max_open_interest_usd),
  \(.min_funding_rate), \(.max_funding_rate),
  \(.sample_count), \(.aggregated_at)
);"
' > "$SQL_FILE"

# Execute
if [ -s "$SQL_FILE" ]; then
  RECORD_COUNT=$(wc -l < "$SQL_FILE" | tr -d ' ')
  echo "Syncing $RECORD_COUNT records to DB_READ..."
  npx wrangler d1 execute "$DB_READ" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1
  echo "✓ Sync complete"
  rm -f "$SQL_FILE"
else
  echo "✗ No SQL generated"
  rm -f "$SQL_FILE"
  exit 1
fi

echo ""
echo "Verification:"
npx wrangler d1 execute "$DB_READ" $REMOTE --command "
SELECT exchange, COUNT(*) as records, 
       datetime(MIN(hour_timestamp), 'unixepoch') as first_hour,
       datetime(MAX(hour_timestamp), 'unixepoch') as last_hour
FROM market_history 
WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS
GROUP BY exchange 
ORDER BY exchange
" 2>/dev/null

echo ""
echo "=========================================="
