# V3 Exchange Configuration System

## Übersicht

Das V3 Config-System bietet eine **zentrale Konfiguration** für alle Exchanges mit:
- ✅ Expliziter Rate-Format-Definition (Dezimal vs. Prozent)
- ✅ Automatischer Konvertierung zu einheitlichem Prozent-Format
- ✅ Validierung von Rate-Werten
- ✅ Exchange-spezifischen API-Einstellungen

## Warum ein Config-System?

### Problem
Verschiedene Exchanges liefern Funding Rates in unterschiedlichen Formaten:
- **Dezimal**: `0.0001` (Extended, Hyperliquid, Binance)
- **Prozent**: `0.01` (manche Exchanges)
- **Basispunkte**: `1.0` = 0.01% (selten)

Ohne explizite Konfiguration ist unklar, wie die Werte zu interpretieren sind.

### Lösung
Jeder Exchange hat eine explizite Konfiguration mit:
```typescript
{
  rateFormat: 'decimal',      // Wie die API Daten liefert
  conversionFactor: 100,      // Faktor zur Konvertierung zu Prozent
  validation: {               // Erwartete Wertebereiche
    minRatePercent: -10,
    maxRatePercent: 10,
    warnThreshold: 1
  }
}
```

## Verwendung

### 1. Rate Konvertierung

```typescript
import { calculateRates } from './ExchangeConfig';

const rawRate = 0.000013;  // Von API
const intervalHours = 1;

const rates = calculateRates(rawRate, intervalHours, 'extended');
// {
//   rateRaw: 0.000013,
//   rateRawPercent: 0.0013,      // 0.000013 × 100
//   rate1hPercent: 0.0013,       // 0.0013 / 1
//   rateApr: 11.388              // 0.0013 × 8760
// }
```

### 2. Rate Validierung

```typescript
import { validateRate } from './ExchangeConfig';

const validation = validateRate(0.0013, 'extended');
// {
//   valid: true,
//   warning: false
// }

const validation2 = validateRate(15.0, 'extended');
// {
//   valid: false,
//   warning: false,
//   message: "Rate 15% is outside valid range [-10%, 10%]"
// }
```

### 3. Config Abrufen

```typescript
import { getExchangeConfig } from './ExchangeConfig';

const config = getExchangeConfig('extended');
// {
//   name: 'Extended',
//   rateFormat: 'decimal',
//   conversionFactor: 100,
//   defaultIntervalHours: 1,
//   apiBaseUrl: 'https://api.starknet.extended.exchange/api/v1',
//   ...
// }
```

## Exchange Konfigurationen

### Extended
```typescript
{
  rateFormat: 'decimal',           // API: 0.000013
  conversionFactor: 100,           // → 0.0013%
  defaultIntervalHours: 1,
  apiBaseUrl: 'https://api.starknet.extended.exchange/api/v1',
  requiresUserAgent: true,
  validation: {
    minRatePercent: -10,
    maxRatePercent: 10,
    warnThreshold: 1
  }
}
```

### Hyperliquid
```typescript
{
  rateFormat: 'decimal',           // API: 0.0001
  conversionFactor: 100,           // → 0.01%
  defaultIntervalHours: 1,
  apiBaseUrl: 'https://api.hyperliquid.xyz',
  requiresUserAgent: false
}
```

### Lighter
```typescript
{
  rateFormat: 'decimal',
  conversionFactor: 100,
  defaultIntervalHours: 8,         // Default, wird detektiert
  hasVariableInterval: true,       // Intervall variiert
  hasDirection: true,              // Hat direction field
  hasCumulativeValue: true
}
```

### Aster
```typescript
{
  rateFormat: 'decimal',
  conversionFactor: 100,
  defaultIntervalHours: 8,
  hasVariableInterval: true
}
```

## Validierung

### Automatische Validierung
Jeder importierte/gesammelte Wert wird validiert:

```typescript
const validation = validateRate(ratePercent, exchangeName);

if (!validation.valid) {
  // Rate außerhalb des gültigen Bereichs → Skip
  console.error(`Invalid rate: ${validation.message}`);
  return;
}

if (validation.warning) {
  // Rate ungewöhnlich hoch → Warnung
  console.warn(`Warning: ${validation.message}`);
}
```

### Validierungsbereiche

| Exchange | Min | Max | Warn Threshold |
|----------|-----|-----|----------------|
| Extended | -10% | +10% | 1% |
| Hyperliquid | -10% | +10% | 1% |
| Lighter | -10% | +10% | 1% |
| Aster | -10% | +10% | 1% |

**Typische Funding Rates:** -0.1% bis +0.1%
**Warn Threshold:** Warnung bei |rate| > 1%
**Hard Limit:** Fehler bei |rate| > 10%

## Vorteile

### 1. Explizit statt Implizit
```typescript
// ❌ Vorher: Unklar
const ratePercent = rawRate * 100;  // Warum 100? Ist das immer richtig?

// ✅ Jetzt: Explizit konfiguriert
const rates = calculateRates(rawRate, intervalHours, 'extended');
```

### 2. Zentrale Wartung
Alle Exchange-spezifischen Einstellungen an einem Ort:
- Rate-Format
- API-URLs
- Validierungsbereiche
- Spezielle Features

### 3. Fehlerprävention
```typescript
// Automatische Validierung verhindert ungültige Daten
if (!validation.valid) {
  // Skip invalid data
  return;
}
```

### 4. Erweiterbarkeit
Neue Exchanges einfach hinzufügen:
```typescript
EXCHANGE_CONFIGS.newexchange = {
  name: 'NewExchange',
  rateFormat: 'percent',  // Dieser Exchange liefert direkt Prozent
  conversionFactor: 1,    // Keine Konvertierung nötig
  ...
};
```

## Integration in Collectors

### Beispiel: Extended Collector

```typescript
import { getExchangeConfig, calculateRates, validateRate } from './ExchangeConfig';

const EXCHANGE_NAME = 'extended';
const CONFIG = getExchangeConfig(EXCHANGE_NAME);

// In collectMarketData:
const rateRaw = parseFloat(stats.fundingRate);
const rates = calculateRates(rateRaw, CONFIG.defaultIntervalHours, EXCHANGE_NAME);

// Validate
const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
if (!validation.valid) {
  console.error(`Invalid rate: ${validation.message}`);
  return 0;
}

// Use validated rates
await env.DB_WRITE.prepare(`...`).bind(
  rates.rateRaw,
  rates.rateRawPercent,
  rates.rate1hPercent,
  rates.rateApr,
  ...
).run();
```

## Testing

### Test Rate Conversion
```bash
# Extended: 0.000013 (decimal) → 0.0013%
curl -s "https://api.starknet.extended.exchange/api/v1/info/markets" | \
  jq '.data[0].marketStats.fundingRate'
# Output: "0.000013"
# Expected: 0.0013% (× 100)
```

### Verify in Database
```sql
SELECT 
  symbol,
  rate_raw,           -- Original: 0.000013
  rate_raw_percent,   -- Converted: 0.0013
  rate_1h_percent,    -- Normalized: 0.0013
  rate_apr            -- Annualized: 11.388
FROM extended_funding_v3
WHERE symbol = 'BTC-USD'
ORDER BY funding_time DESC
LIMIT 1;
```

## Nächste Schritte

1. ✅ Extended V3 verwendet Config-System
2. ⏳ Hyperliquid V3 mit Config-System implementieren
3. ⏳ Lighter V3 mit Config-System implementieren
4. ⏳ Aster V3 mit Config-System implementieren
