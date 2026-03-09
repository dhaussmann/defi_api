# NAVIX API – Funding Rate Arbitrage Platform

Cloudflare Workers API that aggregates funding rates from 25+ decentralized perpetual exchanges and identifies arbitrage opportunities.

## Quick Start

```bash
# Install dependencies
npm install

# Set up D1 database
wrangler d1 create navix-db
# Update wrangler.toml with the database_id

# Run migration
wrangler d1 execute navix-db --local --file=./migrations/0001_initial.sql

# Set up KV namespace
wrangler kv:namespace create MARKET_KV
# Update wrangler.toml with the KV id

# Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put INTERNAL_API_KEY
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put ANALYTICS_ENGINE_API_TOKEN
wrangler secret put EXPO_ACCESS_TOKEN

# Run locally
npm run dev

# Deploy
npm run deploy
```

## Project Structure

```
src/
├── index.ts                              # Main entry, Hono app, routing, CORS
├── config/
│   ├── exchanges.ts                      # Exchange configurations (25+ DEXes)
│   └── exchangeFees.ts                   # Fee structures per exchange (BPS)
├── types/
│   ├── env.ts                            # Cloudflare Worker environment bindings
│   └── marketTypes.ts                    # Market type enums & unified data interface
├── utils/
│   ├── logger.ts                         # Structured API logging
│   ├── utils.ts                          # Funding rate calculations
│   └── tickersMapper.ts                  # Symbol normalization per exchange
├── middleware/
│   └── auth.ts                           # Internal API key authentication
├── services/
│   └── exchanges/
│       ├── base/BaseExchangeService.ts   # Abstract base class
│       ├── ServiceFactory.ts             # Factory pattern for services
│       ├── hyperliquid.ts                # HyperLiquid (POST, Crypto + XYZ)
│       ├── aevo.ts                       # Aevo (rate-limited, concurrent)
│       └── ... (23 more exchange services)
├── routes/
│   ├── exchanges.ts                      # /api/* – Live market data
│   ├── database.ts                       # /api/db/* – Historical data & strategies
│   ├── telegram.ts                       # /api/telegram/* – Bot auth & alerts
│   ├── push.ts                           # /api/push/* – Expo push notifications
│   ├── user.ts                           # /api/user/* – User configuration
│   ├── internal.ts                       # /api/internal/* – Execution costs (auth)
│   └── health.ts                         # /health – System health checks
└── migrations/
    └── 0001_initial.sql                  # D1 database schema
```

## Environment Bindings

| Binding | Type | Description |
|---------|------|-------------|
| `DB` | D1 | SQLite database for users, strategies, notifications |
| `MARKET_KV` | KV | Latest market data per exchange |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | For Analytics Engine API |
| `ANALYTICS_ENGINE_API_TOKEN` | Secret | Analytics Engine queries |
| `TELEGRAM_BOT_TOKEN` | Secret | Telegram bot authentication |
| `EXPO_ACCESS_TOKEN` | Secret | Expo push notification service |
| `INTERNAL_API_KEY` | Secret | Internal API authentication |
| `CORS_ORIGINS` | Var | Comma-separated allowed origins |

## Adding a New Exchange

1. Add config to `src/config/exchanges.ts`
2. Create service in `src/services/exchanges/myexchange.ts` extending `BaseExchangeService`
3. Register in `src/services/exchanges/ServiceFactory.ts`
4. Optionally add fees in `src/config/exchangeFees.ts`
5. Optionally add ticker mapper in `src/utils/tickersMapper.ts`
