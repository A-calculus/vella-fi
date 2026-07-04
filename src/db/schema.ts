"use strict";

import {
    AgentPermission,
    BatchAllocation,
    ExecutionBatch,
    LiquiditySnapshot,
    TradeIntent,
    TradeOrder,
    TradeBatch,
    MatchedPair
} from "../models.js";

interface RunResult {
    lastID: number;
    changes: number;
}

class DatabaseWrapper {
    private innerDb: any = null;
    private isReady = false;
    private queue: Array<{ method: string; args: any[] }> = [];

    constructor(filename: string, callback?: (err: Error | null) => void) {
        let driver: any;
        let isWasm = false;
        
        try {
            driver = require("sqlite3");
        } catch (e) {
            console.warn("Native sqlite3 loading failed (possibly due to GLIBC mismatch on Vercel). Falling back to sql.js-as-sqlite3 WASM driver.");
            driver = require("sql.js-as-sqlite3");
            isWasm = true;
        }

        const dbPath = (isWasm || process.env.VERCEL) ? ":memory:" : filename;

        this.innerDb = new driver.Database(dbPath, (err: any) => {
            if (err) {
                console.error("Error opening database:", err);
                if (callback) callback(err);
                return;
            }
            console.log(`Connected to SQLite database (${isWasm ? "WASM in-memory" : "Native file-backed"})`);
            this.isReady = true;
            
            const currentQueue = [...this.queue];
            this.queue = [];
            for (const item of currentQueue) {
                this.innerDb[item.method](...item.args);
            }

            if (callback) callback(null);
        });
    }

    public exec(sql: string, callback?: (err: Error | null) => void) {
        if (this.isReady) {
            this.innerDb.exec(sql, callback);
        } else {
            this.queue.push({ method: "exec", args: [sql, callback] });
        }
    }

    public run(sql: string, params: any, callback?: (this: any, err: Error | null) => void) {
        if (this.isReady) {
            this.innerDb.run(sql, params, callback);
        } else {
            this.queue.push({ method: "run", args: [sql, params, callback] });
        }
    }

    public all(sql: string, params: any, callback?: (err: Error | null, rows: any[]) => void) {
        if (this.isReady) {
            this.innerDb.all(sql, params, callback);
        } else {
            this.queue.push({ method: "all", args: [sql, params, callback] });
        }
    }

    public get(sql: string, params: any, callback?: (err: Error | null, row: any) => void) {
        if (this.isReady) {
            this.innerDb.get(sql, params, callback);
        } else {
            this.queue.push({ method: "get", args: [sql, params, callback] });
        }
    }
}

// Initialize SQLite database with file-based persistence or WASM fallback
const db = new DatabaseWrapper("./valhalla_ledger.db", (err) => {
    if (err) {
        console.error("Error opening database:", err);
        throw err;
    }
});

export function initializeDatabase() {
    // Create tables for TradeOrder, TradeBatch, and MatchedPair
    db.exec(`
        CREATE TABLE IF NOT EXISTS trade_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            price REAL NOT NULL,
            size REAL NOT NULL,
            side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
            trader_pubkey TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            batch_id INTEGER,
            FOREIGN KEY (batch_id) REFERENCES trade_batches(id)
        );
        
        CREATE TABLE IF NOT EXISTS trade_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT NOT NULL CHECK(status IN ('pending', 'matched', 'settled', 'failed')),
            created_at DATETIME NOT NULL,
            matched_pairs_count INTEGER DEFAULT 0,
            total_volume REAL DEFAULT 0,
            settlement_tx_hash TEXT
        );
        
        CREATE TABLE IF NOT EXISTS matched_pairs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER NOT NULL,
            buy_order_id INTEGER NOT NULL,
            sell_order_id INTEGER NOT NULL,
            matched_price REAL NOT NULL,
            matched_size REAL NOT NULL,
            pnl REAL NOT NULL,
            FOREIGN KEY (batch_id) REFERENCES trade_batches(id),
            FOREIGN KEY (buy_order_id) REFERENCES trade_orders(id),
            FOREIGN KEY (sell_order_id) REFERENCES trade_orders(id)
        );
        
        CREATE TABLE IF NOT EXISTS agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'failed', 'paused')),
            parameters TEXT NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME
        );
        
        CREATE TABLE IF NOT EXISTS agent_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            event_data TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            FOREIGN KEY (agent_id) REFERENCES agents(id)
        );

        CREATE TABLE IF NOT EXISTS trade_intents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_wallet TEXT NOT NULL,
            agent_id INTEGER,
            input_mint TEXT NOT NULL,
            output_mint TEXT NOT NULL,
            side TEXT NOT NULL CHECK(side IN ('buy', 'sell', 'swap')),
            amount_in TEXT NOT NULL,
            min_amount_out TEXT,
            max_slippage_bps INTEGER NOT NULL,
            execution_window_ms INTEGER NOT NULL,
            route_constraints TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'batched', 'executed', 'settled', 'failed', 'cancelled')),
            signature TEXT NOT NULL,
            intent_commitment TEXT NOT NULL,
            created_at DATETIME NOT NULL,
            batch_id INTEGER,
            blinding_factor TEXT,
            FOREIGN KEY (batch_id) REFERENCES execution_batches(id)
        );

        CREATE TABLE IF NOT EXISTS execution_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            input_mint TEXT NOT NULL,
            output_mint TEXT NOT NULL,
            total_amount_in TEXT NOT NULL,
            intent_count INTEGER NOT NULL,
            aggregation_window_started_at DATETIME NOT NULL,
            aggregation_window_closed_at DATETIME,
            status TEXT NOT NULL CHECK(status IN ('forming', 'quoted', 'executing', 'settled', 'failed')),
            commitment_root TEXT NOT NULL,
            selected_route_id TEXT,
            expected_amount_out TEXT,
            actual_amount_out TEXT,
            expected_slippage_bps INTEGER,
            actual_slippage_bps INTEGER,
            tx_signature TEXT,
            route_hash TEXT,
            execution_result_hash TEXT,
            quote_locked_until TEXT
        );

        CREATE TABLE IF NOT EXISTS batch_intents (
            batch_id INTEGER NOT NULL,
            intent_id INTEGER NOT NULL,
            intent_commitment TEXT NOT NULL,
            PRIMARY KEY (batch_id, intent_id),
            FOREIGN KEY (batch_id) REFERENCES execution_batches(id),
            FOREIGN KEY (intent_id) REFERENCES trade_intents(id)
        );

        CREATE TABLE IF NOT EXISTS liquidity_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            input_mint TEXT NOT NULL,
            output_mint TEXT NOT NULL,
            source TEXT NOT NULL CHECK(source IN ('jupiter', 'raydium')),
            pool_or_route_id TEXT NOT NULL,
            available_liquidity TEXT,
            quoted_amount_out TEXT NOT NULL,
            price_impact_pct REAL NOT NULL,
            fee_bps INTEGER,
            route_hops INTEGER,
            observed_at DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_wallet TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            allowed_input_mints TEXT NOT NULL,
            allowed_output_mints TEXT NOT NULL,
            max_trade_amount TEXT NOT NULL,
            max_daily_volume TEXT NOT NULL,
            max_slippage_bps INTEGER NOT NULL,
            can_auto_execute INTEGER NOT NULL,
            expires_at DATETIME,
            wallet_signature TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'revoked')),
            created_at DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS batch_allocations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER NOT NULL,
            intent_id INTEGER NOT NULL,
            owner_wallet TEXT NOT NULL,
            amount_in TEXT NOT NULL,
            expected_amount_out TEXT NOT NULL,
            actual_amount_out TEXT NOT NULL,
            allocation_bps INTEGER NOT NULL,
            proof_leaf TEXT NOT NULL,
            FOREIGN KEY (batch_id) REFERENCES execution_batches(id),
            FOREIGN KEY (intent_id) REFERENCES trade_intents(id)
        );
    `);

    // Run migrations to ensure columns exist in existing database files
    db.exec(`ALTER TABLE trade_intents ADD COLUMN blinding_factor TEXT;`, (err) => {
        // Ignore duplicate column errors
    });
    db.exec(`ALTER TABLE execution_batches ADD COLUMN quote_locked_until TEXT;`, (err) => {
        // Ignore duplicate column errors
    });
    
    return db;
}

// Database query functions using sqlite3 callback style

export function insertTradeOrder(order: TradeOrder, batchId?: number, callback?: (id: number) => void): void {
    db.run(
        `INSERT INTO trade_orders (symbol, price, size, side, trader_pubkey, timestamp, batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [order.symbol, order.price, order.size, order.side, order.trader_pubkey, order.timestamp, batchId],
        function(this: RunResult, err: Error | null) {
            if (err) {
                console.error("Error inserting trade order:", err);
                return;
            }
            if (callback) callback(this.lastID);
        }
    );
}

export function createTradeBatch(callback: (id: number) => void): void {
    db.run(
        `INSERT INTO trade_batches (status, created_at) VALUES ('pending', datetime('now'))`,
        [],
        function(this: RunResult, err: Error | null) {
            if (err) {
                console.error("Error creating trade batch:", err);
                return;
            }
            callback(this.lastID);
        }
    );
}

export function updateTradeBatchStatus(batchId: number, status: string, callback?: (err: Error | null) => void): void {
    db.run(
        `UPDATE trade_batches SET status = ? WHERE id = ?`,
        [status, batchId],
        function(this: RunResult, err: Error | null) {
            if (callback) callback(err);
        }
    );
}

export function insertMatchedPair(batchId: number, pair: MatchedPair, callback?: (id: number) => void): void {
    db.run(
        `INSERT INTO matched_pairs 
         (batch_id, buy_order_id, sell_order_id, matched_price, matched_size, pnl)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [batchId, pair.buyOrder.id, pair.sellOrder.id, pair.matchedPrice, pair.matchedSize, pair.pnl],
        function(this: RunResult, err: Error | null) {
            if (err) {
                console.error("Error inserting matched pair:", err);
                return;
            }
            
            // Update batch statistics
            db.run(
                `UPDATE trade_batches 
                 SET matched_pairs_count = matched_pairs_count + 1,
                     total_volume = total_volume + (? * ?)
                 WHERE id = ?`,
                [pair.matchedPrice, pair.matchedSize, batchId],
                function(this: RunResult, updateErr: Error | null) {
                    if (updateErr) {
                        console.error("Error updating batch statistics:", updateErr);
                    }
                    if (callback) callback(this.lastID);
                }
            );
        }
    );
}

export function getTradeBatch(batchId: number, callback: (batch: TradeBatch | null) => void): void {
    db.get(
        `SELECT * FROM trade_batches WHERE id = ?`,
        [batchId],
        (err: Error | null, batch: any) => {
            if (err) {
                console.error("Error fetching trade batch:", err);
                callback(null);
                return;
            }
            
            if (!batch) {
                callback(null);
                return;
            }
            
            // Get all orders for this batch
            db.all(
                `SELECT * FROM trade_orders WHERE batch_id = ?`,
                [batchId],
                (ordersErr: Error | null, orders: any[]) => {
                    if (ordersErr) {
                        console.error("Error fetching trade orders:", ordersErr);
                        callback(null);
                        return;
                    }
                    
                    // Get all matched pairs for this batch
                    db.all(
                        `SELECT * FROM matched_pairs WHERE batch_id = ?`,
                        [batchId],
                        (pairsErr: Error | null, pairs: any[]) => {
                            if (pairsErr) {
                                console.error("Error fetching matched pairs:", pairsErr);
                                callback(null);
                                return;
                            }
                            
                            callback({
                                id: batch.id,
                                orders: orders.map(order => ({
                                    id: order.id,
                                    symbol: order.symbol,
                                    price: order.price,
                                    size: order.size,
                                    side: order.side,
                                    trader_pubkey: order.trader_pubkey,
                                    timestamp: order.timestamp
                                })),
                                status: batch.status,
                                matchedPairs: pairs.map(pair => ({
                                    id: pair.id,
                                    buyOrder: orders.find(o => o.id === pair.buy_order_id),
                                    sellOrder: orders.find(o => o.id === pair.sell_order_id),
                                    matchedPrice: pair.matched_price,
                                    matchedSize: pair.matched_size,
                                    pnl: pair.pnl
                                })),
                                createdAt: batch.created_at
                            });
                        }
                    );
                }
            );
        }
    );
}

export function getAllTradeBatches(callback: (batches: TradeBatch[]) => void): void {
    db.all(
        `SELECT * FROM trade_batches ORDER BY created_at DESC`,
        [],
        (err: Error | null, batches: any[]) => {
            if (err) {
                console.error("Error fetching trade batches:", err);
                callback([]);
                return;
            }
            
            const result: TradeBatch[] = [];
            let completed = 0;
            
            if (batches.length === 0) {
                callback([]);
                return;
            }
            
            batches.forEach(batch => {
                // Get all orders for this batch
                db.all(
                    `SELECT * FROM trade_orders WHERE batch_id = ?`,
                    [batch.id],
                    (ordersErr: Error | null, orders: any[]) => {
                        if (ordersErr) {
                            console.error("Error fetching trade orders:", ordersErr);
                            return;
                        }
                        
                        // Get all matched pairs for this batch
                        db.all(
                            `SELECT * FROM matched_pairs WHERE batch_id = ?`,
                            [batch.id],
                            (pairsErr: Error | null, pairs: any[]) => {
                                if (pairsErr) {
                                    console.error("Error fetching matched pairs:", pairsErr);
                                    return;
                                }
                                
                                result.push({
                                    id: batch.id,
                                    orders: orders.map(order => ({
                                        id: order.id,
                                        symbol: order.symbol,
                                        price: order.price,
                                        size: order.size,
                                        side: order.side,
                                        trader_pubkey: order.trader_pubkey,
                                        timestamp: order.timestamp
                                    })),
                                    status: batch.status,
                                    matchedPairs: pairs.map(pair => ({
                                        id: pair.id,
                                        buyOrder: orders.find(o => o.id === pair.buy_order_id),
                                        sellOrder: orders.find(o => o.id === pair.sell_order_id),
                                        matchedPrice: pair.matched_price,
                                        matchedSize: pair.matched_size,
                                        pnl: pair.pnl
                                    })),
                                    createdAt: batch.created_at
                                });
                                
                                completed++;
                                if (completed === batches.length) {
                                    callback(result);
                                }
                            }
                        );
                    }
                );
            });
        }
    );
}

export function createAgent(name: string, parameters: any, callback: (id: number) => void): void {
    db.run(
        `INSERT INTO agents (name, status, parameters, created_at, updated_at)
         VALUES (?, 'active', ?, datetime('now'), datetime('now'))`,
        [name, JSON.stringify(parameters)],
        function(this: RunResult, err: Error | null) {
            if (err) {
                console.error("Error creating agent:", err);
                return;
            }
            callback(this.lastID);
        }
    );
}

export function logAgentEvent(agentId: number, eventType: string, eventData: any, callback?: (err: Error | null) => void): void {
    db.run(
        `INSERT INTO agent_logs (agent_id, event_type, event_data, timestamp)
         VALUES (?, ?, ?, datetime('now'))`,
        [agentId, eventType, JSON.stringify(eventData)],
        function(this: RunResult, err: Error | null) {
            if (callback) callback(err);
        }
    );
}

function parseJson<T>(value: string, fallback: T): T {
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

function mapTradeIntent(row: any): TradeIntent {
    return {
        id: row.id,
        ownerWallet: row.owner_wallet,
        agentId: row.agent_id ?? undefined,
        inputMint: row.input_mint,
        outputMint: row.output_mint,
        side: row.side,
        amountIn: row.amount_in,
        minAmountOut: row.min_amount_out ?? undefined,
        maxSlippageBps: row.max_slippage_bps,
        executionWindowMs: row.execution_window_ms,
        routeConstraints: parseJson(row.route_constraints, { allowJupiter: true, allowRaydium: true }),
        status: row.status,
        signature: row.signature,
        intentCommitment: row.intent_commitment,
        createdAt: row.created_at,
        batchId: row.batch_id ?? undefined,
        blindingFactor: row.blinding_factor ?? undefined
    };
}

function mapExecutionBatch(row: any): ExecutionBatch {
    return {
        id: row.id,
        inputMint: row.input_mint,
        outputMint: row.output_mint,
        totalAmountIn: row.total_amount_in,
        intentCount: row.intent_count,
        aggregationWindowStartedAt: row.aggregation_window_started_at,
        aggregationWindowClosedAt: row.aggregation_window_closed_at ?? undefined,
        status: row.status,
        commitmentRoot: row.commitment_root,
        selectedRouteId: row.selected_route_id ?? undefined,
        expectedAmountOut: row.expected_amount_out ?? undefined,
        actualAmountOut: row.actual_amount_out ?? undefined,
        expectedSlippageBps: row.expected_slippage_bps ?? undefined,
        actualSlippageBps: row.actual_slippage_bps ?? undefined,
        txSignature: row.tx_signature ?? undefined,
        routeHash: row.route_hash ?? undefined,
        executionResultHash: row.execution_result_hash ?? undefined,
        quoteLockedUntil: row.quote_locked_until ?? undefined
    };
}

function mapLiquiditySnapshot(row: any): LiquiditySnapshot {
    return {
        id: row.id,
        inputMint: row.input_mint,
        outputMint: row.output_mint,
        source: row.source,
        poolOrRouteId: row.pool_or_route_id,
        availableLiquidity: row.available_liquidity ?? undefined,
        quotedAmountOut: row.quoted_amount_out,
        priceImpactPct: row.price_impact_pct,
        feeBps: row.fee_bps ?? undefined,
        routeHops: row.route_hops ?? undefined,
        observedAt: row.observed_at
    };
}

function mapAgentPermission(row: any): AgentPermission {
    return {
        id: row.id,
        ownerWallet: row.owner_wallet,
        agentName: row.agent_name,
        allowedInputMints: parseJson(row.allowed_input_mints, []),
        allowedOutputMints: parseJson(row.allowed_output_mints, []),
        maxTradeAmount: row.max_trade_amount,
        maxDailyVolume: row.max_daily_volume,
        maxSlippageBps: row.max_slippage_bps,
        canAutoExecute: Boolean(row.can_auto_execute),
        expiresAt: row.expires_at ?? undefined,
        walletSignature: row.wallet_signature,
        status: row.status,
        createdAt: row.created_at
    };
}

export function insertTradeIntent(intent: TradeIntent, callback: (id: number) => void): void {
    db.run(
        `INSERT INTO trade_intents (
            owner_wallet, agent_id, input_mint, output_mint, side, amount_in,
            min_amount_out, max_slippage_bps, execution_window_ms, route_constraints,
            status, signature, intent_commitment, created_at, blinding_factor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            intent.ownerWallet,
            intent.agentId ?? null,
            intent.inputMint,
            intent.outputMint,
            intent.side,
            intent.amountIn,
            intent.minAmountOut ?? null,
            intent.maxSlippageBps,
            intent.executionWindowMs,
            JSON.stringify(intent.routeConstraints),
            intent.status,
            intent.signature,
            intent.intentCommitment,
            intent.createdAt,
            intent.blindingFactor ?? null
        ],
        function(this: RunResult, err: Error | null) {
            if (err) {
                console.error("Error inserting trade intent:", err);
                return;
            }
            callback(this.lastID);
        }
    );
}

export function getTradeIntent(intentId: number, callback: (intent: TradeIntent | null) => void): void {
    db.get(`SELECT * FROM trade_intents WHERE id = ?`, [intentId], (err: Error | null, row: any) => {
        if (err || !row) {
            if (err) console.error("Error fetching trade intent:", err);
            callback(null);
            return;
        }
        callback(mapTradeIntent(row));
    });
}

export function getTradeIntents(ownerWallet: string | undefined, callback: (intents: TradeIntent[]) => void): void {
    const sql = ownerWallet
        ? `SELECT * FROM trade_intents WHERE owner_wallet = ? ORDER BY created_at DESC`
        : `SELECT * FROM trade_intents ORDER BY created_at DESC`;
    const params = ownerWallet ? [ownerWallet] : [];
    db.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
            console.error("Error fetching trade intents:", err);
            callback([]);
            return;
        }
        callback(rows.map(mapTradeIntent));
    });
}

export function getPendingTradeIntents(callback: (intents: TradeIntent[]) => void): void {
    db.all(
        `SELECT * FROM trade_intents WHERE status = 'pending' ORDER BY created_at ASC`,
        [],
        (err: Error | null, rows: any[]) => {
            if (err) {
                console.error("Error fetching pending trade intents:", err);
                callback([]);
                return;
            }
            callback(rows.map(mapTradeIntent));
        }
    );
}

export function createExecutionBatch(batch: ExecutionBatch, intents: TradeIntent[], callback: (id: number) => void): void {
    db.run(
        `INSERT INTO execution_batches (
            input_mint, output_mint, total_amount_in, intent_count,
            aggregation_window_started_at, aggregation_window_closed_at, status, commitment_root, quote_locked_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            batch.inputMint,
            batch.outputMint,
            batch.totalAmountIn,
            batch.intentCount,
            batch.aggregationWindowStartedAt,
            batch.aggregationWindowClosedAt ?? null,
            batch.status,
            batch.commitmentRoot,
            batch.quoteLockedUntil ?? null
        ],
        function(this: RunResult, err: Error | null) {
            if (err) {
                console.error("Error creating execution batch:", err);
                return;
            }
            const batchId = this.lastID;
            intents.forEach(intent => {
                db.run(
                    `INSERT INTO batch_intents (batch_id, intent_id, intent_commitment) VALUES (?, ?, ?)`,
                    [batchId, intent.id, intent.intentCommitment]
                );
                db.run(`UPDATE trade_intents SET status = 'batched', batch_id = ? WHERE id = ?`, [batchId, intent.id]);
            });
            callback(batchId);
        }
    );
}

export function getExecutionBatch(batchId: number, callback: (batch: ExecutionBatch | null) => void): void {
    db.get(`SELECT * FROM execution_batches WHERE id = ?`, [batchId], (err: Error | null, row: any) => {
        if (err || !row) {
            if (err) console.error("Error fetching execution batch:", err);
            callback(null);
            return;
        }
        callback(mapExecutionBatch(row));
    });
}

export function getExecutionBatches(callback: (batches: ExecutionBatch[]) => void): void {
    db.all(`SELECT * FROM execution_batches ORDER BY aggregation_window_started_at DESC`, [], (err: Error | null, rows: any[]) => {
        if (err) {
            console.error("Error fetching execution batches:", err);
            callback([]);
            return;
        }
        callback(rows.map(mapExecutionBatch));
    });
}

export function getBatchIntents(batchId: number, callback: (intents: TradeIntent[]) => void): void {
    db.all(
        `SELECT ti.* FROM trade_intents ti
         INNER JOIN batch_intents bi ON ti.id = bi.intent_id
         WHERE bi.batch_id = ?
         ORDER BY ti.created_at ASC`,
        [batchId],
        (err: Error | null, rows: any[]) => {
            if (err) {
                console.error("Error fetching batch intents:", err);
                callback([]);
                return;
            }
            callback(rows.map(mapTradeIntent));
        }
    );
}

export function insertLiquiditySnapshot(snapshot: LiquiditySnapshot, callback?: (id: number) => void): void {
    db.run(
        `INSERT INTO liquidity_snapshots (
            input_mint, output_mint, source, pool_or_route_id, available_liquidity,
            quoted_amount_out, price_impact_pct, fee_bps, route_hops, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            snapshot.inputMint,
            snapshot.outputMint,
            snapshot.source,
            snapshot.poolOrRouteId,
            snapshot.availableLiquidity ?? null,
            snapshot.quotedAmountOut,
            snapshot.priceImpactPct,
            snapshot.feeBps ?? null,
            snapshot.routeHops ?? null,
            snapshot.observedAt
        ],
        function(this: RunResult, err: Error | null) {
            if (err) {
                console.error("Error inserting liquidity snapshot:", err);
                return;
            }
            if (callback) callback(this.lastID);
        }
    );
}

export function getLiquiditySnapshots(inputMint: string | undefined, outputMint: string | undefined, callback: (snapshots: LiquiditySnapshot[]) => void): void {
    const params: string[] = [];
    let sql = `SELECT * FROM liquidity_snapshots`;
    if (inputMint && outputMint) {
        sql += ` WHERE input_mint = ? AND output_mint = ?`;
        params.push(inputMint, outputMint);
    }
    sql += ` ORDER BY observed_at DESC LIMIT 100`;
    db.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
            console.error("Error fetching liquidity snapshots:", err);
            callback([]);
            return;
        }
        callback(rows.map(mapLiquiditySnapshot));
    });
}

export function updateExecutionBatchAfterQuote(
    batchId: number,
    route: LiquiditySnapshot,
    routeHash: string,
    quoteLockedUntil?: string | null | ((err: Error | null) => void),
    callback?: (err: Error | null) => void
): void {
    let actualLocked: string | null = null;
    let actualCallback = callback;
    if (typeof quoteLockedUntil === "function") {
        actualCallback = quoteLockedUntil;
    } else if (quoteLockedUntil !== undefined) {
        actualLocked = quoteLockedUntil;
    }
    db.run(
        `UPDATE execution_batches
         SET status = CASE WHEN status = 'settled' THEN status ELSE 'quoted' END,
             selected_route_id = ?, expected_amount_out = ?,
             expected_slippage_bps = ?, route_hash = ?, quote_locked_until = ?
         WHERE id = ?`,
        [route.poolOrRouteId, route.quotedAmountOut, Math.round(route.priceImpactPct * 100), routeHash, actualLocked, batchId],
        (err: Error | null) => actualCallback?.(err)
    );
}

export function settleExecutionBatch(
    batchId: number,
    actualAmountOut: string,
    actualSlippageBps: number,
    txSignature: string,
    executionResultHash: string,
    callback?: (err: Error | null) => void
): void {
    db.run(
        `UPDATE execution_batches
         SET status = 'settled', actual_amount_out = ?, actual_slippage_bps = ?,
             tx_signature = ?, execution_result_hash = ?
         WHERE id = ?`,
        [actualAmountOut, actualSlippageBps, txSignature, executionResultHash, batchId],
        (err: Error | null) => callback?.(err)
    );
    db.run(`UPDATE trade_intents SET status = 'settled' WHERE batch_id = ?`, [batchId]);
}

export function insertBatchAllocation(allocation: BatchAllocation, callback?: (id: number) => void): void {
    db.run(
        `INSERT INTO batch_allocations (
            batch_id, intent_id, owner_wallet, amount_in, expected_amount_out,
            actual_amount_out, allocation_bps, proof_leaf
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            allocation.batchId,
            allocation.intentId,
            allocation.ownerWallet,
            allocation.amountIn,
            allocation.expectedAmountOut,
            allocation.actualAmountOut,
            allocation.allocationBps,
            allocation.proofLeaf
        ],
        function(this: RunResult, err: Error | null) {
            if (err) {
                console.error("Error inserting batch allocation:", err);
                return;
            }
            if (callback) callback(this.lastID);
        }
    );
}

export function getBatchAllocations(batchId: number, ownerWallet: string | undefined, callback: (allocations: BatchAllocation[]) => void): void {
    const params: any[] = [batchId];
    let sql = `SELECT * FROM batch_allocations WHERE batch_id = ?`;
    if (ownerWallet) {
        sql += ` AND owner_wallet = ?`;
        params.push(ownerWallet);
    }
    db.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
            console.error("Error fetching batch allocations:", err);
            callback([]);
            return;
        }
        callback(rows.map(row => ({
            id: row.id,
            batchId: row.batch_id,
            intentId: row.intent_id,
            ownerWallet: row.owner_wallet,
            amountIn: row.amount_in,
            expectedAmountOut: row.expected_amount_out,
            actualAmountOut: row.actual_amount_out,
            allocationBps: row.allocation_bps,
            proofLeaf: row.proof_leaf
        })));
    });
}

export function createAgentPermission(permission: AgentPermission, callback: (id: number) => void): void {
    db.run(
        `INSERT INTO agent_permissions (
            owner_wallet, agent_name, allowed_input_mints, allowed_output_mints,
            max_trade_amount, max_daily_volume, max_slippage_bps, can_auto_execute,
            expires_at, wallet_signature, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            permission.ownerWallet,
            permission.agentName,
            JSON.stringify(permission.allowedInputMints),
            JSON.stringify(permission.allowedOutputMints),
            permission.maxTradeAmount,
            permission.maxDailyVolume,
            permission.maxSlippageBps,
            permission.canAutoExecute ? 1 : 0,
            permission.expiresAt ?? null,
            permission.walletSignature,
            permission.status,
            permission.createdAt
        ],
        function(this: RunResult, err: Error | null) {
            if (err) {
                console.error("Error creating agent permission:", err);
                return;
            }
            callback(this.lastID);
        }
    );
}

export function getAgentPermissions(ownerWallet: string | undefined, callback: (permissions: AgentPermission[]) => void): void {
    const sql = ownerWallet
        ? `SELECT * FROM agent_permissions WHERE owner_wallet = ? ORDER BY created_at DESC`
        : `SELECT * FROM agent_permissions ORDER BY created_at DESC`;
    const params = ownerWallet ? [ownerWallet] : [];
    db.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
            console.error("Error fetching agent permissions:", err);
            callback([]);
            return;
        }
        callback(rows.map(mapAgentPermission));
    });
}

export function updateAgentPermissionStatus(permissionId: number, status: 'active' | 'paused' | 'revoked', callback?: (err: Error | null) => void): void {
    db.run(
        `UPDATE agent_permissions SET status = ? WHERE id = ?`,
        [status, permissionId],
        (err: Error | null) => callback?.(err)
    );
}

export default db;
