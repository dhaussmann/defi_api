# 2-Database Architecture Migration Guide

## Step 1: Create New Databases in Cloudflare Dashboard

Go to: https://dash.cloudflare.com → Workers & Pages → D1

Create two new databases:
1. **defiapi-db-write** (for hot data writes)
2. **defiapi-db-read** (for API reads)

After creation, note down the Database IDs.

## Step 2: Update wrangler.toml

Replace the current D1 database section with:

```toml
# D1 Databases - 2-DB Architecture
[[d1_databases]]
binding = "DB_WRITE"
database_name = "defiapi-db-write"
database_id = "YOUR_WRITE_DB_ID_HERE"
migrations_dir = "migrations/write"

[[d1_databases]]
binding = "DB_READ"
database_name = "defiapi-db-read"
database_id = "YOUR_READ_DB_ID_HERE"
migrations_dir = "migrations/read"

# Keep old DB as backup during migration
[[d1_databases]]
binding = "DB_BACKUP"
database_name = "defiapi-db"
database_id = "77ba166f-0989-45d4-aa63-dc4ff0d517cb"
```

## Step 3: Run Migrations

```bash
# Migrate DB_WRITE schema
wrangler d1 migrations apply defiapi-db-write --remote

# Migrate DB_READ schema
wrangler d1 migrations apply defiapi-db-read --remote
```

## Step 4: Initial Data Migration

Copy current normalized_tokens data to DB_READ:

```bash
# Export from old DB
wrangler d1 execute defiapi-db --remote --command "SELECT * FROM normalized_tokens" > /tmp/normalized_tokens.sql

# Import to DB_READ
wrangler d1 execute defiapi-db-read --remote --file=/tmp/normalized_tokens.sql
```

## Step 5: Deploy

```bash
npm run deploy
# or
wrangler deploy
```

## Step 6: Restart All Trackers

```bash
# Script to restart all trackers
for exchange in lighter paradex hyperliquid edgex aster pacifica extended hyena xyz flx vntl km variational; do
  echo "Restarting $exchange..."
  curl -X POST "https://api.fundingrate.de/tracker/$exchange/stop"
  sleep 2
  curl -X POST "https://api.fundingrate.de/tracker/$exchange/start"
done
```

## Step 7: Monitor

```bash
# Watch logs
wrangler tail --format pretty

# Check tracker status
curl https://api.fundingrate.de/api/tracker-status

# Test API
curl https://api.fundingrate.de/api/markets?limit=10
```

## Rollback Plan

If issues occur:

1. Update wrangler.toml to use DB_BACKUP as DB
2. Redeploy: `wrangler deploy`
3. Restart trackers

## Database Responsibilities

### DB_WRITE (Hot Data)
- `market_stats` - 15-second snapshots from trackers
- `market_stats_1m` - 1-minute aggregates
- `market_stats_1h` - Hourly aggregates  
- `tracker_status` - Tracker health status

**Usage**: Only tracker writes + aggregation

### DB_READ (API Optimized)
- `normalized_tokens` - Current market data for API

**Usage**: Only API read queries

### DB_BACKUP (Old, Keep for 7 days)
- Full backup of old single-DB architecture
- Can be deleted after successful migration
