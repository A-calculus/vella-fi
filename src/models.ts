"use strict";

/**
 * TradeOrder represents an individual buy or sell order
 */
export interface TradeOrder {
    id?: number;
    symbol: string;       // e.g., "SOL/USD"
    price: number;        // price per unit
    size: number;         // quantity
    side: 'buy' | 'sell';
    trader_pubkey: string; // trader's public key
    timestamp: string;    // ISO datetime string
    batch_id?: number;    // optional reference to batch
}

/**
 * TradeBatch represents a collection of orders submitted together
 */
export interface TradeBatch {
    id?: number;
    orders: TradeOrder[];
    status: 'pending' | 'matched' | 'settled' | 'failed';
    matchedPairs: MatchedPair[];
    createdAt: string;    // ISO datetime string
    matched_pairs_count?: number;
    total_volume?: number;
    settlement_tx_hash?: string;
}

/**
 * MatchedPair represents a matched buy and sell order
 */
export interface MatchedPair {
    id?: number;
    batch_id?: number;
    buyOrder: TradeOrder;
    sellOrder: TradeOrder;
    matchedPrice: number;
    matchedSize: number;
    pnl: number;          // Profit and Loss for the match
}

/**
 * AgentIntent represents an intent-based action request
 */
export interface AgentIntent {
    name: string;          // Agent type (e.g., 'market-watch', 'order-router')
    parameters: any;      // Agent-specific parameters
}

/**
 * AgentLog represents an execution log for an agent
 */
export interface AgentLog {
    agentName: string;
    startedAt: string;
    events: AgentEvent[];
}

/**
 * AgentEvent represents a single event in an agent's execution
 */
export interface AgentEvent {
    timestamp: string;
    action?: string;
    order?: TradeOrder;
    batchId?: number;
    done?: boolean;
    data?: any;
}

export type IntentStatus = 'pending' | 'batched' | 'executed' | 'settled' | 'failed' | 'cancelled';
export type ExecutionBatchStatus = 'forming' | 'quoted' | 'executing' | 'settled' | 'failed';
export type LiquiditySource = 'jupiter' | 'raydium';

export interface RouteConstraints {
    allowJupiter: boolean;
    allowRaydium: boolean;
    maxRouteHops?: number;
    excludedPools?: string[];
}

export interface TradeIntent {
    id?: number;
    ownerWallet: string;
    agentId?: number;
    inputMint: string;
    outputMint: string;
    side: 'buy' | 'sell' | 'swap';
    amountIn: string;
    minAmountOut?: string;
    maxSlippageBps: number;
    executionWindowMs: number;
    routeConstraints: RouteConstraints;
    status: IntentStatus;
    signature: string;
    blindingFactor?: string;
    intentCommitment?: string;
    createdAt: string;
    batchId?: number;
}

export interface ExecutionBatch {
    id?: number;
    inputMint: string;
    outputMint: string;
    totalAmountIn: string;
    intentCount: number;
    aggregationWindowStartedAt: string;
    aggregationWindowClosedAt?: string;
    status: ExecutionBatchStatus;
    commitmentRoot: string;
    selectedRouteId?: string;
    expectedAmountOut?: string;
    actualAmountOut?: string;
    expectedSlippageBps?: number;
    actualSlippageBps?: number;
    txSignature?: string;
    routeHash?: string;
    executionResultHash?: string;
    quoteLockedUntil?: string | null;
}

export interface LiquiditySnapshot {
    id?: number;
    inputMint: string;
    outputMint: string;
    source: LiquiditySource;
    poolOrRouteId: string;
    availableLiquidity?: string;
    quotedAmountOut: string;
    priceImpactPct: number;
    feeBps?: number;
    routeHops?: number;
    observedAt: string;
}

export interface AgentPermission {
    id?: number;
    ownerWallet: string;
    agentName: string;
    allowedInputMints: string[];
    allowedOutputMints: string[];
    maxTradeAmount: string;
    maxDailyVolume: string;
    maxSlippageBps: number;
    canAutoExecute: boolean;
    expiresAt?: string;
    walletSignature: string;
    status: 'active' | 'paused' | 'revoked';
    createdAt: string;
}

export interface BatchAllocation {
    id?: number;
    batchId: number;
    intentId: number;
    ownerWallet: string;
    amountIn: string;
    expectedAmountOut: string;
    actualAmountOut: string;
    allocationBps: number;
    proofLeaf: string;
}
