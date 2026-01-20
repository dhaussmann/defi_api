#!/bin/bash
# Startet 110 parallele Import-Prozesse

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}Paradex Parallel Import (110 Workers)${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Temp Dir
TEMP_DIR=$(mktemp -d)
echo "Temp directory: $TEMP_DIR"

# Hole Markets
echo "Fetching markets..."
MARKETS=$(curl -s "https://api.prod.paradex.trade/v1/markets/summary?market=ALL" | jq -r '.results[] | select(.symbol | endswith("-PERP")) | .symbol' | sort -u)
TOTAL=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "✓ Found $TOTAL markets"
echo ""

echo "Starting $TOTAL parallel workers..."
echo ""

# Starte einen Worker pro Market
IDX=0
while IFS= read -r MARKET; do
  IDX=$((IDX + 1))
  ./import-single-market.sh "$MARKET" "$IDX" "$TOTAL" "$TEMP_DIR" &
done <<< "$MARKETS"

echo "All workers started. Waiting for completion..."
echo ""

# Warte auf alle
wait

echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}Combining SQL files...${NC}"
echo -e "${BLUE}=========================================${NC}"

cat "$TEMP_DIR"/market_*.sql > "$TEMP_DIR/combined.sql" 2>/dev/null

SQL_COUNT=$(grep -c "INSERT" "$TEMP_DIR/combined.sql" 2>/dev/null || echo 0)
echo "Total SQL statements: $SQL_COUNT"

if [ $SQL_COUNT -gt 0 ]; then
  echo ""
  echo "Importing to database..."
  npx wrangler d1 execute defiapi-db --remote --file="$TEMP_DIR/combined.sql"
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Import successful!${NC}"
  else
    echo -e "${RED}✗ Import failed${NC}"
    echo "SQL file: $TEMP_DIR/combined.sql"
    exit 1
  fi
fi

rm -rf "$TEMP_DIR"

echo ""
echo -e "${GREEN}✓ Parallel import complete!${NC}"
