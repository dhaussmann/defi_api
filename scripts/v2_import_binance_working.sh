#!/bin/bash

# V2 Binance Raw Data Import Script
# Imports historical funding data with automatic interval detection
# Calculates both hourly rate and annualized rate for comparability

set -e

DAYS_BACK=${1:-30}
ACCOUNT_ID="f1c0e3d4e5f6a7b8c9d0e1f2a3b4c5d6"
DB_NAME="defiapi-db-write"

echo "=================================================="
echo "V2 Binance Raw Data Import"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: binance_raw_data table"
echo "=================================================="
echo ""

# Calculate time range (milliseconds)
END_TS=$(date -u +%s)000
START_TS=$((END_TS - DAYS_BACK * 86400 * 1000))

echo "Fetching active perpetual markets from Binance API..."

# Fetch exchange info to get all perpetual contracts
EXCHANGE_INFO=$(curl -s "https://fapi.binance.com/fapi/v1/exchangeInfo")

# Extract perpetual contracts that are TRADING, filter out non-ASCII symbols
SYMBOLS=$(echo "$EXCHANGE_INFO" | jq -r '.symbols[] | select(.contractType == "PERPETUAL" and .status == "TRADING") | "\(.symbol)|\(.baseAsset)|\(.quoteAsset)"' | LC_ALL=C grep -v '[^[:print:]]' || true)

if [ -z "$SYMBOLS" ]; then
  echo "Error: No symbols found"
  exit 1
fi

SYMBOL_COUNT=$(echo "$SYMBOLS" | wc -l | tr -d ' ')
echo "Found ${SYMBOL_COUNT} active perpetual markets"
echo ""

# Update market metadata
echo "Updating market metadata..."
METADATA_SQL=$(mktemp)

echo "$SYMBOLS" | while IFS='|' read -r symbol base_asset quote_asset; do
  cat >> "$METADATA_SQL" <<EOF
INSERT OR REPLACE INTO binance_markets (symbol, base_asset, quote_asset, contract_type, status, last_updated)
VALUES ('${symbol}', '${base_asset}', '${quote_asset}', 'PERPETUAL', 'TRADING', $(date +%s));
EOF
done

npx wrangler d1 execute "$DB_NAME" --remote --file="$METADATA_SQL" > /dev/null 2>&1
rm "$METADATA_SQL"
echo "Market metadata updated"
echo ""

# Fetch funding data for each symbol
echo "Fetching funding data..."
echo "This will take approximately $((SYMBOL_COUNT * 2 / 60)) minutes..."
echo ""

TEMP_SQL=$(mktemp)
COLLECTED_AT=$(date +%s)
TOTAL_RECORDS=0
PROCESSED=0

echo "$SYMBOLS" | while IFS='|' read -r symbol base_asset quote_asset; do
  PROCESSED=$((PROCESSED + 1))
  echo "[$PROCESSED/$SYMBOL_COUNT] Fetching $symbol ($base_asset)..."
  
  # Fetch funding history in chunks (max 1000 per request, 20 days per chunk)
  CHUNK_SIZE=$((20 * 86400 * 1000))
  
  for ((chunk_start=START_TS; chunk_start<END_TS; chunk_start+=CHUNK_SIZE)); do
    chunk_end=$((chunk_start + CHUNK_SIZE))
    if [ $chunk_end -gt $END_TS ]; then
      chunk_end=$END_TS
    fi
    
    FUNDING_DATA=$(curl -s "https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&startTime=${chunk_start}&endTime=${chunk_end}&limit=1000")
    
    # Check if data is valid
    if echo "$FUNDING_DATA" | jq -e 'type == "array"' > /dev/null 2>&1; then
      RECORD_COUNT=$(echo "$FUNDING_DATA" | jq 'length')
      
      if [ "$RECORD_COUNT" -gt 0 ]; then
        # Calculate median interval for this symbol's data
        INTERVALS=$(echo "$FUNDING_DATA" | jq -r '
          [.[] | .fundingTime] as $times |
          [range(1; $times | length) | $times[.] - $times[. - 1]] |
          sort |
          if length > 0 then
            .[length / 2 | floor]
          else
            28800000
          end
        ')
        
        # Convert interval to hours (rounded)
        INTERVAL_HOURS=$(echo "$INTERVALS" | jq -r '. / 3600000 | round')
        
        # Calculate funding events per year
        EVENTS_PER_YEAR=$(echo "$INTERVALS" | jq -r '365 * 24 * 3600000 / .')
        
        # Process each funding record (escape single quotes in SQL)
        echo "$FUNDING_DATA" | jq -r --arg symbol "$symbol" --arg base_asset "$base_asset" --arg collected_at "$COLLECTED_AT" --arg interval_hours "$INTERVAL_HOURS" --arg events_per_year "$EVENTS_PER_YEAR" '
          .[] | 
          . as $item |
          ($item.fundingRate | tonumber) as $rate |
          ($rate * 100) as $rate_percent |
          ($rate_percent / ($interval_hours | tonumber)) as $rate_hourly |
          ($rate_percent * ($events_per_year | tonumber)) as $rate_annual |
          ($symbol | gsub("'\''"; "'\'''\''")) as $safe_symbol |
          ($base_asset | gsub("'\''"; "'\'''\''")) as $safe_base |
          "INSERT OR IGNORE INTO binance_raw_data (symbol, base_asset, timestamp, rate, rate_percent, rate_hourly, rate_annual, funding_interval_hours, collected_at, source) VALUES ('\''\($safe_symbol)'\'', '\''\($safe_base)'\'', \($item.fundingTime), \($rate), \($rate_percent), \($rate_hourly), \($rate_annual), \($interval_hours), \($collected_at), '\''import'\'');"
        ' >> "$TEMP_SQL"
        
        TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
        echo "  → $RECORD_COUNT records (${INTERVAL_HOURS}h interval)"
      fi
    fi
    
    sleep 0.05
  done
done

echo ""
echo "Inserting $TOTAL_RECORDS records into database..."

# Execute batch insert
if [ -s "$TEMP_SQL" ]; then
  npx wrangler d1 execute "$DB_NAME" --remote --file="$TEMP_SQL"
  rm "$TEMP_SQL"
  echo "✓ Import completed successfully"
else
  rm "$TEMP_SQL"
  echo "✗ No data to import"
  exit 1
fi

echo ""
echo "=================================================="
echo "Import Summary"
echo "=================================================="
echo "Total records imported: $TOTAL_RECORDS"
echo "Total symbols: $SYMBOL_COUNT"
echo "Time range: $(date -r $((START_TS / 1000)) '+%Y-%m-%d %H:%M:%S') to $(date -r $((END_TS / 1000)) '+%Y-%m-%d %H:%M:%S')"
echo "=================================================="
