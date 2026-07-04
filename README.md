# Vella Finance

Vella Finance is a Solana-native bulk trade execution and analytics platform built to ingest batched orders, match buyer/seller liquidity, compute PnL, and anchor settlement proofs on-chain.

## Why this matters
Modern finance still lacks a tightly integrated platform for bulk institutional orders that combines:
- batch ingestion and order lifecycle management,
- deterministic matching and trade execution,
- transparent analytics for operators,
- verifiable settlement on Solana.

This project is designed to bridge that gap with a developer-first MVP that already supports real trade batch persistence, match-making, and settlement routing.

## Product summary
Vella Finance processes ordered batches, stores them in SQLite, executes a simple midpoint matching algorithm, and exposes settlement proof infrastructure to Solana via Anchor. The repository includes:
- Express API for trade batch submission and retrieval
- FIFO buy/sell matching engine that computes matched price, matched size, and PnL
- SQLite persistence for `trade_batches`, `trade_orders`, `matched_pairs`, `agents`, and `agent_logs`
- A Solana Anchor client scaffold with batch PDA generation, proof hashing, and settlement transaction submission
- A minimal agent substrate for future automation, market watch, order routing, and analytics workflows

## Key investor highlights
- Real-time batch analytics focus tailored for institutional workflows
- On-chain settlement proof path with programmable Solana Anchor support
- Built on a low-friction stack: Node.js, Express, SQLite, Solana Devnet
- Architecture supports fast iteration into dashboard, agent automation, and CLI operations

## What’s implemented today
- `POST /api/batches` — ingest a new multipart trade batch
- `GET /api/batches` — list all trade batches
- `GET /api/batches/:id` — retrieve batch details and matched pairs
- `POST /api/settlement/submit-result` — submit a matched batch for on-chain settlement
- `GET /health` — runtime health check

## Architecture
- `src/index.ts` — application entrypoint
- `src/server.ts` — Express server, middleware, routing, and database initialization
- `src/routes/batchRoutes.ts` — batch ingestion and query API
- `src/routes/settlementRoutes.ts` — settlement submission API
- `src/engine/matchingEngine.ts` — order matching logic and PnL calculation
- `src/solana/client.ts` — Anchor client, PDA generation, proof hashing, and Solana transactions
- `src/db/schema.ts` — SQLite schema and data access for orders, batches, matches, and agents
- `src/agents/agentSubstrate.ts` — agent intent scaffold and tool registry
- `programs/valhalla-settlement/` — Anchor program scaffold for batch anchoring and escrow logic

## Database model
The current SQL schema includes:
- `trade_batches`: batch lifecycle state (`pending`, `matched`, `settled`, `failed`), volume, match count, settlement hash
- `trade_orders`: batch orders with symbol, price, size, side, trader public key, timestamp, and batch association
- `matched_pairs`: matched trade records with price, size, PnL and order references
- `agents` / `agent_logs`: automation intents and execution logs for future workflow orchestration

## Setup
### Prerequisites
- Node.js 18+ (recommended)
- npm
- Solana CLI / Devnet access if you plan to execute settlement calls

### Install
```bash
cd valhalla-ledger-finance
npm install
```

### Configure
Create a `.env` file in the project root to override defaults:
```env
PORT=4000
SOLANA_CLUSTER=devnet
RPC_ENDPOINT=https://api.devnet.solana.com
```

### Run locally
```bash
npm run dev
```

Or build and start:
```bash
npm run build
npm start
```

## API examples
### Submit a trade batch
```bash
curl -X POST http://localhost:4000/api/batches \
  -H 'Content-Type: application/json' \
  -d '{
    "orders": [
      { "symbol": "SOL/USD", "price": 140.5, "size": 100, "side": "buy", "trader_pubkey": "Trader1" },
      { "symbol": "SOL/USD", "price": 140.5, "size": 100, "side": "sell", "trader_pubkey": "Trader2" }
    ]
  }'
```

### List batches
```bash
curl http://localhost:4000/api/batches
```

### Get batch details
```bash
curl http://localhost:4000/api/batches/1
```

### Submit settlement result
```bash
curl -X POST http://localhost:4000/api/settlement/submit-result \
  -H 'Content-Type: application/json' \
  -d '{
    "batchId": 1,
    "authoritySecret": "[1,2,3,...]",
    "treasuryWallet": "YOUR_TREASURY_PUBLIC_KEY"
  }'
```

### Health check
```bash
curl http://localhost:4000/health
```

## Development notes
- The current Solana client uses a placeholder Anchor program ID and Devnet connection
- Settlement currently derives the escrow wallet from the authority keypair for MVP flow
- Matching is symbol-aware and uses a midpoint price model for buy/sell execution
- The agent substrate is a lightweight scaffold ready to evolve into autonomous workflows

## Next steps
- Add a dashboard for live batch analytics and trader leaderboards
- Build CLI operator tooling for batch submission, settlement, and health checks
- Extend the agent layer to support market-watch, order routing, risk checks, and settlement triggers
- Deploy the Anchor program to Solana Devnet and update the program ID

## References
- `PROJECT_OVERVIEW.md` — investor-facing summary and milestone plan
- `package.json` — dependency and script configuration

## Why this is compelling
Vella Finance is a strong early-stage asset because it already proves the core value chain: trade batch capture, deterministic matching, on-chain settlement scaffolding, and automation-ready architecture. The MVP is positioned to move quickly from backend proof-of-concept to a polished product with a strategic dashboard, operator CLI, and live Solana settlement capabilities.
