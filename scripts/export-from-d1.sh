#!/bin/bash
# Export funding rate data from source DB and convert to SQL format

set -e

SOURCE_DB="funding-rates-db"
EXCHANGE=$1
TABLE=$2
SYMBOL_COL=$3
START_MS=$4
END_MS=$5

npx wrangler d1 execute "$SOURCE_DB" --remote --json \
  --command "SELECT ${SYMBOL_COL} as symbol, funding_rate, collected_at FROM ${TABLE} WHERE collected_at >= $START_MS AND collected_at < $END_MS ORDER BY collected_at" \
  2>/dev/null | jq -r '
    .[0].results[] |
    "INSERT OR IGNORE INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES (" +
    "\"'"$EXCHANGE"'\", " +
    "\"" + .symbol + "\", " +
    "\"" + .symbol + "\", " +
    (.funding_rate | tostring) + ", " +
    ((.funding_rate * 100) | tostring) + ", " +
    ((.funding_rate * 100 * 3 * 365) | tostring) + ", " +
    (.collected_at | tostring) +
    ");"
  '
