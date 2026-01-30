#!/bin/bash

# Automated code migration to 2-DB architecture
# This script updates all code references from env.DB to env.DB_WRITE or env.DB_READ

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Code Migration to 2-DB Architecture                    ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Backup
echo "Creating backups..."
cp src/index.ts src/index.ts.backup
find src -name "*Tracker.ts" -exec cp {} {}.backup \;
echo "✓ Backups created"
echo ""

echo "Migration Summary:"
echo "  - Trackers: env.DB → env.DB_WRITE (for market_stats writes)"
echo "  - API endpoints: env.DB → env.DB_READ (for normalized_tokens reads)"
echo "  - Aggregation: Uses both DB_WRITE (source) and DB_READ (target)"
echo ""

# List of tracker files
TRACKERS=(
  "src/LighterTracker.ts"
  "src/ParadexTracker.ts"
  "src/HyperliquidTracker.ts"
  "src/EdgeXTracker.ts"
  "src/AsterTracker.ts"
  "src/PacificaTracker.ts"
  "src/ExtendedTracker.ts"
  "src/HyENATracker.ts"
  "src/XYZTracker.ts"
  "src/FLXTracker.ts"
  "src/VNTLTracker.ts"
  "src/KMTracker.ts"
  "src/VariationalTracker.ts"
)

echo "Step 1: Updating tracker files to use DB_WRITE..."
for tracker in "${TRACKERS[@]}"; do
  if [ -f "$tracker" ]; then
    # Replace env.DB with env.DB_WRITE for writes
    sed -i.tmp 's/this\.env\.DB\.prepare/this.env.DB_WRITE.prepare/g' "$tracker"
    sed -i.tmp 's/await env\.DB\.prepare/await env.DB_WRITE.prepare/g' "$tracker"
    rm "$tracker.tmp" 2>/dev/null || true
    echo "  ✓ Updated $(basename $tracker)"
  fi
done
echo ""

echo "Step 2: Updating index.ts..."
echo "  Note: This requires manual review for complex queries"
echo "  - API reads (getAllMarkets, etc.) → DB_READ"
echo "  - Aggregation queries → DB_WRITE (source) + DB_READ (target)"
echo "  - Tracker status → DB_WRITE"
echo ""
echo "  Please review src/index.ts manually and update:"
echo "    - getAllMarkets() → env.DB_READ"
echo "    - getAvailableTokens() → env.DB_READ"
echo "    - aggregateMarketStats() → env.DB_WRITE (read) + DB_WRITE (write aggregates)"
echo "    - updateNormalizedTokens() → env.DB_WRITE (read) + env.DB_READ (write)"
echo ""

echo "Step 3: Key changes needed in index.ts:"
cat << 'EOF'

// Example changes:

// OLD: API endpoint
const result = await env.DB.prepare(`SELECT * FROM normalized_tokens...`);

// NEW: API endpoint
const result = await env.DB_READ.prepare(`SELECT * FROM normalized_tokens...`);

// OLD: Aggregation
const source = await env.DB.prepare(`SELECT * FROM market_stats...`);
await env.DB.prepare(`INSERT INTO market_stats_1m...`);

// NEW: Aggregation
const source = await env.DB_WRITE.prepare(`SELECT * FROM market_stats...`);
await env.DB_WRITE.prepare(`INSERT INTO market_stats_1m...`);

// OLD: Update normalized_tokens
const source = await env.DB.prepare(`SELECT * FROM market_stats...`);
await env.DB.prepare(`INSERT OR REPLACE INTO normalized_tokens...`);

// NEW: Update normalized_tokens (cross-DB)
const source = await env.DB_WRITE.prepare(`SELECT * FROM market_stats...`);
await env.DB_READ.prepare(`INSERT OR REPLACE INTO normalized_tokens...`);

EOF

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Manual Steps Required                   ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "1. Review and update src/index.ts manually:"
echo "   - Search for 'env.DB.prepare' and update based on context"
echo "   - API reads → env.DB_READ"
echo "   - Writes/aggregation → env.DB_WRITE"
echo ""
echo "2. Test changes:"
echo "   npm run build"
echo ""
echo "3. If errors, restore backups:"
echo "   cp src/index.ts.backup src/index.ts"
echo "   find src -name '*.backup' -exec bash -c 'mv \"\$0\" \"\${0%.backup}\"' {} \;"
echo ""
