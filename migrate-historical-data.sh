#!/bin/bash
# Migrate historical normalized_tokens data from old DB to DB_READ

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Migrate Historical Data: DB → DB_READ                  ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check counts
echo "Checking current data counts..."
OLD_COUNT=$(wrangler d1 execute defiapi-db --remote --command "SELECT COUNT(*) as count FROM normalized_tokens" --json | jq -r '.[0].results[0].count')
NEW_COUNT=$(wrangler d1 execute defiapi-db-read --remote --command "SELECT COUNT(*) as count FROM normalized_tokens" --json | jq -r '.[0].results[0].count')

echo -e "${YELLOW}Old DB (defiapi-db):${NC} $OLD_COUNT records"
echo -e "${YELLOW}New DB (defiapi-db-read):${NC} $NEW_COUNT records"
echo ""

if [ "$OLD_COUNT" -le "$NEW_COUNT" ]; then
  echo -e "${GREEN}✓${NC} DB_READ already has all or more data than old DB. No migration needed."
  exit 0
fi

MISSING=$((OLD_COUNT - NEW_COUNT))
echo -e "${YELLOW}⚠${NC} Missing $MISSING records in DB_READ"
echo ""

# Export data from old DB
echo "Step 1: Exporting data from old DB..."
wrangler d1 execute defiapi-db --remote --command "SELECT * FROM normalized_tokens" --json > /tmp/old_db_export.json

if [ ! -s /tmp/old_db_export.json ]; then
  echo -e "${RED}✗${NC} Export failed or empty"
  exit 1
fi

EXPORTED=$(jq '.[0].results | length' /tmp/old_db_export.json)
echo -e "${GREEN}✓${NC} Exported $EXPORTED records"
echo ""

# Convert to SQL INSERT statements (in batches to avoid D1 limits)
echo "Step 2: Converting to SQL INSERT statements..."
BATCH_SIZE=50
TOTAL_BATCHES=$(( (EXPORTED + BATCH_SIZE - 1) / BATCH_SIZE ))

echo "Processing $TOTAL_BATCHES batches of $BATCH_SIZE records each..."
echo ""

for ((batch=0; batch<TOTAL_BATCHES; batch++)); do
  START=$((batch * BATCH_SIZE))
  END=$((START + BATCH_SIZE))
  
  echo -n "Batch $((batch + 1))/$TOTAL_BATCHES... "
  
  # Generate INSERT statements for this batch
  SQL="BEGIN TRANSACTION;"
  
  jq -r --argjson start $START --argjson end $END '
    .[0].results[$start:$end][] |
    "INSERT OR REPLACE INTO normalized_tokens (
      id, symbol, exchange, original_symbol, mark_price, index_price,
      open_interest_usd, volume_24h, funding_rate, funding_rate_hourly,
      funding_rate_annual, funding_interval_hours, next_funding_time,
      price_change_24h, price_low_24h, price_high_24h, volatility_24h,
      volatility_7d, atr_14, bb_width, updated_at
    ) VALUES (
      \(.id // "NULL"),
      \"\(.symbol)\",
      \"\(.exchange)\",
      \"\(.original_symbol)\",
      \(.mark_price),
      \(.index_price),
      \(.open_interest_usd),
      \(.volume_24h),
      \(.funding_rate),
      \(.funding_rate_hourly),
      \(.funding_rate_annual),
      \(.funding_interval_hours // 1),
      \(.next_funding_time // "NULL"),
      \(.price_change_24h),
      \(.price_low_24h),
      \(.price_high_24h),
      \(.volatility_24h // "NULL"),
      \(.volatility_7d // "NULL"),
      \(.atr_14 // "NULL"),
      \(.bb_width // "NULL"),
      \(.updated_at)
    );"
  ' /tmp/old_db_export.json >> /tmp/batch_$batch.sql
  
  echo "COMMIT;" >> /tmp/batch_$batch.sql
  
  # Execute batch
  if wrangler d1 execute defiapi-db-read --remote --file=/tmp/batch_$batch.sql > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
  else
    echo -e "${RED}✗${NC}"
    echo "Error executing batch $((batch + 1)). Continuing..."
  fi
  
  # Clean up batch file
  rm -f /tmp/batch_$batch.sql
  
  # Small delay to avoid rate limiting
  sleep 0.5
done

echo ""

# Verify migration
echo "Step 3: Verifying migration..."
FINAL_COUNT=$(wrangler d1 execute defiapi-db-read --remote --command "SELECT COUNT(*) as count FROM normalized_tokens" --json | jq -r '.[0].results[0].count')

echo -e "${YELLOW}Final count in DB_READ:${NC} $FINAL_COUNT records"
echo ""

if [ "$FINAL_COUNT" -ge "$OLD_COUNT" ]; then
  echo -e "${GREEN}✓ Migration successful!${NC}"
  echo ""
  echo "Summary:"
  echo "  Old DB: $OLD_COUNT records"
  echo "  New DB: $FINAL_COUNT records"
  echo "  Migrated: $((FINAL_COUNT - NEW_COUNT)) records"
else
  echo -e "${YELLOW}⚠ Migration incomplete${NC}"
  echo "  Expected: $OLD_COUNT records"
  echo "  Got: $FINAL_COUNT records"
  echo "  Missing: $((OLD_COUNT - FINAL_COUNT)) records"
fi

# Cleanup
rm -f /tmp/old_db_export.json

echo ""
echo "Done!"
