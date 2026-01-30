#!/bin/bash

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     2-Database Architecture Setup                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Create Databases in Cloudflare Dashboard${NC}"
echo ""
echo "Please create these databases manually in the Cloudflare Dashboard:"
echo "  https://dash.cloudflare.com → Workers & Pages → D1"
echo ""
echo "  1. Database Name: defiapi-db-write"
echo "     Description: Hot data - tracker writes and aggregates"
echo ""
echo "  2. Database Name: defiapi-db-read"
echo "     Description: API queries - normalized tokens"
echo ""
read -p "Press Enter after you've created both databases..."

echo ""
echo -e "${YELLOW}Step 2: Enter Database IDs${NC}"
echo ""
read -p "Enter defiapi-db-write Database ID: " WRITE_DB_ID
read -p "Enter defiapi-db-read Database ID: " READ_DB_ID

echo ""
echo -e "${YELLOW}Step 3: Updating wrangler.toml...${NC}"

# Backup original wrangler.toml
cp wrangler.toml wrangler.toml.backup
echo -e "${GREEN}✓${NC} Backed up wrangler.toml to wrangler.toml.backup"

# Create new D1 section
cat > /tmp/d1_section.toml << EOF

# D1 Databases - 2-DB Architecture for Load Distribution
[[d1_databases]]
binding = "DB_WRITE"
database_name = "defiapi-db-write"
database_id = "$WRITE_DB_ID"
migrations_dir = "migrations/write"

[[d1_databases]]
binding = "DB_READ"
database_name = "defiapi-db-read"
database_id = "$READ_DB_ID"
migrations_dir = "migrations/read"

# Keep old DB as backup during migration
[[d1_databases]]
binding = "DB"
database_name = "defiapi-db"
database_id = "77ba166f-0989-45d4-aa63-dc4ff0d517cb"
EOF

# Replace D1 section in wrangler.toml
sed -i.tmp '/^# D1 Database$/,/^database_id/d' wrangler.toml
cat /tmp/d1_section.toml >> wrangler.toml
rm /tmp/d1_section.toml wrangler.toml.tmp

echo -e "${GREEN}✓${NC} Updated wrangler.toml with new database bindings"

echo ""
echo -e "${YELLOW}Step 4: Running migrations...${NC}"
echo ""

echo "Migrating DB_WRITE schema..."
wrangler d1 migrations apply defiapi-db-write --remote
echo -e "${GREEN}✓${NC} DB_WRITE schema created"

echo ""
echo "Migrating DB_READ schema..."
wrangler d1 migrations apply defiapi-db-read --remote
echo -e "${GREEN}✓${NC} DB_READ schema created"

echo ""
echo -e "${YELLOW}Step 5: Migrating existing data...${NC}"
echo ""

echo "Exporting normalized_tokens from old DB..."
wrangler d1 execute defiapi-db --remote --command "SELECT COUNT(*) as count FROM normalized_tokens" > /tmp/count.txt
COUNT=$(grep -oP '\d+' /tmp/count.txt | head -1)
echo "Found $COUNT rows in normalized_tokens"

if [ "$COUNT" -gt 0 ]; then
  echo "Copying data to DB_READ..."
  wrangler d1 execute defiapi-db --remote --command "SELECT * FROM normalized_tokens" --json > /tmp/normalized_tokens.json
  
  # Note: This is a simplified approach. For production, use proper SQL export/import
  echo -e "${YELLOW}⚠${NC}  Manual data migration required for large datasets"
  echo "    Run: wrangler d1 execute defiapi-db-read --remote --file=migrations/read/copy_data.sql"
fi

echo ""
echo -e "${GREEN}✓${NC} Migration setup complete!"
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Next Steps                              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "1. Review the changes in wrangler.toml"
echo "2. Deploy the updated worker:"
echo "   ${GREEN}npm run deploy${NC}"
echo ""
echo "3. Restart all trackers:"
echo "   ${GREEN}./restart-trackers.sh${NC}"
echo ""
echo "4. Monitor for 1 hour:"
echo "   ${GREEN}wrangler tail --format pretty${NC}"
echo ""
echo "5. If successful, old DB can be deleted after 7 days"
echo ""
echo -e "${YELLOW}Rollback:${NC} If issues occur, restore wrangler.toml.backup and redeploy"
echo ""
