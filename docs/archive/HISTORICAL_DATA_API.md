# Historical Data API Documentation

## Overview

This document describes the available API endpoints for accessing historical funding rate data from various exchanges. These endpoints are used by scanners and data analysis tools to retrieve historical data.

---

## 📊 Available API Endpoints

### 1. **Funding Rate History** `/api/funding-history`

**Purpose:** Get historical funding rate data for a specific symbol across exchanges.

**Method:** `GET`

**Query Parameters:**
- `symbol` (required): Trading symbol (e.g., `BTC`, `ETH`)
- `exchange` (optional): Filter by specific exchange
- `from` (optional): Start timestamp in milliseconds
- `to` (optional): End timestamp in milliseconds
- `interval` (optional): Data interval (`1h`, `4h`, `1d`) - default: `1h`
- `limit` (optional): Maximum number of records (max: 5000) - default: 500

**Data Sources:**
1. `funding_rate_history` table - Imported historical data (V2 collectors)
2. `market_history` table - Aggregated tracker data (hourly aggregates from `market_stats`)

**Example Request:**
```bash
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/funding-history?symbol=BTC&exchange=hyperliquid&from=1767225600000&to=1770360000000&limit=1000"
```

**Response Format:**
```json
{
  "success": true,
  "data": [
    {
      "exchange": "hyperliquid",
      "symbol": "BTC",
      "trading_pair": "BTC-USD",
      "funding_rate": 0.0000125,
      "funding_rate_percent": 0.00125,
      "annualized_rate": 10.95,
      "collected_at": 1767225600000,
      "timestamp": "2026-01-01T00:00:00.000Z"
    }
  ],
  "stats": {
    "count": 856,
    "avg_rate": 12.34,
    "min_rate": -5.67,
    "max_rate": 45.89,
    "time_range": {
      "from": "2026-01-01T00:00:00.000Z",
      "to": "2026-02-06T06:00:00.000Z"
    }
  },
  "meta": {
    "symbol": "BTC",
    "exchange": "hyperliquid",
    "interval": "1h",
    "limit": 1000
  }
}
```

---

### 2. **Market History** `/api/market-history`

**Purpose:** Get aggregated hourly market data including prices, volume, OI, and funding rates.

**Method:** `GET`

**Query Parameters:**
- `symbol` (optional): Trading symbol
- `exchange` (optional): Filter by exchange
- `from` (optional): Start timestamp in milliseconds
- `to` (optional): End timestamp in milliseconds
- `limit` (optional): Maximum records - default: 1000
- `metric` (optional): Filter metrics (`all`, `price`, `volume`, `oi`, `funding`) - default: `all`

**Data Source:**
- `market_history` table - Hourly aggregates from `market_stats` (tracker data)

**Example Request:**
```bash
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/market-history?symbol=BTC&exchange=hyperliquid&from=1767225600000&limit=500"
```

**Response Format:**
```json
{
  "success": true,
  "data": [
    {
      "exchange": "hyperliquid",
      "symbol": "BTC",
      "hour_timestamp": 1767225600,
      "avg_mark_price": 42350.50,
      "avg_index_price": 42348.20,
      "min_price": 42100.00,
      "max_price": 42500.00,
      "price_volatility": 0.94,
      "volume_base": 1234.56,
      "volume_quote": 52345678.90,
      "avg_open_interest": 987654.32,
      "avg_open_interest_usd": 41789012.34,
      "avg_funding_rate": 0.0000125,
      "avg_funding_rate_annual": 10.95,
      "sample_count": 240
    }
  ],
  "meta": {
    "count": 500,
    "time_range": {
      "from": "2026-01-01T00:00:00.000Z",
      "to": "2026-01-21T20:00:00.000Z"
    }
  }
}
```

---

## 🗄️ Database Tables

### **V2 Tables (Legacy - Imported Historical Data)**

#### `funding_rate_history`
- **Source:** V2 collectors (Binance, Hyperliquid, Lighter, Aster, Extended)
- **Timestamp:** `collected_at` (milliseconds)
- **Coverage:** Historical data imported via scripts
- **Status:** ⚠️ No longer actively updated (V2 collectors disabled)

#### `market_history`
- **Source:** Aggregated from `market_stats` (tracker data)
- **Timestamp:** `hour_timestamp` (seconds)
- **Aggregation:** Hourly averages from 15-second snapshots
- **Status:** ⚠️ No new data (trackers stopped)

---

### **V3 Tables (Current - Active Collection)**

All V3 tables follow the naming pattern: `{exchange}_funding_v3`

| Exchange | Table Name | Oldest Data | Records | Status |
|----------|-----------|-------------|---------|--------|
| EdgeX | `edgex_funding_v3` | 2026-01-01 | 18,339 | ✅ Active |
| Hyperliquid | `hyperliquid_funding_v3` | 2026-01-06 | 109,553 | ✅ Active |
| Aster | `aster_funding_v3` | 2026-02-05 | 3,442 | ✅ Active |
| Lighter | `lighter_funding_v3` | 2026-02-05 | 1,728 | ✅ Active |
| Extended | `extended_funding_v3` | 2026-02-05 | 56,926 | ✅ Active |
| Paradex | `paradex_funding_v3` | 2026-02-05 | 12,865 | ✅ Active |
| Nado | `nado_funding_v3` | 2026-02-05 | 368 | ✅ Active |
| HyENA | `hyena_funding_v3` | 2026-02-05 | 330 | ✅ Active |
| Felix | `felix_funding_v3` | 2026-02-05 | 195 | ✅ Active |
| Ventuals | `ventuals_funding_v3` | 2026-02-05 | 195 | ✅ Active |
| XYZ | `xyz_funding_v3` | 2026-02-05 | 645 | ✅ Active |
| Variational | `variational_funding_v3` | 2026-02-05 | 7,185 | ✅ Active |

**V3 Schema:**
```sql
CREATE TABLE {exchange}_funding_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  funding_time INTEGER NOT NULL,
  rate_raw REAL NOT NULL,
  rate_raw_percent REAL NOT NULL,
  interval_hours REAL NOT NULL,
  rate_1h_percent REAL NOT NULL,
  rate_apr REAL NOT NULL,
  collected_at INTEGER NOT NULL,
  source TEXT NOT NULL
)
```

---

## 🔍 Exchange API Endpoints for Historical Data

### **Exchanges WITH Historical API Access:**

#### 1. **Hyperliquid**
- **Endpoint:** `POST https://api.hyperliquid.xyz/info`
- **Body:** `{"type": "fundingHistory", "coin": "BTC", "startTime": 1767225600000}`
- **Format:** Array of `{time: number, fundingRate: string}`
- **Coverage:** ✅ Full historical data available
- **Import Status:** ✅ Partially imported (from 2026-01-06)

#### 2. **EdgeX**
- **Metadata:** `GET https://pro.edgex.exchange/api/v1/public/meta/getMetaData`
- **Funding:** `GET https://pro.edgex.exchange/api/v1/public/funding/getFundingRatePage?contractId={id}&size=1000&filterBeginTimeInclusive={start}&filterEndTimeExclusive={end}`
- **Format:** Paginated with `nextPageOffsetData`
- **Coverage:** ✅ Historical data available (22/101 contracts)
- **Import Status:** ✅ Imported (from 2026-01-01)
- **Note:** ⚠️ Cloudflare protection - must use Worker

#### 3. **Paradex**
- **Endpoint:** `GET https://api.prod.paradex.trade/v1/funding/data?market={symbol}&page_size=100`
- **Format:** Paginated results with `{market, funding_rate, timestamp}`
- **Coverage:** ✅ Historical data available
- **Import Status:** ⚠️ Not yet imported (only current data)

#### 4. **Lighter**
- **Endpoint:** `GET https://api.lighter.xyz/fundings?marketId={id}`
- **Format:** Array of `{timestamp, value, rate, direction}`
- **Coverage:** ✅ Historical data available
- **Import Status:** ⚠️ Not yet imported

#### 5. **Aster**
- **Endpoint:** `GET https://api.aster.exchange/fapi/v1/fundingRate?symbol={symbol}&startTime={ms}&endTime={ms}&limit=1000`
- **Format:** Binance-compatible
- **Coverage:** ✅ Historical data available
- **Import Status:** ⚠️ Not yet imported

#### 6. **Extended (Hyperliquid DEX)**
- **Endpoint:** `GET https://api.hyperliquid-testnet.xyz/info/funding?coin={coin}`
- **Format:** Array of funding rates
- **Coverage:** ✅ Historical data available
- **Import Status:** ⚠️ Not yet imported

---

### **Exchanges WITHOUT Historical API Access:**

These exchanges only provide **current** funding rates:

- **Felix** (Hyperliquid DEX) - Only current rate via meta endpoint
- **Ventuals** (Hyperliquid DEX) - Only current rate via meta endpoint
- **XYZ** (Hyperliquid DEX) - Only current rate via meta endpoint
- **HyENA** (Hyperliquid DEX) - Only current rate via meta endpoint
- **Nado** (Hyperliquid DEX) - Only current rate via meta endpoint
- **Variational** - Only current rate via API

---

## 📥 Import Strategy

### **Priority 1: Exchanges with Historical APIs**
1. ✅ **EdgeX** - Already imported (2026-01-01 onwards)
2. ✅ **Hyperliquid** - Already imported (2026-01-06 onwards)
3. ⚠️ **Paradex** - Implement historical import
4. ⚠️ **Lighter** - Implement historical import
5. ⚠️ **Aster** - Implement historical import
6. ⚠️ **Extended** - Implement historical import

### **Priority 2: Exchanges without Historical APIs**
- **Felix, Ventuals, XYZ, HyENA, Nado, Variational**
- ❌ No historical data available via API
- ✅ Continue collecting hourly via V3 collectors

---

## 🔧 Implementation Notes

### **For Scanner Integration:**

1. **Use `/api/funding-history` endpoint** for historical data queries
2. **Specify exchange parameter** to get data from specific exchange
3. **Use timestamp filters** (`from`, `to`) to limit data range
4. **Set appropriate limit** (max 5000 records per request)
5. **Handle pagination** for large datasets

### **For Historical Data Import:**

1. **Paradex:** Use pagination with `page_size` parameter
2. **Lighter:** Fetch per market, calculate intervals dynamically
3. **Aster:** Use Binance-compatible endpoint with time ranges
4. **Extended:** Fetch per coin from Hyperliquid testnet API
5. **EdgeX:** Already implemented in Worker (bypasses Cloudflare)

---

## 📝 Example Scanner Usage

```typescript
// Fetch historical funding rates for BTC across all exchanges
const response = await fetch(
  'https://defiapi.cloudflareone-demo-account.workers.dev/api/funding-history?' +
  new URLSearchParams({
    symbol: 'BTC',
    from: '1767225600000', // 2026-01-01
    to: '1770360000000',   // 2026-02-06
    limit: '1000'
  })
);

const data = await response.json();

// Process historical data
data.data.forEach(record => {
  console.log(`${record.exchange}: ${record.annualized_rate}% APR at ${record.timestamp}`);
});
```

---

## ⚠️ Current Limitations

1. **V2 Data (funding_rate_history):** No longer updated, historical only
2. **V3 Data:** Most exchanges only have 1-2 days of history
3. **Tracker Data (market_history):** Empty - trackers stopped before aggregation
4. **API Rate Limits:** Some exchanges may have rate limits on historical queries
5. **Cloudflare Protection:** EdgeX requires Worker-based access

---

## 🎯 Next Steps

1. **Implement historical imports** for Paradex, Lighter, Aster, Extended
2. **Create V3 API endpoints** to query `{exchange}_funding_v3` tables directly
3. **Add aggregation endpoints** for V3 data (hourly, daily averages)
4. **Document exchange-specific API quirks** and rate limits
5. **Create unified historical data export** combining V2 and V3 data
