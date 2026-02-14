# Arbitrage API Documentation

## Overview

The Arbitrage API provides pre-calculated funding rate arbitrage opportunities between different exchanges. The backend automatically calculates and caches arbitrage opportunities every 5 minutes based on Moving Average data.

## Endpoint

```
GET /api/funding/arbitrage
```

## Features

- **Pre-calculated opportunities**: All arbitrage calculations are done in the backend
- **Multiple timeframes**: 24h, 3d, 7d, 14d, 30d
- **Stability scoring**: Each opportunity has a stability score (0-5) indicating consistency across timeframes
- **Flexible filtering**: Filter by symbols, exchanges, timeframes, minimum spread, and stability
- **Sorted results**: Results are sorted by spread APR (descending) by default

## Query Parameters

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `symbols` | string | Comma-separated list of symbols | `BTC,ETH,SOL` |
| `exchanges` | string | Comma-separated list of exchanges | `hyperliquid,paradex,variational` |
| `timeframes` | string | Comma-separated list of timeframes | `24h,7d,30d` |
| `minSpread` | number | Minimum spread (decimal) | `0.0001` |
| `minSpreadAPR` | number | Minimum spread APR (percentage) | `5` |
| `onlyStable` | boolean | Only show stable opportunities (score ≥ 4) | `true` |
| `sortBy` | string | Sort field: `spread`, `spread_apr`, `stability_score` | `spread_apr` |
| `order` | string | Sort order: `asc`, `desc` | `desc` |
| `limit` | number | Maximum number of results | `100` |

## Response Format

```json
{
  "success": true,
  "data": [
    {
      "id": "BTC-lighter-variational-24h",
      "symbol": "BTC",
      "long_exchange": "lighter",
      "short_exchange": "variational",
      "timeframe": "24h",
      "long_rate": 0.00001105,
      "short_rate": 0.00005043,
      "spread": 0.00003939,
      "spread_pct": 0.0039,
      "long_apr": 0.0968,
      "short_apr": 5.2731,
      "spread_apr": 5.1763,
      "stability_score": 5,
      "is_stable": true,
      "calculated_at": 1769957256
    }
  ],
  "meta": {
    "total": 5,
    "stable_count": 5,
    "avg_spread_apr": 38.5,
    "max_spread_apr": 46.8,
    "unique_symbols": 2,
    "unique_exchanges": 4,
    "filters": {
      "symbols": "all",
      "exchanges": "all",
      "timeframes": ["24h"],
      "minSpread": "none",
      "minSpreadAPR": "none",
      "onlyStable": false
    },
    "sorting": {
      "sortBy": "spread_apr",
      "order": "desc",
      "limit": 5
    }
  }
}
```

## Response Fields

### Data Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the opportunity |
| `symbol` | string | Token symbol (e.g., "BTC", "ETH") |
| `long_exchange` | string | Exchange for long position (lower rate) |
| `short_exchange` | string | Exchange for short position (higher rate) |
| `timeframe` | string | Moving average timeframe |
| `long_rate` | number | Funding rate on long exchange (decimal) |
| `short_rate` | number | Funding rate on short exchange (decimal) |
| `spread` | number | Absolute spread between rates (decimal) |
| `spread_pct` | number | Spread as percentage |
| `long_apr` | number | Annualized rate on long exchange (%) |
| `short_apr` | number | Annualized rate on short exchange (%) |
| `spread_apr` | number | Annualized spread (%) |
| `stability_score` | number | Consistency score (0-5) |
| `is_stable` | boolean | True if stability_score ≥ 4 |
| `calculated_at` | number | Unix timestamp of calculation |

### Stability Score

The stability score indicates how consistent the spread direction is across all timeframes:

- **5**: Spread direction is consistent across all 5 timeframes (very stable)
- **4**: Consistent across 4 timeframes (stable)
- **3**: Consistent across 3 timeframes (moderate)
- **2**: Consistent across 2 timeframes (volatile)
- **1**: Consistent across 1 timeframe (very volatile)
- **0**: No consistency (extremely volatile)

## Usage Examples

### Get Top 10 Arbitrage Opportunities (24h)

```bash
curl "https://api.fundingrate.de/api/funding/arbitrage?timeframes=24h&limit=10"
```

### Get Stable BTC Opportunities with Minimum 5% APR Spread

```bash
curl "https://api.fundingrate.de/api/funding/arbitrage?symbols=BTC&onlyStable=true&minSpreadAPR=5&timeframes=24h,7d"
```

### Get Opportunities for Specific Exchanges

```bash
curl "https://api.fundingrate.de/api/funding/arbitrage?exchanges=hyperliquid,paradex,variational&timeframes=24h"
```

### Get All Opportunities Sorted by Stability

```bash
curl "https://api.fundingrate.de/api/funding/arbitrage?sortBy=stability_score&order=desc&limit=20"
```

## Arbitrage Strategy

### How to Use the Data

1. **Long Position**: Open on the exchange with the **lower** funding rate (`long_exchange`)
2. **Short Position**: Open on the exchange with the **higher** funding rate (`short_exchange`)
3. **Profit**: The `spread_apr` represents your potential annualized profit

### Example

```json
{
  "symbol": "BTC",
  "long_exchange": "lighter",
  "short_exchange": "variational",
  "long_rate": 0.00001105,
  "short_rate": 0.00005043,
  "spread_apr": 5.1763,
  "stability_score": 5
}
```

**Strategy:**
- Open **LONG** BTC on Lighter (pay 0.0011% per hour)
- Open **SHORT** BTC on Variational (receive 0.0050% per hour)
- **Net profit**: ~5.18% APR
- **Stability**: Very stable (score 5/5)

## Update Frequency

- **Automatic**: Arbitrage opportunities are recalculated every **5 minutes** via cron job
- **Manual**: Trigger recalculation via admin endpoint (see below)

## Admin Endpoints

### Manually Trigger Arbitrage Calculation

```bash
curl -X POST "https://api.fundingrate.de/api/admin/cache-arbitrage"
```

Response:
```json
{
  "success": true,
  "message": "Arbitrage cache calculation triggered"
}
```

## Data Sources

Arbitrage opportunities are calculated from:
- **Moving Average Cache**: Pre-calculated MA data for all exchanges and timeframes
- **Supported Exchanges**: Hyperliquid, Paradex, EdgeX, Lighter, Variational, Aster, Pacifica, Extended, HyENA, XYZ, FLX, VNTL, KM
- **Timeframes**: 24h, 3d, 7d, 14d, 30d

## Best Practices

1. **Filter by Stability**: Use `onlyStable=true` for more reliable opportunities
2. **Set Minimum Spread**: Use `minSpreadAPR` to filter out small opportunities
3. **Check Multiple Timeframes**: Compare 24h, 7d, and 30d to see trend consistency
4. **Monitor Regularly**: Opportunities change as funding rates fluctuate
5. **Consider Liquidity**: Check open interest and volume on both exchanges before trading

## Integration Example (JavaScript)

```javascript
async function getArbitrageOpportunities() {
  const response = await fetch(
    'https://api.fundingrate.de/api/funding/arbitrage?' +
    new URLSearchParams({
      symbols: 'BTC,ETH',
      timeframes: '24h,7d',
      onlyStable: 'true',
      minSpreadAPR: '3',
      limit: '20'
    })
  );
  
  const data = await response.json();
  
  if (data.success) {
    console.log(`Found ${data.meta.total} opportunities`);
    console.log(`Average spread APR: ${data.meta.avg_spread_apr}%`);
    
    data.data.forEach(opp => {
      console.log(`
        ${opp.symbol}: ${opp.spread_apr.toFixed(2)}% APR
        Long: ${opp.long_exchange} (${opp.long_apr.toFixed(2)}%)
        Short: ${opp.short_exchange} (${opp.short_apr.toFixed(2)}%)
        Stability: ${opp.stability_score}/5
      `);
    });
  }
}
```

## Notes

- All rates are in **decimal format** (e.g., 0.0001 = 0.01%)
- APR values are in **percentage format** (e.g., 5.5 = 5.5%)
- Timestamps are **Unix timestamps** (seconds since epoch)
- The API automatically handles exchange-specific funding intervals (1h, 4h, 8h)

## Support

For issues or questions about the Arbitrage API, please refer to:
- Main API Documentation: `/docs/API.md`
- Arbitrage Calculation Logic: `/docs/ARBITRAGE_CALCULATION.md`
