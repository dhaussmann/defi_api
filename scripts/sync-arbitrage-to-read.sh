#!/bin/bash

# Sync arbitrage and MA cache data from DB_WRITE to DB_READ

DB_WRITE="defiapi-db-write"
DB_READ="defiapi-db-read"
REMOTE="--remote"

echo "=========================================="
echo "Sync Arbitrage Data: DB_WRITE → DB_READ"
echo "=========================================="
echo ""

# Check if tables exist in DB_READ
echo "[1/4] Checking tables in DB_READ..."
TABLES=$(npx wrangler d1 execute "$DB_READ" $REMOTE --command "SELECT name FROM sqlite_master WHERE type='table' AND (name='arbitrage_cache' OR name='funding_ma_cache')" --json 2>/dev/null | jq -r '.[] | .results[] | .name' | tr '\n' ' ')

if [[ ! "$TABLES" =~ "arbitrage_cache" ]] || [[ ! "$TABLES" =~ "funding_ma_cache" ]]; then
  echo "⚠️  Tables missing in DB_READ. Creating tables..."
  
  # Create funding_ma_cache table
  npx wrangler d1 execute "$DB_READ" $REMOTE --command "
  CREATE TABLE IF NOT EXISTS funding_ma_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_symbol TEXT NOT NULL,
    exchange TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    avg_funding_rate REAL,
    avg_funding_rate_annual REAL,
    sample_count INTEGER,
    calculated_at INTEGER,
    UNIQUE(normalized_symbol, exchange, timeframe)
  )" > /dev/null 2>&1
  
  # Create arbitrage_cache table
  npx wrangler d1 execute "$DB_READ" $REMOTE --command "
  CREATE TABLE IF NOT EXISTS arbitrage_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    long_exchange TEXT NOT NULL,
    short_exchange TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    long_rate REAL,
    short_rate REAL,
    spread REAL,
    long_apr REAL,
    short_apr REAL,
    spread_apr REAL,
    stability_score INTEGER,
    is_stable INTEGER,
    calculated_at INTEGER,
    UNIQUE(symbol, long_exchange, short_exchange, timeframe)
  )" > /dev/null 2>&1
  
  echo "✓ Tables created"
else
  echo "✓ Tables exist"
fi

echo ""
echo "[2/4] Syncing funding_ma_cache..."
MA_COUNT=$(npx wrangler d1 execute "$DB_WRITE" $REMOTE --command "SELECT COUNT(*) as cnt FROM funding_ma_cache" --json 2>/dev/null | jq -r '.[] | .results[0].cnt' || echo "0")
echo "Records to sync: $MA_COUNT"

if [ "$MA_COUNT" -gt 0 ]; then
  # Fetch all MA data
  MA_DATA=$(npx wrangler d1 execute "$DB_WRITE" $REMOTE --command "SELECT * FROM funding_ma_cache ORDER BY normalized_symbol, exchange, timeframe" --json 2>/dev/null)
  
  # Create SQL file
  SQL_FILE=$(mktemp)
  
  echo "$MA_DATA" | jq -r '.[] | .results[] | 
  "INSERT OR REPLACE INTO funding_ma_cache (normalized_symbol, exchange, timeframe, avg_funding_rate, avg_funding_rate_annual, sample_count, calculated_at) VALUES (\"\(.normalized_symbol)\", \"\(.exchange)\", \"\(.timeframe)\", \(.avg_funding_rate), \(.avg_funding_rate_annual), \(.sample_count), \(.calculated_at));"
  ' > "$SQL_FILE"
  
  if [ -s "$SQL_FILE" ]; then
    RECORD_COUNT=$(wc -l < "$SQL_FILE" | tr -d ' ')
    echo "Syncing $RECORD_COUNT MA records..."
    npx wrangler d1 execute "$DB_READ" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1
    echo "✓ MA cache synced"
    rm -f "$SQL_FILE"
  fi
fi

echo ""
echo "[3/4] Syncing arbitrage_cache..."
ARB_COUNT=$(npx wrangler d1 execute "$DB_WRITE" $REMOTE --command "SELECT COUNT(*) as cnt FROM arbitrage_cache" --json 2>/dev/null | jq -r '.[] | .results[0].cnt' || echo "0")
echo "Records to sync: $ARB_COUNT"

if [ "$ARB_COUNT" -gt 0 ]; then
  # Fetch all arbitrage data
  ARB_DATA=$(npx wrangler d1 execute "$DB_WRITE" $REMOTE --command "SELECT * FROM arbitrage_cache ORDER BY symbol, timeframe, spread_apr DESC" --json 2>/dev/null)
  
  # Create SQL file
  SQL_FILE=$(mktemp)
  
  echo "$ARB_DATA" | jq -r '.[] | .results[] | 
  "INSERT OR REPLACE INTO arbitrage_cache (symbol, long_exchange, short_exchange, timeframe, long_rate, short_rate, spread, long_apr, short_apr, spread_apr, stability_score, is_stable, calculated_at) VALUES (\"\(.symbol)\", \"\(.long_exchange)\", \"\(.short_exchange)\", \"\(.timeframe)\", \(.long_rate), \(.short_rate), \(.spread), \(.long_apr), \(.short_apr), \(.spread_apr), \(.stability_score), \(.is_stable), \(.calculated_at));"
  ' > "$SQL_FILE"
  
  if [ -s "$SQL_FILE" ]; then
    RECORD_COUNT=$(wc -l < "$SQL_FILE" | tr -d ' ')
    echo "Syncing $RECORD_COUNT arbitrage records..."
    npx wrangler d1 execute "$DB_READ" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1
    echo "✓ Arbitrage cache synced"
    rm -f "$SQL_FILE"
  fi
fi

echo ""
echo "[4/4] Verification..."
npx wrangler d1 execute "$DB_READ" $REMOTE --command "
SELECT 'funding_ma_cache' as table_name, COUNT(*) as records FROM funding_ma_cache
UNION ALL
SELECT 'arbitrage_cache' as table_name, COUNT(*) as records FROM arbitrage_cache
" 2>/dev/null

echo ""
echo "=========================================="
echo "Sync completed successfully"
echo "=========================================="
