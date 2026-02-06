/**
 * EdgeX V3 Collector
 * 
 * Collects funding rate data from EdgeX exchange using unified V3 schema.
 * 
 * API Structure:
 * - Metadata Endpoint: https://pro.edgex.exchange/api/v1/public/meta/getMetaData
 * - Funding Endpoint: https://pro.edgex.exchange/api/v1/public/funding/getLatestFundingRate?contractId={id}
 * - Rate format: decimal (e.g., 0.00005000 for 4h)
 * - Interval: 4 hours (240 minutes)
 */

import { getExchangeConfig, calculateRates, validateRate } from './ExchangeConfig';

const EXCHANGE_NAME = 'edgex';
const CONFIG = getExchangeConfig(EXCHANGE_NAME);

interface Env {
  DB_WRITE: D1Database;
}

interface EdgeXContract {
  contractId: string;
  contractName: string;
  enableDisplay: boolean;
  fundingRateIntervalMin: string;
}

interface EdgeXMetadataResponse {
  code: string;
  data: {
    contractList: EdgeXContract[];
  };
}

interface EdgeXFundingData {
  contractId: string;
  fundingRate: string;
  forecastFundingRate: string;
  fundingTime: string;
}

interface EdgeXFundingResponse {
  code: string;
  data: EdgeXFundingData[];
}

/**
 * Fetch all active contracts from EdgeX
 */
async function fetchEdgeXContracts(): Promise<EdgeXContract[]> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/meta/getMetaData`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch EdgeX contracts: ${response.status}`);
  }
  
  const data = await response.json() as EdgeXMetadataResponse;
  
  if (data.code !== 'SUCCESS' || !data.data?.contractList) {
    throw new Error('Invalid EdgeX metadata response');
  }
  
  // Filter only enabled contracts
  return data.data.contractList.filter(c => c.enableDisplay === true);
}

/**
 * Fetch funding rate for a specific contract
 */
async function fetchContractFundingRate(contractId: string): Promise<EdgeXFundingData | null> {
  const response = await fetch(
    `${CONFIG.apiBaseUrl}/funding/getLatestFundingRate?contractId=${contractId}`,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    }
  );
  
  if (!response.ok) {
    console.warn(`[V3 EdgeX] Failed to fetch funding for contract ${contractId}: ${response.status}`);
    return null;
  }
  
  const data = await response.json() as EdgeXFundingResponse;
  
  if (data.code !== 'SUCCESS' || !data.data || data.data.length === 0) {
    return null;
  }
  
  return data.data[0];
}

/**
 * Main collection function - called by hourly cron
 */
export async function collectEdgeXV3(env: Env): Promise<void> {
  console.log('[V3 EdgeX] Starting collection');
  const collectedAt = Math.floor(Date.now() / 1000);
  
  try {
    // Fetch all active contracts
    const contracts = await fetchEdgeXContracts();
    console.log(`[V3 EdgeX] Found ${contracts.length} active contracts`);
    
    if (contracts.length === 0) {
      console.log('[V3 EdgeX] No contracts found');
      return;
    }
    
    // Fetch funding rates for all contracts
    const statements: any[] = [];
    let successCount = 0;
    let failCount = 0;
    
    for (const contract of contracts) {
      try {
        const fundingData = await fetchContractFundingRate(contract.contractId);
        
        if (!fundingData) {
          failCount++;
          continue;
        }
        
        const symbol = contract.contractName;
        const baseAsset = symbol.replace('USD', '');
        
        // Parse funding rate - already in decimal format for 4h
        const rateRaw = parseFloat(fundingData.fundingRate || '0');
        
        // Parse interval from contract metadata (in minutes)
        const intervalMinutes = parseInt(contract.fundingRateIntervalMin || '240');
        const intervalHours = Math.round(intervalMinutes / 60);
        
        // Calculate rates using config system
        const rates = calculateRates(rateRaw, intervalHours, EXCHANGE_NAME);
        
        // Validate rate
        const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
        if (!validation.valid) {
          console.error(`[V3 EdgeX] Invalid rate for ${symbol}: ${validation.message}`);
          failCount++;
          continue;
        }
        if (validation.warning) {
          console.warn(`[V3 EdgeX] Warning for ${symbol}: ${validation.message}`);
        }
        
        // Use current timestamp as funding_time
        const fundingTime = collectedAt;
        
        statements.push(
          env.DB_WRITE.prepare(`
            INSERT OR REPLACE INTO edgex_funding_v3 
            (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            symbol,
            baseAsset,
            fundingTime,
            rates.rateRaw,
            rates.rateRawPercent,
            intervalHours,
            rates.rate1hPercent,
            rates.rateApr,
            collectedAt,
            'api'
          )
        );
        
        successCount++;
        
      } catch (error) {
        console.error(`[V3 EdgeX] Error fetching contract ${contract.contractId}:`, error);
        failCount++;
      }
    }
    
    // Batch insert all records
    if (statements.length > 0) {
      await env.DB_WRITE.batch(statements);
      console.log(`[V3 EdgeX] Successfully inserted ${statements.length} records (${successCount} success, ${failCount} failed)`);
    } else {
      console.log('[V3 EdgeX] No valid records to insert');
    }
    
  } catch (error) {
    console.error('[V3 EdgeX] Collection failed:', error);
    throw error;
  }
}

/**
 * Import historical funding rates for EdgeX
 * Fetches all funding rates and aggregates hourly
 */
export async function importEdgeXV3(env: Env, daysBack: number = 30): Promise<number> {
  console.log(`[V3 EdgeX Import] Starting historical import for last ${daysBack} days`);
  
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - (daysBack * 24 * 60 * 60);
  const startMs = startTime * 1000;
  const endMs = now * 1000;
  
  // Fetch all contracts
  const metaResponse = await fetch('https://pro.edgex.exchange/api/v1/public/meta/getMetaData');
  if (!metaResponse.ok) {
    throw new Error(`Failed to fetch EdgeX metadata: ${metaResponse.status}`);
  }
  
  const metaData = await metaResponse.json() as EdgeXMetadataResponse;
  if (metaData.code !== 'SUCCESS') {
    throw new Error('EdgeX metadata API returned error');
  }
  
  const activeContracts = metaData.data.contractList.filter(c => c.enableDisplay);
  console.log(`[V3 EdgeX Import] Found ${activeContracts.length} active contracts`);
  
  let totalRecords = 0;
  const collectedAt = Math.floor(Date.now() / 1000);
  
  // Process each contract sequentially to avoid rate limiting
  for (let i = 0; i < activeContracts.length; i++) {
    const contract = activeContracts[i];
    const baseAsset = contract.contractName.replace(/USD$/, '');
    
    console.log(`[V3 EdgeX Import] [${i + 1}/${activeContracts.length}] Processing ${contract.contractName}...`);
    
    try {
      // Fetch all funding rates for this contract in the time range
      const fundingRates: Array<{timestamp: number, rate: number}> = [];
      let offsetData = '';
      let page = 0;
      const maxPages = 50;
      
      while (page < maxPages) {
        let url = `https://pro.edgex.exchange/api/v1/public/funding/getFundingRatePage?contractId=${contract.contractId}&size=1000`;
        url += `&filterBeginTimeInclusive=${startMs}&filterEndTimeExclusive=${endMs}`;
        if (offsetData) {
          url += `&offsetData=${offsetData}`;
        }
        
        const response = await fetch(url);
        if (!response.ok) break;
        
        const data = await response.json() as any;
        if (data.code !== 'SUCCESS' || !data.data?.dataList || data.data.dataList.length === 0) {
          break;
        }
        
        // Extract funding rates
        for (const item of data.data.dataList) {
          fundingRates.push({
            timestamp: parseInt(item.fundingTimestamp),
            rate: parseFloat(item.fundingRate)
          });
        }
        
        offsetData = data.data.nextPageOffsetData || '';
        if (!offsetData) break;
        page++;
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (fundingRates.length === 0) {
        console.log(`[V3 EdgeX Import] ${contract.contractName}: No data`);
        continue;
      }
      
      // Aggregate by hour
      const hourlyData = new Map<number, {sum: number, count: number}>();
      for (const item of fundingRates) {
        const hourTs = Math.floor(item.timestamp / 1000 / 3600) * 3600;
        const existing = hourlyData.get(hourTs) || {sum: 0, count: 0};
        existing.sum += item.rate;
        existing.count += 1;
        hourlyData.set(hourTs, existing);
      }
      
      // Insert hourly aggregates
      const statements = [];
      for (const [hourTs, data] of hourlyData) {
        const avgRate = data.sum / data.count;
        const rates = calculateRates(avgRate, 4, EXCHANGE_NAME); // EdgeX uses 4-hour intervals
        
        statements.push(
          env.DB_WRITE.prepare(`
            INSERT OR REPLACE INTO edgex_funding_v3 
            (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            contract.contractName,
            baseAsset,
            hourTs,
            rates.rateRaw,
            rates.rateRawPercent,
            4, // EdgeX uses 4-hour intervals
            rates.rate1hPercent,
            rates.rateApr,
            collectedAt,
            'import'
          )
        );
      }
      
      if (statements.length > 0) {
        await env.DB_WRITE.batch(statements);
        totalRecords += statements.length;
        console.log(`[V3 EdgeX Import] ${contract.contractName}: ${fundingRates.length} rates → ${statements.length} hours`);
      }
      
      // Delay between contracts to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`[V3 EdgeX Import] Error processing ${contract.contractName}:`, error);
    }
  }
  
  console.log(`[V3 EdgeX Import] Import completed: ${totalRecords} total records from ${activeContracts.length} contracts`);
  return totalRecords;
}
