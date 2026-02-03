#!/bin/bash

# Check MA coverage in both databases

echo "=== Checking MA Coverage ==="
echo ""

echo "[DB_WRITE] Exchanges with BTC MA data:"
npx wrangler d1 execute defiapi-db-write --remote --command "
SELECT DISTINCT exchange 
FROM funding_ma_cache 
WHERE normalized_symbol LIKE '%BTC%' 
ORDER BY exchange
" 2>/dev/null | grep -E "^│" | grep -v "exchange" | grep -v "─" | awk '{print $2}' | grep -v "^$"

echo ""
echo "[DB_READ] Exchanges with BTC MA data:"
npx wrangler d1 execute defiapi-db-read --remote --command "
SELECT DISTINCT exchange 
FROM funding_ma_cache 
WHERE normalized_symbol LIKE '%BTC%' 
ORDER BY exchange
" 2>/dev/null | grep -E "^│" | grep -v "exchange" | grep -v "─" | awk '{print $2}' | grep -v "^$"

echo ""
echo "[DB_WRITE] Total MA records by exchange:"
npx wrangler d1 execute defiapi-db-write --remote --command "
SELECT exchange, COUNT(*) as cnt 
FROM funding_ma_cache 
GROUP BY exchange 
ORDER BY exchange
" 2>/dev/null

echo ""
echo "[DB_READ] Total MA records by exchange:"
npx wrangler d1 execute defiapi-db-read --remote --command "
SELECT exchange, COUNT(*) as cnt 
FROM funding_ma_cache 
GROUP BY exchange 
ORDER BY exchange
" 2>/dev/null
