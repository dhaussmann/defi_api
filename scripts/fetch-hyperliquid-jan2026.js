#!/usr/bin/env node

/**
 * Fetch Hyperliquid funding rates directly from API for Jan 9-29, 2026
 * Fetches hourly data (24 values per day per token)
 */

const https = require('https');
const { execSync } = require('child_process');

const TARGET_DB = 'defiapi-db-write';

// Jan 9, 2026 00:00:00 UTC = 1736380800000 ms
// Jan 29, 2026 23:59:59 UTC = 1738195199000 ms
const START_MS = 1736380800000;
const END_MS = 1738195199000;

// Generate hourly timestamps
function generateHourlyTimestamps(startMs, endMs) {
  const timestamps = [];
  const hourMs = 60 * 60 * 1000;
  
  for (let ts = startMs; ts <= endMs; ts += hourMs) {
    timestamps.push(ts);
  }
  
  return timestamps;
}

// Fetch funding rate from Hyperliquid API
async function fetchFundingRate(coin, timestamp) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      type: 'fundingHistory',
      coin: coin,
      startTime: timestamp,
      endTime: timestamp + 3600000 // +1 hour
    });

    const options = {
      hostname: 'api.hyperliquid.xyz',
      port: 443,
      path: '/info',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result && result.length > 0) {
            resolve(result[0]);
          } else {
            resolve(null);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

// Get all available coins from Hyperliquid
async function getAvailableCoins() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      type: 'meta'
    });

    const options = {
      hostname: 'api.hyperliquid.xyz',
      port: 443,
      path: '/info',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result && result.universe) {
            const coins = result.universe.map(u => u.name);
            resolve(coins);
          } else {
            reject(new Error('No universe data'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main execution
async function main() {
  console.log('=== Hyperliquid Funding Rate Fetcher ===');
  console.log('');
  console.log('Period: Jan 9-29, 2026 (hourly data)');
  console.log('Target: ' + TARGET_DB);
  console.log('');

  // Get available coins
  console.log('Fetching available coins...');
  const coins = await getAvailableCoins();
  console.log(`✓ Found ${coins.length} coins: ${coins.slice(0, 10).join(', ')}${coins.length > 10 ? '...' : ''}`);
  console.log('');

  // Generate hourly timestamps
  const timestamps = generateHourlyTimestamps(START_MS, END_MS);
  console.log(`✓ Generated ${timestamps.length} hourly timestamps`);
  console.log('');

  const totalRequests = coins.length * timestamps.length;
  console.log(`Total API requests: ${totalRequests}`);
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

  let successCount = 0;
  let errorCount = 0;
  const sqlStatements = [];

  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    process.stdout.write(`[${i + 1}/${coins.length}] ${coin.padEnd(15)} `);

    let coinSuccess = 0;
    let coinErrors = 0;

    for (const timestamp of timestamps) {
      try {
        const data = await fetchFundingRate(coin, timestamp);
        
        if (data && data.fundingRate !== undefined) {
          const fundingRate = parseFloat(data.fundingRate);
          const fundingRatePercent = fundingRate * 100;
          const annualizedRate = fundingRate * 365 * 24;

          const sql = `INSERT INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES ('hyperliquid', '${coin}', '${coin}', ${fundingRate}, ${fundingRatePercent}, ${annualizedRate}, ${timestamp});`;
          sqlStatements.push(sql);
          
          coinSuccess++;
          successCount++;
        } else {
          coinErrors++;
          errorCount++;
        }

        // Rate limiting: 10 requests per second max
        await sleep(100);
      } catch (error) {
        coinErrors++;
        errorCount++;
      }
    }

    console.log(`✓ ${coinSuccess} records (${coinErrors} errors)`);
  }

  console.log('');
  console.log(`=== Fetch Complete ===`);
  console.log(`Success: ${successCount} records`);
  console.log(`Errors: ${errorCount}`);
  console.log('');

  if (sqlStatements.length === 0) {
    console.log('❌ No data to import');
    process.exit(1);
  }

  // Write SQL to file
  const fs = require('fs');
  const sqlFile = `/tmp/hyperliquid_import_${Date.now()}.sql`;
  fs.writeFileSync(sqlFile, sqlStatements.join('\n'));
  console.log(`✓ Wrote ${sqlStatements.length} SQL statements to ${sqlFile}`);
  console.log('');

  // Import to database
  console.log(`Importing to ${TARGET_DB}...`);
  try {
    execSync(`npx wrangler d1 execute ${TARGET_DB} --file ${sqlFile} --remote`, {
      stdio: 'inherit'
    });
    console.log('✓ Import complete');
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.log('SQL file saved at:', sqlFile);
    process.exit(1);
  }

  // Cleanup
  fs.unlinkSync(sqlFile);

  console.log('');
  console.log('=== Done ===');
  console.log('');
  console.log('Next steps:');
  console.log('1. Aggregate to market_history:');
  console.log('   curl -X POST "https://api.fundingrate.de/api/admin/aggregate-history"');
  console.log('');
  console.log('2. Sync to DB_READ:');
  console.log('   curl -X POST "https://api.fundingrate.de/api/admin/sync-db?start=1736380800&limit=1000"');
  console.log('');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
