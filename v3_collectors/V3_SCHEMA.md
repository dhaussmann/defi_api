# V3 Unified Database Schema

## Design Principles

1. **Einheitliche Struktur** für alle 4 Exchanges (Extended, Hyperliquid, Lighter, Aster)
2. **Konsistente Datenformate**:
   - Funding Rate: Immer als **Prozent** (nicht Dezimal)
   - Timestamps: Unix Sekunden
   - Intervalle: Stunden (1h, 4h, 8h)
3. **Normalisierung**: Alle Rates auf 1h normalisiert für Vergleichbarkeit
4. **APR Berechnung**: Einheitlich über Events per Year

## Unified Table Schema

### Table: `{exchange}_funding_v3`

```sql
CREATE TABLE extended_funding_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Market Identification
  symbol TEXT NOT NULL,              -- e.g. "BTC-USD"
  base_asset TEXT NOT NULL,          -- e.g. "BTC"
  
  -- Timestamp (Unix seconds)
  funding_time INTEGER NOT NULL,     -- When funding was charged
  
  -- Raw Funding Rate (as received from API)
  rate_raw REAL NOT NULL,            -- Original value from API
  rate_raw_percent REAL NOT NULL,    -- Always in percent (rate_raw * 100 if needed)
  
  -- Interval Information
  interval_hours INTEGER NOT NULL,   -- Funding interval: 1, 4, or 8 hours
  
  -- Normalized Rates
  rate_1h_percent REAL NOT NULL,     -- Normalized to 1 hour
  rate_apr REAL NOT NULL,            -- Annualized percentage rate
  
  -- Metadata
  collected_at INTEGER NOT NULL,     -- When data was collected (Unix seconds)
  source TEXT NOT NULL DEFAULT 'api', -- 'api' or 'import'
  
  -- Constraints
  UNIQUE(symbol, funding_time)
);
```

## Rate Calculations

### 1. Raw Rate → Percent
```typescript
// If API returns decimal (0.0001)
rate_raw_percent = rate_raw * 100  // 0.01%

// If API returns percent (0.01)
rate_raw_percent = rate_raw  // 0.01%
```

### 2. Normalize to 1h
```typescript
rate_1h_percent = rate_raw_percent / interval_hours
```

### 3. Calculate APR
```typescript
events_per_year = 365 * 24 / interval_hours
rate_apr = rate_raw_percent * events_per_year
```

## Exchange-Specific Mappings

### Extended
- API: `https://api.starknet.extended.exchange/api/v1/info/markets` (current rates)
- API: `https://api.starknet.extended.exchange/api/v1/info/{SYMBOL}/funding` (historical)
- Markets: 78+ active markets (BTC, ETH, SOL, STRK, and 74 more)
- Rate Format: Decimal (0.0001)
- Interval: 1 hour
- Conversion: `rate_raw_percent = rate_raw * 100`
- Note: Markets are fetched dynamically from API, not hardcoded

### Hyperliquid
- API: `https://api.hyperliquid.xyz/info` (POST)
- Rate Format: Decimal (0.0001)
- Interval: 1 hour
- Conversion: `rate_raw_percent = rate_raw * 100`

### Lighter
- API: `https://mainnet.zklighter.elliot.ai/api/v1/fundings`
- Rate Format: Decimal (0.0001)
- Interval: Variable (detected from data)
- Conversion: `rate_raw_percent = rate_raw * 100`

### Aster
- API: `https://fapi.asterdex.com/fapi/v1/fundingRate`
- Rate Format: Decimal (0.0001)
- Interval: Variable (detected from data)
- Conversion: `rate_raw_percent = rate_raw * 100`

## Migration Notes

- V2 tables remain unchanged
- V3 tables are new, clean slate
- Import scripts will populate V3 tables from scratch
- Collectors will write to V3 tables going forward
