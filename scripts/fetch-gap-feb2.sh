#!/bin/bash

# Fetch missing data for Feb 2, 2026 03:00 - 20:00

START_MS=1770007200000  # Feb 2, 2026 03:00:00 UTC
END_MS=1770069600000    # Feb 2, 2026 20:00:00 UTC

echo "=== Fetching Gap Data: Feb 2, 03:00 - 20:00 ==="
echo ""

# Hyperliquid
echo "[1/5] Fetching Hyperliquid..."
COINS=$(curl -s -X POST https://api.hyperliquid.xyz/info -H "Content-Type: application/json" -d '{"type": "meta"}' | jq -r '.universe[].name' | head -20)
TEMP_SQL="/tmp/gap_hyperliquid.sql"
> "$TEMP_SQL"

for COIN in $COINS; do
  RESPONSE=$(curl -s -X POST https://api.hyperliquid.xyz/info -H "Content-Type: application/json" -d "{\"type\":\"fundingHistory\",\"coin\":\"${COIN}\",\"startTime\":${START_MS}}")
  echo "$RESPONSE" | jq -r ".[] | select(.time >= $START_MS and .time <= $END_MS) | \"INSERT OR REPLACE INTO market_history (exchange, symbol, normalized_symbol, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd) VALUES ('hyperliquid', '${COIN}', '${COIN}', \(.fundingRate | tonumber), \(.fundingRate | tonumber * 3 * 365), \(.fundingRate | tonumber), \(.fundingRate | tonumber), \((.time / 1000) | floor), 1, $(date +%s), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);\"" >> "$TEMP_SQL"
done

if [ -s "$TEMP_SQL" ]; then
  echo "Importing $(wc -l < "$TEMP_SQL") Hyperliquid records..."
  npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1
  rm "$TEMP_SQL"
fi

# Lighter
echo "[2/5] Fetching Lighter..."
MARKETS_JSON=$(curl -s "https://explorer.elliot.ai/api/markets")
TEMP_SQL="/tmp/gap_lighter.sql"
> "$TEMP_SQL"

echo "$MARKETS_JSON" | jq -r 'to_entries[] | "\(.key):\(.value.symbol)"' | head -20 | while IFS=: read -r MARKET_ID SYMBOL; do
  START_S=$((START_MS / 1000))
  END_S=$((END_MS / 1000))
  RESPONSE=$(curl -s "https://mainnet.zklighter.elliot.ai/api/v1/fundings?market_id=${MARKET_ID}&resolution=1h&start_timestamp=${START_S}&end_timestamp=${END_S}&count_back=20")
  echo "$RESPONSE" | jq -r ".fundings[] | select(.timestamp >= $START_S and .timestamp <= $END_S) | \"INSERT OR REPLACE INTO market_history (exchange, symbol, normalized_symbol, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd) VALUES ('lighter', '${SYMBOL}', '${SYMBOL}', \(.rate | tonumber / 100), \(.rate | tonumber / 100 * 24 * 365), \(.rate | tonumber / 100), \(.rate | tonumber / 100), \(.timestamp), 1, $(date +%s), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);\"" >> "$TEMP_SQL"
done

if [ -s "$TEMP_SQL" ]; then
  echo "Importing $(wc -l < "$TEMP_SQL") Lighter records..."
  npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1
  rm "$TEMP_SQL"
fi

# EdgeX
echo "[3/5] Fetching EdgeX..."
CONTRACTS=$(curl -s "https://pro.edgex.exchange/api/v1/public/meta/getMetaData" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"' | head -20)
TEMP_SQL="/tmp/gap_edgex.sql"
> "$TEMP_SQL"

echo "$CONTRACTS" | while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  RESPONSE=$(curl -s "https://pro.edgex.exchange/api/v1/public/funding/getFundingRatePage?contractId=${CONTRACT_ID}&size=100&filterBeginTimeInclusive=${START_MS}&filterEndTimeExclusive=${END_MS}&filterSettlementFundingRate=true")
  echo "$RESPONSE" | jq -c '.data.dataList[]' 2>/dev/null | while read -r RECORD; do
    FUNDING_TIME=$(echo "$RECORD" | jq -r '.fundingTime')
    FUNDING_TS=$((FUNDING_TIME / 1000))
    FUNDING_RATE=$(echo "$RECORD" | jq -r '.fundingRate')
    NORMALIZED_SYMBOL=$(echo "$CONTRACT_NAME" | sed 's/USD$//')
    echo "INSERT OR REPLACE INTO market_history (exchange, symbol, normalized_symbol, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd) VALUES ('edgex', '${CONTRACT_NAME}', '${NORMALIZED_SYMBOL}', ${FUNDING_RATE}, $(echo "$FUNDING_RATE * 6 * 365" | bc -l), ${FUNDING_RATE}, ${FUNDING_RATE}, ${FUNDING_TS}, 1, $(date +%s), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);" >> "$TEMP_SQL"
  done
done

if [ -s "$TEMP_SQL" ]; then
  echo "Importing $(wc -l < "$TEMP_SQL") EdgeX records..."
  npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1
  rm "$TEMP_SQL"
fi

# Extended
echo "[4/5] Fetching Extended..."
MARKETS=("BTC-USD" "ETH-USD" "SOL-USD" "DOGE-USD" "XRP-USD")
TEMP_SQL="/tmp/gap_extended.sql"
> "$TEMP_SQL"

for MARKET in "${MARKETS[@]}"; do
  SYMBOL="${MARKET%-USD}"
  RESPONSE=$(curl -s "https://api.starknet.extended.exchange/api/v1/info/${MARKET}/funding?startTime=${START_MS}&endTime=${END_MS}")
  echo "$RESPONSE" | jq -r ".data[] | \"INSERT OR REPLACE INTO market_history (exchange, symbol, normalized_symbol, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd) VALUES ('extended', '${MARKET}', '${SYMBOL}', \(.f), \(.f | tonumber * 3 * 365), \(.f), \(.f), \((.T / 1000) | floor), 1, $(date +%s), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);\"" >> "$TEMP_SQL"
done

if [ -s "$TEMP_SQL" ]; then
  echo "Importing $(wc -l < "$TEMP_SQL") Extended records..."
  npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1
  rm "$TEMP_SQL"
fi

echo ""
echo "[5/5] Syncing to DB_READ..."
npx wrangler d1 execute defiapi-db-write --remote --command "
SELECT * FROM market_history 
WHERE hour_timestamp >= $((START_MS / 1000)) AND hour_timestamp <= $((END_MS / 1000))
ORDER BY hour_timestamp
" --json | jq -r '.[] | .results[] | 
"INSERT OR REPLACE INTO market_history (exchange, symbol, normalized_symbol, hour_timestamp, avg_mark_price, avg_index_price, avg_funding_rate, avg_funding_rate_annual, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, min_funding_rate, max_funding_rate, sample_count, aggregated_at) VALUES (\"\(.exchange)\", \"\(.symbol)\", \"\(.normalized_symbol)\", \(.hour_timestamp), \(.avg_mark_price), \(.avg_index_price), \(.avg_funding_rate), \(.avg_funding_rate_annual), \(.min_price), \(.max_price), \(.price_volatility), \(.volume_base), \(.volume_quote), \(.avg_open_interest), \(.avg_open_interest_usd), \(.max_open_interest_usd), \(.min_funding_rate), \(.max_funding_rate), \(.sample_count), \(.aggregated_at));"
' > /tmp/gap_sync.sql

if [ -s /tmp/gap_sync.sql ]; then
  npx wrangler d1 execute defiapi-db-read --remote --file=/tmp/gap_sync.sql > /dev/null 2>&1
  echo "✓ Synced to DB_READ"
  rm /tmp/gap_sync.sql
fi

echo ""
echo "=== Done ==="
