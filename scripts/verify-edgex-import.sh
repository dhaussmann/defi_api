#!/bin/bash

# EdgeX Import Verification Script
# =================================

DB_NAME="defiapi-db"
REMOTE="--remote"

echo "=========================================="
echo "EdgeX Import Verification"
echo "=========================================="
echo ""

# 1. Overall statistics
echo "[1] Gesamtstatistik für EdgeX:"
echo "------------------------------"
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT
  COUNT(DISTINCT symbol) as total_symbols,
  COUNT(*) as total_hours,
  datetime(MIN(hour_timestamp), 'unixepoch') as earliest_data,
  datetime(MAX(hour_timestamp), 'unixepoch') as latest_data
FROM market_history
WHERE exchange = 'edgex'
" --json | jq -r '.[] | .results[] | "  Symbole: \(.total_symbols)\n  Stunden: \(.total_hours)\n  Älteste Daten: \(.earliest_data)\n  Neueste Daten: \(.latest_data)"'

echo ""

# 2. Data per symbol (top 10)
echo "[2] Top 10 Symbole nach Datenmenge:"
echo "------------------------------------"
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT
  symbol,
  COUNT(*) as hours,
  datetime(MIN(hour_timestamp), 'unixepoch') as first,
  datetime(MAX(hour_timestamp), 'unixepoch') as last
FROM market_history
WHERE exchange = 'edgex'
GROUP BY symbol
ORDER BY hours DESC
LIMIT 10
" --json | jq -r '.[] | .results[] | "  \(.symbol): \(.hours) Stunden (\(.first) bis \(.last))"'

echo ""

# 3. Recent data check
echo "[3] Aktuelle Daten (letzte 24 Stunden):"
echo "----------------------------------------"
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT
  COUNT(DISTINCT symbol) as symbols,
  COUNT(*) as hours,
  datetime(MIN(hour_timestamp), 'unixepoch') as earliest,
  datetime(MAX(hour_timestamp), 'unixepoch') as latest
FROM market_history
WHERE exchange = 'edgex'
  AND hour_timestamp > unixepoch('now') - 86400
" --json | jq -r '.[] | .results[] | "  Symbole: \(.symbols)\n  Stunden: \(.hours)\n  Von: \(.earliest)\n  Bis: \(.latest)"'

echo ""

# 4. Sample data from BTC
echo "[4] Beispieldaten für BTCUSD (letzte 5 Stunden):"
echo "-------------------------------------------------"
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT
  datetime(hour_timestamp, 'unixepoch') as hour,
  avg_mark_price as price,
  avg_funding_rate as funding_rate,
  avg_funding_rate_annual as funding_apr,
  sample_count
FROM market_history
WHERE exchange = 'edgex' AND symbol = 'BTCUSD'
ORDER BY hour_timestamp DESC
LIMIT 5
" --json | jq -r '.[] | .results[] | "  \(.hour): $\(.price) | FR: \(.funding_rate) (\(.funding_apr)% APR) | Samples: \(.sample_count)"'

echo ""

# 5. Gaps check
echo "[5] Prüfung auf Datenlücken (größer als 2 Stunden):"
echo "----------------------------------------------------"
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
WITH hourly_data AS (
  SELECT
    symbol,
    hour_timestamp,
    LAG(hour_timestamp) OVER (PARTITION BY symbol ORDER BY hour_timestamp) as prev_hour
  FROM market_history
  WHERE exchange = 'edgex'
)
SELECT
  symbol,
  datetime(prev_hour, 'unixepoch') as gap_start,
  datetime(hour_timestamp, 'unixepoch') as gap_end,
  (hour_timestamp - prev_hour) / 3600 as hours_gap
FROM hourly_data
WHERE (hour_timestamp - prev_hour) > 7200
ORDER BY hours_gap DESC
LIMIT 10
" --json | jq -r '.[] | .results[] | "  \(.symbol): \(.gap_start) → \(.gap_end) (\(.hours_gap) Stunden)"'

echo ""

# 6. Data quality check
echo "[6] Datenqualität (NULL-Werte):"
echo "--------------------------------"
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT
  COUNT(*) as total_rows,
  SUM(CASE WHEN avg_mark_price IS NULL THEN 1 ELSE 0 END) as null_price,
  SUM(CASE WHEN avg_funding_rate IS NULL THEN 1 ELSE 0 END) as null_funding,
  SUM(CASE WHEN avg_mark_price = 0 THEN 1 ELSE 0 END) as zero_price
FROM market_history
WHERE exchange = 'edgex'
" --json | jq -r '.[] | .results[] | "  Gesamt: \(.total_rows) Zeilen\n  NULL Preise: \(.null_price)\n  NULL Funding Rates: \(.null_funding)\n  Zero Preise: \(.zero_price)"'

echo ""
echo "=========================================="
echo "Verification completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
