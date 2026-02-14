# Arbitrage API - Frontend Integration Guide

## Quick Start

Die Arbitrage API liefert vorberechnete Funding Rate Arbitrage-Möglichkeiten zwischen verschiedenen Exchanges. Alle Berechnungen erfolgen im Backend, das Frontend muss nur die Daten abrufen und anzeigen.

## Basis-Integration

### 1. Einfache Abfrage

```typescript
interface ArbitrageOpportunity {
  id: string;
  symbol: string;
  long_exchange: string;
  short_exchange: string;
  timeframe: string;
  long_rate: number;
  short_rate: number;
  spread: number;
  spread_pct: number;
  long_apr: number;
  short_apr: number;
  spread_apr: number;
  stability_score: number;
  is_stable: boolean;
  calculated_at: number;
}

interface ArbitrageResponse {
  success: boolean;
  data: ArbitrageOpportunity[];
  meta: {
    total: number;
    stable_count: number;
    avg_spread_apr: number;
    max_spread_apr: number;
    unique_symbols: number;
    unique_exchanges: number;
    filters: {
      symbols: string | string[];
      exchanges: string | string[];
      timeframes: string | string[];
      minSpread: number | string;
      minSpreadAPR: number | string;
      onlyStable: boolean;
    };
    sorting: {
      sortBy: string;
      order: string;
      limit: number;
    };
  };
}

async function fetchArbitrageOpportunities(
  params?: {
    symbols?: string[];
    exchanges?: string[];
    timeframes?: string[];
    minSpreadAPR?: number;
    onlyStable?: boolean;
    limit?: number;
  }
): Promise<ArbitrageResponse> {
  const searchParams = new URLSearchParams();
  
  if (params?.symbols) searchParams.set('symbols', params.symbols.join(','));
  if (params?.exchanges) searchParams.set('exchanges', params.exchanges.join(','));
  if (params?.timeframes) searchParams.set('timeframes', params.timeframes.join(','));
  if (params?.minSpreadAPR) searchParams.set('minSpreadAPR', params.minSpreadAPR.toString());
  if (params?.onlyStable) searchParams.set('onlyStable', 'true');
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  
  const response = await fetch(
    `https://api.fundingrate.de/api/funding/arbitrage?${searchParams}`
  );
  
  return response.json();
}
```

### 2. React Hook

```typescript
import { useState, useEffect } from 'react';

function useArbitrageOpportunities(params?: {
  symbols?: string[];
  timeframes?: string[];
  minSpreadAPR?: number;
  onlyStable?: boolean;
  refreshInterval?: number; // in milliseconds
}) {
  const [data, setData] = useState<ArbitrageOpportunity[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await fetchArbitrageOpportunities(params);
        
        if (response.success) {
          setData(response.data);
          setMeta(response.meta);
          setError(null);
        } else {
          throw new Error('Failed to fetch arbitrage data');
        }
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Auto-refresh if interval is set
    if (params?.refreshInterval) {
      const interval = setInterval(fetchData, params.refreshInterval);
      return () => clearInterval(interval);
    }
  }, [
    params?.symbols?.join(','),
    params?.timeframes?.join(','),
    params?.minSpreadAPR,
    params?.onlyStable,
    params?.refreshInterval,
  ]);

  return { data, meta, loading, error };
}

// Usage
function ArbitrageTable() {
  const { data, meta, loading, error } = useArbitrageOpportunities({
    symbols: ['BTC', 'ETH'],
    timeframes: ['24h', '7d'],
    onlyStable: true,
    minSpreadAPR: 3,
    refreshInterval: 60000, // refresh every minute
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <h2>Arbitrage Opportunities ({meta.total})</h2>
      <p>Average Spread APR: {meta.avg_spread_apr.toFixed(2)}%</p>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Long Exchange</th>
            <th>Short Exchange</th>
            <th>Spread APR</th>
            <th>Stability</th>
            <th>Timeframe</th>
          </tr>
        </thead>
        <tbody>
          {data.map((opp) => (
            <tr key={opp.id}>
              <td>{opp.symbol}</td>
              <td>{opp.long_exchange}</td>
              <td>{opp.short_exchange}</td>
              <td>{opp.spread_apr.toFixed(2)}%</td>
              <td>{opp.stability_score}/5</td>
              <td>{opp.timeframe}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

## UI-Komponenten Beispiele

### 1. Arbitrage Card Component

```typescript
interface ArbitrageCardProps {
  opportunity: ArbitrageOpportunity;
  onSelect?: (opportunity: ArbitrageOpportunity) => void;
}

function ArbitrageCard({ opportunity, onSelect }: ArbitrageCardProps) {
  const getStabilityColor = (score: number) => {
    if (score >= 4) return 'green';
    if (score >= 3) return 'yellow';
    return 'red';
  };

  const getStabilityLabel = (score: number) => {
    if (score >= 4) return 'Stable';
    if (score >= 3) return 'Moderate';
    return 'Volatile';
  };

  return (
    <div className="arbitrage-card" onClick={() => onSelect?.(opportunity)}>
      <div className="header">
        <h3>{opportunity.symbol}</h3>
        <span className={`badge ${getStabilityColor(opportunity.stability_score)}`}>
          {getStabilityLabel(opportunity.stability_score)}
        </span>
      </div>
      
      <div className="spread-apr">
        <span className="value">{opportunity.spread_apr.toFixed(2)}%</span>
        <span className="label">Annual Spread</span>
      </div>
      
      <div className="positions">
        <div className="position long">
          <span className="label">LONG</span>
          <span className="exchange">{opportunity.long_exchange}</span>
          <span className="rate">{opportunity.long_apr.toFixed(2)}% APR</span>
        </div>
        
        <div className="arrow">→</div>
        
        <div className="position short">
          <span className="label">SHORT</span>
          <span className="exchange">{opportunity.short_exchange}</span>
          <span className="rate">{opportunity.short_apr.toFixed(2)}% APR</span>
        </div>
      </div>
      
      <div className="footer">
        <span className="timeframe">{opportunity.timeframe}</span>
        <span className="spread">{opportunity.spread_pct.toFixed(4)}% spread</span>
      </div>
    </div>
  );
}
```

### 2. Filter Component

```typescript
interface ArbitrageFiltersProps {
  onFilterChange: (filters: {
    symbols?: string[];
    timeframes?: string[];
    minSpreadAPR?: number;
    onlyStable?: boolean;
  }) => void;
}

function ArbitrageFilters({ onFilterChange }: ArbitrageFiltersProps) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [timeframes, setTimeframes] = useState<string[]>(['24h']);
  const [minSpreadAPR, setMinSpreadAPR] = useState<number>(0);
  const [onlyStable, setOnlyStable] = useState(false);

  useEffect(() => {
    onFilterChange({ symbols, timeframes, minSpreadAPR, onlyStable });
  }, [symbols, timeframes, minSpreadAPR, onlyStable]);

  return (
    <div className="arbitrage-filters">
      <div className="filter-group">
        <label>Symbols</label>
        <select
          multiple
          value={symbols}
          onChange={(e) => setSymbols(Array.from(e.target.selectedOptions, opt => opt.value))}
        >
          <option value="BTC">BTC</option>
          <option value="ETH">ETH</option>
          <option value="SOL">SOL</option>
          <option value="DOGE">DOGE</option>
          {/* Add more symbols */}
        </select>
      </div>

      <div className="filter-group">
        <label>Timeframes</label>
        <div className="checkbox-group">
          {['24h', '3d', '7d', '14d', '30d'].map(tf => (
            <label key={tf}>
              <input
                type="checkbox"
                checked={timeframes.includes(tf)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setTimeframes([...timeframes, tf]);
                  } else {
                    setTimeframes(timeframes.filter(t => t !== tf));
                  }
                }}
              />
              {tf}
            </label>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <label>Minimum Spread APR (%)</label>
        <input
          type="number"
          min="0"
          step="0.1"
          value={minSpreadAPR}
          onChange={(e) => setMinSpreadAPR(parseFloat(e.target.value) || 0)}
        />
      </div>

      <div className="filter-group">
        <label>
          <input
            type="checkbox"
            checked={onlyStable}
            onChange={(e) => setOnlyStable(e.target.checked)}
          />
          Only Stable Opportunities (Score ≥ 4)
        </label>
      </div>
    </div>
  );
}
```

### 3. Sortierbare Tabelle

```typescript
function ArbitrageTable() {
  const [sortBy, setSortBy] = useState<'spread_apr' | 'stability_score'>('spread_apr');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const { data, loading } = useArbitrageOpportunities({
    symbols: ['BTC', 'ETH'],
    timeframes: ['24h'],
  });

  const sortedData = [...data].sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const toggleSort = (field: 'spread_apr' | 'stability_score') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Long → Short</th>
          <th onClick={() => toggleSort('spread_apr')} style={{ cursor: 'pointer' }}>
            Spread APR {sortBy === 'spread_apr' && (sortOrder === 'asc' ? '↑' : '↓')}
          </th>
          <th onClick={() => toggleSort('stability_score')} style={{ cursor: 'pointer' }}>
            Stability {sortBy === 'stability_score' && (sortOrder === 'asc' ? '↑' : '↓')}
          </th>
          <th>Timeframe</th>
        </tr>
      </thead>
      <tbody>
        {sortedData.map((opp) => (
          <tr key={opp.id}>
            <td><strong>{opp.symbol}</strong></td>
            <td>
              {opp.long_exchange} → {opp.short_exchange}
            </td>
            <td className={opp.spread_apr > 10 ? 'high-spread' : ''}>
              {opp.spread_apr.toFixed(2)}%
            </td>
            <td>
              <StabilityBadge score={opp.stability_score} />
            </td>
            <td>{opp.timeframe}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StabilityBadge({ score }: { score: number }) {
  const colors = ['red', 'orange', 'yellow', 'lightgreen', 'green', 'darkgreen'];
  return (
    <span 
      className="stability-badge" 
      style={{ backgroundColor: colors[score] }}
    >
      {score}/5
    </span>
  );
}
```

## Daten-Interpretation für UI

### 1. Farbcodierung

```typescript
function getSpreadColor(spreadAPR: number): string {
  if (spreadAPR >= 20) return '#00ff00'; // Excellent
  if (spreadAPR >= 10) return '#90ee90'; // Very Good
  if (spreadAPR >= 5) return '#ffff00';  // Good
  if (spreadAPR >= 2) return '#ffa500';  // Moderate
  return '#ff6b6b'; // Low
}

function getStabilityColor(score: number): string {
  if (score >= 4) return '#00ff00'; // Stable
  if (score >= 3) return '#ffff00'; // Moderate
  return '#ff6b6b'; // Volatile
}
```

### 2. Formatierung

```typescript
// Format rates for display
function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

// Format APR for display
function formatAPR(apr: number): string {
  return `${apr.toFixed(2)}%`;
}

// Format timestamp
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

// Format spread percentage
function formatSpreadPct(spreadPct: number): string {
  return `${spreadPct.toFixed(4)}%`;
}
```

### 3. Tooltips / Info-Texte

```typescript
function getTooltipText(opportunity: ArbitrageOpportunity): string {
  return `
    Strategy:
    1. Open LONG ${opportunity.symbol} on ${opportunity.long_exchange}
       - Pay ${formatAPR(opportunity.long_apr)} funding rate
    
    2. Open SHORT ${opportunity.symbol} on ${opportunity.short_exchange}
       - Receive ${formatAPR(opportunity.short_apr)} funding rate
    
    3. Net Profit: ${formatAPR(opportunity.spread_apr)} annually
    
    Stability: ${opportunity.stability_score}/5
    ${opportunity.is_stable ? '✓ Stable across multiple timeframes' : '⚠ Volatile - check other timeframes'}
    
    Last calculated: ${formatTimestamp(opportunity.calculated_at)}
  `;
}
```

## Best Practices für Frontend

### 1. Caching & Performance

```typescript
// Cache API responses
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute

async function fetchWithCache(url: string) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const response = await fetch(url);
  const data = await response.json();
  cache.set(url, { data, timestamp: Date.now() });
  return data;
}
```

### 2. Error Handling

```typescript
async function fetchArbitrageWithRetry(
  params: any,
  maxRetries = 3
): Promise<ArbitrageResponse> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetchArbitrageOpportunities(params);
      if (response.success) {
        return response;
      }
      throw new Error('API returned unsuccessful response');
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error('Max retries exceeded');
}
```

### 3. Real-time Updates

```typescript
function useRealtimeArbitrage(params: any) {
  const [data, setData] = useState<ArbitrageOpportunity[]>([]);
  
  useEffect(() => {
    // Initial fetch
    fetchArbitrageOpportunities(params).then(res => setData(res.data));
    
    // Poll every 30 seconds (API updates every 5 minutes, but we check more frequently)
    const interval = setInterval(async () => {
      const res = await fetchArbitrageOpportunities(params);
      setData(res.data);
    }, 30000);
    
    return () => clearInterval(interval);
  }, [JSON.stringify(params)]);
  
  return data;
}
```

### 4. Notifications für neue Opportunities

```typescript
function useArbitrageAlerts(minSpreadAPR: number) {
  const [previousData, setPreviousData] = useState<ArbitrageOpportunity[]>([]);
  const { data } = useArbitrageOpportunities({ minSpreadAPR });
  
  useEffect(() => {
    if (previousData.length === 0) {
      setPreviousData(data);
      return;
    }
    
    // Find new opportunities
    const newOpportunities = data.filter(
      opp => !previousData.some(prev => prev.id === opp.id)
    );
    
    // Notify user
    newOpportunities.forEach(opp => {
      if (opp.spread_apr >= minSpreadAPR) {
        showNotification(
          `New Arbitrage: ${opp.symbol}`,
          `${opp.spread_apr.toFixed(2)}% APR between ${opp.long_exchange} and ${opp.short_exchange}`
        );
      }
    });
    
    setPreviousData(data);
  }, [data]);
}

function showNotification(title: string, body: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}
```

## Beispiel: Vollständige Dashboard-Komponente

```typescript
function ArbitrageDashboard() {
  const [filters, setFilters] = useState({
    symbols: ['BTC', 'ETH'],
    timeframes: ['24h', '7d'],
    minSpreadAPR: 3,
    onlyStable: true,
  });

  const { data, meta, loading, error } = useArbitrageOpportunities({
    ...filters,
    refreshInterval: 60000, // 1 minute
  });

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div className="arbitrage-dashboard">
      <header>
        <h1>Funding Rate Arbitrage</h1>
        <div className="stats">
          <StatCard label="Total Opportunities" value={meta.total} />
          <StatCard label="Stable Opportunities" value={meta.stable_count} />
          <StatCard label="Avg Spread APR" value={`${meta.avg_spread_apr.toFixed(2)}%`} />
          <StatCard label="Max Spread APR" value={`${meta.max_spread_apr.toFixed(2)}%`} />
        </div>
      </header>

      <aside>
        <ArbitrageFilters onFilterChange={setFilters} />
      </aside>

      <main>
        <div className="opportunities-grid">
          {data.map(opp => (
            <ArbitrageCard key={opp.id} opportunity={opp} />
          ))}
        </div>
      </main>
    </div>
  );
}
```

## Wichtige Hinweise

1. **Update-Frequenz**: Die API aktualisiert Daten alle 5 Minuten. Polling häufiger als alle 30 Sekunden ist nicht sinnvoll.

2. **Rate Limits**: Keine expliziten Rate Limits, aber vernünftiges Polling wird empfohlen (max. 1 Request pro 10 Sekunden).

3. **Datenformat**: 
   - Rates sind in Dezimalformat (0.0001 = 0.01%)
   - APR ist in Prozent (5.5 = 5.5%)
   - Timestamps sind Unix-Timestamps (Sekunden)

4. **Stabilität**: Verwende `onlyStable=true` für produktive Trading-Signale. Instabile Opportunities sind für Analyse interessant, aber riskanter zu traden.

5. **Timeframes**: Vergleiche immer mehrere Timeframes (24h, 7d, 30d) um Trends zu erkennen.

6. **Liquidität**: Die API zeigt nur Funding Rate Spreads. Prüfe zusätzlich Open Interest und Volumen auf beiden Exchanges vor dem Trading.

## Support & Weitere Dokumentation

- API Dokumentation: `/docs/ARBITRAGE_API.md`
- Berechnungslogik: `/docs/ARBITRAGE_CALCULATION.md`
- Haupt-API Docs: `/docs/API.md`
