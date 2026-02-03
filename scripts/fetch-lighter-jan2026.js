#!/usr/bin/env node

/**
 * Fetch Lighter funding rates for Jan 9-29, 2026
 * Imports directly to market_history with hourly aggregation
 */

const https = require('https');
const { execSync } = require('child_process');

const TARGET_DB = 'defiapi-db-write';
const START_MS = 1736380800000;
const END_MS = 1738195199000;
const API_BASE = 'mainnet.zklighter.elliot.ai';
const PARALLEL_REQUESTS = 10; // Lighter has higher rate limits

// Get all available markets
async function getMarkets() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_BASE,
      port: 443,
      path: '/api/markets',
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result && Array.isArray(result)) {
            const perpMarkets = result
              .filter(m => m.type === 'PERP' || m.symbol.includes('PERP'))
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

// Fetch funding rates for a market
async function fetchFundingRates(market, startTime, endTime) {
  return new Promise((resolve, reject) => {
    const startSeconds = Math.floor(startTime / 1000);
    const endSeconds = Math.floor(endTime / 1000);
    
    const options = {
      hostname: API_BASE,
      port: 443,
      path: `/api/funding-rates?market=${market}&start=${startSeconds}&end=${endSeconds}`,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result && Array.isArray(result)) {
            resolve(result);
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

// Group funding rates by hour and create aggregated records
function aggregateToHourly(fundingRates, exchange, symbol, tradingPair) {
  const hourlyGroups = {};
  
  for (const rate of fundingRates) {
    const timestamp = rate.timestamp || rate.time || rate.created_at;
    const hourTimestamp = Math.floor(timestamp / 3600000) * 3600;
    
    if (!hourlyGroups[hourTimestamp]) {
      hourlyGroups[hourTimestamp] = [];
    }
    
    const fundingRate = parseFloat(rate.funding_rate || rate.rate || rate.fundingRate);
    hourlyGroups[hourTimestamp].push(fundingRate);
  }
  
  const sqlStatements = [];
  const aggregatedAt = Math.floor(Date.now() / 1000);
  
  for (const hourTimestamp in hourlyGroups) {
    const rates = hourlyGroups[hourTimestamp];
    const avg_funding_rate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const avg_funding_rate_annual = avg_funding_rate * 365 * 24;
    const min_funding_rate = Math.min(...rates);
    const max_funding_rate = Math.max(...rates);
    const sample_count = rates.length;
    
    const sql = `INSERT INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES ('${exchange}', '${tradingPair}', '${symbol}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ${avg_funding_rate}, ${avg_funding_rate_annual}, ${min_funding_rate}, ${max_funding_rate}, ${hourTimestamp}, ${sample_count}, ${aggregatedAt});`;
    
    sqlStatements.push(sql);
  }
  
  return sqlStatements;
}

// Process markets in parallel
async function processMarketsInParallel(markets, batchSize) {
  const sqlStatements = [];
  let totalRecords = 0;
  let errorCount = 0;

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);
    const promises = batch.map(async (market, idx) => {
      const globalIdx = i + idx;
      const symbol = market.replace('-PERP', '').replace('PERP', '');
      
      try {
        const fundingRates = await fetchFundingRates(market, START_MS, END_MS);
        
        if (fundingRates.length > 0) {
          const statements = aggregateToHourly(fundingRates, 'lighter', symbol, market);
          
          return {
            idx: globalIdx,
            market,
            success: true,
            count: statements.length,
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
    
    for (const result of results.sort((a, b) => a.idx - b.idx)) {
      process.stdout.write(`[${result.idx + 1}/${markets.length}] ${result.market.padEnd(20)} `);
      
      if (result.success) {
        if (result.count > 0) {
          console.log(`✓ ${result.count} hourly records`);
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

    if (i + batchSize < markets.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return { sqlStatements, totalRecords, errorCount };
}

async function main() {
  console.log('=== Lighter Funding Rate Fetcher ===');
  console.log('');
  console.log('Period: Jan 9-29, 2026');
  console.log('Target: ' + TARGET_DB);
  console.log('');

  console.log('Fetching available markets...');
  const markets = await getMarkets();
  console.log(`✓ Found ${markets.length} PERP markets`);
  console.log(`Sample: ${markets.slice(0, 5).join(', ')}...`);
  console.log('');
  console.log(`Using ${PARALLEL_REQUESTS} parallel requests`);
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
  console.log(`Total hourly records: ${totalRecords}`);
  console.log(`Errors: ${errorCount}`);
  console.log('');

  if (sqlStatements.length === 0) {
    console.log('❌ No data to import');
    process.exit(1);
  }

  const fs = require('fs');
  const sqlFile = `/tmp/lighter_import_${Date.now()}.sql`;
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
