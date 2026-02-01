#!/usr/bin/env node

/**
 * Fix avg_funding_rate_annual in market_history for Variational
 * Updates historical data with correct annualized rates based on funding_interval_hours
 */

const VARIATIONAL_API = 'https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats';
const API_BASE = 'https://api.fundingrate.de';

async function main() {
  console.log('[Fix] Fetching Variational market intervals...');
  
  // Fetch current intervals from API
  const response = await fetch(VARIATIONAL_API);
  const data = await response.json();
  
  if (!data.listings || !Array.isArray(data.listings)) {
    throw new Error('Invalid API response');
  }
  
  console.log(`[Fix] Found ${data.listings.length} markets`);
  
  // Group symbols by funding interval
  const intervalGroups = {
    1: [],  // 1h = 3600s
    2: [],  // 2h = 7200s
    4: [],  // 4h = 14400s
    8: []   // 8h = 28800s
  };
  
  for (const listing of data.listings) {
    const symbol = listing.ticker;
    const intervalSeconds = parseInt(listing.funding_interval_s || '28800');
    const intervalHours = intervalSeconds / 3600;
    
    if (intervalGroups[intervalHours]) {
      intervalGroups[intervalHours].push(symbol);
    }
  }
  
  console.log('\n[Fix] Interval distribution:');
  console.log(`  1h: ${intervalGroups[1].length} symbols`);
  console.log(`  2h: ${intervalGroups[2].length} symbols`);
  console.log(`  4h: ${intervalGroups[4].length} symbols`);
  console.log(`  8h: ${intervalGroups[8].length} symbols`);
  
  // Update market_history for each interval group
  let totalUpdated = 0;
  
  for (const [hours, symbols] of Object.entries(intervalGroups)) {
    if (symbols.length === 0) continue;
    
    const intervalHours = parseInt(hours);
    const multiplier = (24 / intervalHours) * 365 * 100;
    
    console.log(`\n[Fix] Updating ${symbols.length} symbols with ${intervalHours}h interval (multiplier: ${multiplier})...`);
    
    // Process in batches of 50 symbols
    const BATCH_SIZE = 50;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const symbolList = batch.map(s => `'${s}'`).join(',');
      
      const sql = `
        UPDATE market_history 
        SET avg_funding_rate_annual = avg_funding_rate * ${multiplier}
        WHERE exchange = 'variational' 
          AND symbol IN (${symbolList})
      `;
      
      // Execute via wrangler
      const { execSync } = require('child_process');
      try {
        const result = execSync(
          `wrangler d1 execute defiapi-db-write --remote --command="${sql.replace(/\n/g, ' ').replace(/\s+/g, ' ')}"`,
          { encoding: 'utf-8', stdio: 'pipe' }
        );
        
        // Parse the output to get number of changes
        const match = result.match(/(\d+)\s+row/i);
        const changes = match ? parseInt(match[1]) : 0;
        totalUpdated += changes;
        
        console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: Updated ${changes} records`);
      } catch (error) {
        console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: Error - ${error.message}`);
      }
    }
  }
  
  console.log(`\n[Fix] ✅ Total records updated: ${totalUpdated}`);
  
  // Trigger MA cache recalculation
  console.log('\n[Fix] Triggering MA cache recalculation...');
  const cacheResponse = await fetch(`${API_BASE}/api/admin/cache-ma`, { method: 'POST' });
  const cacheResult = await cacheResponse.json();
  console.log(`[Fix] ${cacheResult.message}`);
  
  console.log('\n[Fix] Done! ✅');
}

main().catch(error => {
  console.error('[Fix] Error:', error);
  process.exit(1);
});
