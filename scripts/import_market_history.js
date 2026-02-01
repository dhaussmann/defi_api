#!/usr/bin/env node

/**
 * Import historical market_history data from DB_READ to DB_WRITE
 * 
 * This script copies all historical data to enable immediate 30-day MA calculations
 * 
 * Usage:
 *   node scripts/import_market_history.js
 */

const BATCH_SIZE = 1000;
const API_BASE = 'https://api.fundingrate.de';

async function importHistoricalData() {
  console.log('🚀 Starting historical data import...');
  console.log(`📊 Batch size: ${BATCH_SIZE} records`);
  
  try {
    // Trigger the import via admin endpoint
    const response = await fetch(`${API_BASE}/api/admin/import-market-history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        batchSize: BATCH_SIZE,
      }),
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Import completed successfully!');
      console.log(`📈 Imported ${result.recordsImported} records`);
      console.log(`⏱️  Duration: ${result.durationMs}ms`);
    } else {
      console.error('❌ Import failed:', result.error);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Error during import:', error);
    process.exit(1);
  }
}

importHistoricalData();
