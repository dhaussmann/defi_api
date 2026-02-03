#!/usr/bin/env node

// Sync Jan 9-29, 2026 data from DB_WRITE to DB_READ
// Uses wrangler d1 execute for batch operations

const { execSync } = require('child_process');

const START_TS = 1767916800; // Jan 9, 2026 00:00:00 UTC
const END_TS = 1769731199;   // Jan 29, 2026 23:59:59 UTC
const BATCH_SIZE = 10000;    // Records per batch

console.log('=== Sync Jan 2026 Data to DB_READ ===\n');

// Get total count
console.log('Counting records to sync...');
const countResult = execSync(
  `npx wrangler d1 execute defiapi-db-write --remote --command "SELECT COUNT(*) as count FROM market_history WHERE hour_timestamp >= ${START_TS} AND hour_timestamp <= ${END_TS}" --json`,
  { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
);

const countData = JSON.parse(countResult);
const totalRecords = countData[0]?.results?.[0]?.count || 0;

console.log(`✓ Found ${totalRecords.toLocaleString()} records to sync\n`);

if (totalRecords === 0) {
  console.log('No data to sync');
  process.exit(0);
}

const totalBatches = Math.ceil(totalRecords / BATCH_SIZE);
let synced = 0;

console.log(`Starting sync in ${totalBatches} batches of ${BATCH_SIZE} records...\n`);

for (let batch = 0; batch < totalBatches; batch++) {
  const offset = batch * BATCH_SIZE;
  
  console.log(`[${batch + 1}/${totalBatches}] Batch ${batch + 1} (offset: ${offset})...`);
  
  try {
    // Export from DB_WRITE
    const exportResult = execSync(
      `npx wrangler d1 execute defiapi-db-write --remote --command "SELECT exchange, symbol, normalized_symbol, hour_timestamp, min_price, max_price, avg_mark_price, avg_index_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, sample_count, aggregated_at FROM market_history WHERE hour_timestamp >= ${START_TS} AND hour_timestamp <= ${END_TS} ORDER BY hour_timestamp, exchange, symbol LIMIT ${BATCH_SIZE} OFFSET ${offset}" --json`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );
    
    const exportData = JSON.parse(exportResult);
    const records = exportData[0]?.results || [];
    
    if (records.length === 0) {
      console.log('  ⚠ No more records');
      break;
    }
    
    // Generate SQL for import
    const sqlStatements = records.map(r => {
      const escape = (val) => {
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') return val;
        return `'${String(val).replace(/'/g, "''")}'`;
      };
      
      return `INSERT OR REPLACE INTO market_history (exchange, symbol, normalized_symbol, hour_timestamp, min_price, max_price, avg_mark_price, avg_index_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, sample_count, aggregated_at) VALUES (${escape(r.exchange)}, ${escape(r.symbol)}, ${escape(r.normalized_symbol || r.symbol)}, ${r.hour_timestamp}, ${escape(r.min_price)}, ${escape(r.max_price)}, ${escape(r.avg_mark_price)}, ${escape(r.avg_index_price)}, ${escape(r.price_volatility || 0)}, ${escape(r.volume_base)}, ${escape(r.volume_quote)}, ${escape(r.avg_open_interest)}, ${escape(r.avg_open_interest_usd)}, ${escape(r.max_open_interest_usd)}, ${escape(r.avg_funding_rate)}, ${escape(r.avg_funding_rate_annual)}, ${escape(r.min_funding_rate)}, ${escape(r.max_funding_rate)}, ${escape(r.sample_count || 1)}, ${escape(r.aggregated_at || Math.floor(Date.now() / 1000))});`;
    }).join('\n');
    
    // Write to temp file
    const tempFile = `/tmp/sync_batch_${batch}.sql`;
    require('fs').writeFileSync(tempFile, sqlStatements);
    
    // Import to DB_READ (with auto-confirm)
    execSync(
      `yes | npx wrangler d1 execute defiapi-db-read --remote --file="${tempFile}"`,
      { encoding: 'utf-8', stdio: 'inherit', shell: '/bin/bash' }
    );
    
    // Cleanup
    require('fs').unlinkSync(tempFile);
    
    synced += records.length;
    console.log(`  ✓ Synced ${records.length} records (total: ${synced}/${totalRecords})\n`);
    
  } catch (error) {
    console.error(`  ❌ Error in batch ${batch + 1}:`, error.message);
    process.exit(1);
  }
}

console.log('=== Sync Complete ===');
console.log(`Total synced: ${synced.toLocaleString()} records`);
console.log('');
