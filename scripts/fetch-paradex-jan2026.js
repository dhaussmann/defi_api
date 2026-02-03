#!/usr/bin/env node

/**
 * Fetch Paradex funding rates directly from API for Jan 9-29, 2026
 * Uses parallel requests for faster fetching (Rate limit: 300 req/min)
 */

const https = require('https');
const { execSync } = require('child_process');

const TARGET_DB = 'defiapi-db-write';
const START_MS = 1767916800000; // Jan 9, 2026 00:00:00 UTC (CORRECTED)
const END_MS = 1769731199000;   // Jan 29, 2026 23:59:59 UTC (CORRECTED)
const API_BASE = 'api.prod.paradex.trade';
const PARALLEL_REQUESTS = 5; // Parallel requests to speed up

// Get all available markets from Paradex
async function getMarkets() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_BASE,
      port: 443,
      path: '/v1/markets',
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result && result.results) {
            // Filter for PERP markets only
            const perpMarkets = result.results
              .filter(m => m.asset_kind === 'PERP')
              .map(m => m.symbol);
            resolve(perpMarkets);
          } else {
            reject(new Error('Invalid markets response'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

// Fetch funding data for a market in a time range
async function fetchFundingData(market, startTime, endTime) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_BASE,
      port: 443,
      path: `/v1/funding/data?market=${market}&start_time=${startTime}&end_time=${endTime}`,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result && result.results) {
            resolve(result.results);
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

// Process markets in parallel batches
async function processMarketsInParallel(markets, batchSize) {
  const sqlStatements = [];
  let totalRecords = 0;
  let errorCount = 0;

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);
    const promises = batch.map(async (market, idx) => {
      const globalIdx = i + idx;
      const symbol = market.replace('-USD-PERP', '');
      
      try {
        const fundingData = await fetchFundingData(market, START_MS, END_MS);
        
        const statements = [];
        if (fundingData.length > 0) {
          for (const data of fundingData) {
            // API returns: { market, created_at, funding_rate, funding_rate_8h, ... }
            const fundingRate = parseFloat(data.funding_rate);
            const fundingRatePercent = fundingRate * 100;
            const annualizedRate = fundingRate * 365 * 24;
            const timestamp = data.created_at; // Already in milliseconds

            const sql = `INSERT INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES ('paradex', '${symbol}', '${market}', ${fundingRate}, ${fundingRatePercent}, ${annualizedRate}, ${timestamp});`;
            statements.push(sql);
          }
          
          return {
            idx: globalIdx,
            market,
            success: true,
            count: fundingData.length,
            statements
          };
        } else {
          return {
            idx: globalIdx,
            market,
            success: true,
            count: 0,
            statements: []
          };
        }
      } catch (error) {
        return {
          idx: globalIdx,
          market,
          success: false,
          error: error.message,
          statements: []
        };
      }
    });

    const results = await Promise.all(promises);
    
    // Print results in order
    for (const result of results.sort((a, b) => a.idx - b.idx)) {
      process.stdout.write(`[${result.idx + 1}/${markets.length}] ${result.market.padEnd(20)} `);
      
      if (result.success) {
        if (result.count > 0) {
          console.log(`✓ ${result.count} records`);
          sqlStatements.push(...result.statements);
          totalRecords += result.count;
        } else {
          console.log(`⚠ No data`);
        }
      } else {
        console.log(`✗ Error: ${result.error}`);
        errorCount++;
      }
    }

    // Rate limiting: wait between batches (300 req/min = 5 req/sec)
    if (i + batchSize < markets.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return { sqlStatements, totalRecords, errorCount };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Paradex Funding Rate Fetcher ===');
  console.log('');
  console.log('Period: Jan 9-29, 2026');
  console.log('Target: ' + TARGET_DB);
  console.log('');

  // Get available markets
  console.log('Fetching available markets...');
  const markets = await getMarkets();
  console.log(`✓ Found ${markets.length} PERP markets`);
  console.log(`Sample: ${markets.slice(0, 5).join(', ')}...`);
  console.log('');
  console.log(`Using ${PARALLEL_REQUESTS} parallel requests for speed`);
  console.log('');

  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise(resolve => {
    readline.question('Continue? (y/N) ', resolve);
  });
  readline.close();

  if (answer.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    process.exit(0);
  }

  console.log('');
  console.log('Starting data fetch...');
  console.log('');

  const { sqlStatements, totalRecords, errorCount } = await processMarketsInParallel(
    markets,
    PARALLEL_REQUESTS
  );

  console.log('');
  console.log(`=== Fetch Complete ===`);
  console.log(`Total records: ${totalRecords}`);
  console.log(`Errors: ${errorCount}`);
  console.log('');

  if (sqlStatements.length === 0) {
    console.log('❌ No data to import');
    process.exit(1);
  }

  const fs = require('fs');
  const sqlFile = `/tmp/paradex_import_${Date.now()}.sql`;
  fs.writeFileSync(sqlFile, sqlStatements.join('\n'));
  console.log(`✓ Wrote ${sqlStatements.length} SQL statements to ${sqlFile}`);
  console.log('');

  console.log(`Importing to ${TARGET_DB}...`);
  try {
    execSync(`npx wrangler d1 execute ${TARGET_DB} --file ${sqlFile} --remote`, {
      stdio: 'inherit'
    });
    console.log('✓ Import complete');
  } catch (error) {
    console.error('❌ Import failed');
    console.log('SQL file saved at:', sqlFile);
    process.exit(1);
  }

  fs.unlinkSync(sqlFile);
  console.log('');
  console.log('=== Done ===');
  console.log('');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
