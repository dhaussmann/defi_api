#!/usr/bin/env node

/**
 * Fetch Hyperliquid funding rates with parallel requests for speed
 */

const https = require('https');
const { execSync } = require('child_process');

const TARGET_DB = 'defiapi-db-write';
const START_MS = 1767916800000; // Jan 9, 2026 00:00:00 UTC
const END_MS = 1769731199000;   // Jan 29, 2026 23:59:59 UTC
const PARALLEL_LIMIT = 50; // Process 50 requests in parallel

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateHourlyTimestamps(startMs, endMs) {
  const timestamps = [];
  const hourMs = 60 * 60 * 1000;
  
  for (let ts = startMs; ts <= endMs; ts += hourMs) {
    timestamps.push(ts);
  }
  
  return timestamps;
}

async function fetchFundingRate(coin, timestamp) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      type: 'fundingHistory',
      coin: coin,
      startTime: timestamp,
      endTime: timestamp + 3600000
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
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result && result.length > 0 ? result[0] : null);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getAvailableCoins() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ type: 'meta' });

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
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const coins = result.universe.map(u => u.name);
          resolve(coins);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function processBatch(tasks, limit) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(task => task().catch(e => null)));
    results.push(...batchResults);
    
    // Small delay between batches to respect rate limits
    if (i + limit < tasks.length) {
      await sleep(100);
    }
  }
  return results;
}

(async () => {
  console.log('=== Hyperliquid Funding Rate Fetcher (Parallel) ===');
  console.log('');
  console.log('Period: Jan 9-29, 2026');
  console.log('');

  console.log('Fetching available coins...');
  const coins = await getAvailableCoins();
  console.log(`✓ Found ${coins.length} coins`);
  console.log('');

  const timestamps = generateHourlyTimestamps(START_MS, END_MS);
  console.log(`✓ Generated ${timestamps.length} hourly timestamps`);
  console.log('');

  const totalRequests = coins.length * timestamps.length;
  console.log(`Total API requests: ${totalRequests}`);
  console.log(`Parallel limit: ${PARALLEL_LIMIT} requests at a time`);
  console.log('');

  console.log('Starting parallel data fetch...');
  console.log('');

  const sqlStatements = [];
  let processedCoins = 0;

  for (const coin of coins) {
    processedCoins++;
    process.stdout.write(`[${processedCoins}/${coins.length}] ${coin.padEnd(15)} `);

    // Create tasks for all timestamps for this coin
    const tasks = timestamps.map(timestamp => () => fetchFundingRate(coin, timestamp));
    
    // Process in parallel batches
    const results = await processBatch(tasks, PARALLEL_LIMIT);
    
    let coinSuccess = 0;
    let coinErrors = 0;

    results.forEach((data, idx) => {
      if (data && data.fundingRate !== undefined) {
        const fundingRate = parseFloat(data.fundingRate);
        const fundingRatePercent = fundingRate * 100;
        const annualizedRate = fundingRate * 365 * 24;
        const timestamp = timestamps[idx];

        const sql = `INSERT INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES ('hyperliquid', '${coin}', '${coin}', ${fundingRate}, ${fundingRatePercent}, ${annualizedRate}, ${timestamp});`;
        sqlStatements.push(sql);
        coinSuccess++;
      } else {
        coinErrors++;
      }
    });

    console.log(`✓ ${coinSuccess} records (${coinErrors} errors)`);
  }

  console.log('');
  console.log('=== Fetch Complete ===');
  console.log(`Total records: ${sqlStatements.length}`);
  console.log('');

  if (sqlStatements.length === 0) {
    console.log('❌ No data to import');
    process.exit(1);
  }

  const fs = require('fs');
  const sqlFile = `/tmp/hyperliquid_parallel_${Date.now()}.sql`;
  fs.writeFileSync(sqlFile, sqlStatements.join('\n'));
  console.log(`✓ Wrote ${sqlStatements.length} SQL statements to ${sqlFile}`);
  console.log('');

  console.log(`Importing to ${TARGET_DB}...`);
  try {
    execSync(`npx wrangler d1 execute ${TARGET_DB} --file ${sqlFile} --remote`, {
      stdio: 'inherit'
    });
    console.log('✓ Import complete');
    fs.unlinkSync(sqlFile);
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.log('SQL file saved at:', sqlFile);
    process.exit(1);
  }

  console.log('');
  console.log('=== Done ===');
})();
