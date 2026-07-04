"use strict";

import crypto from "crypto";
import { LiquiditySnapshot, TradeIntent } from "../models.js";

function normalize(value: any): any {
    if (Array.isArray(value)) {
        return value.map(normalize);
    }
    if (value && typeof value === "object") {
        return Object.keys(value)
            .sort()
            .reduce((acc: Record<string, any>, key) => {
                acc[key] = normalize(value[key]);
                return acc;
            }, {});
    }
    return value;
}

export function stableHash(value: unknown): string {
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(normalize(value)))
        .digest("hex");
}

export function createIntentCommitment(intent: {
    inputMint: string;
    outputMint: string;
    side: string;
    amountIn: string;
    minAmountOut?: string | null;
    maxSlippageBps: number;
    executionWindowMs: number;
    routeConstraints: any;
    blindingFactor: string;
}): string {
    return stableHash({
        inputMint: intent.inputMint,
        outputMint: intent.outputMint,
        side: intent.side,
        amountIn: intent.amountIn,
        minAmountOut: intent.minAmountOut ?? null,
        maxSlippageBps: intent.maxSlippageBps,
        executionWindowMs: intent.executionWindowMs,
        routeConstraints: intent.routeConstraints,
        blindingFactor: intent.blindingFactor
    });
}

export function createCommitmentRoot(commitments: string[]): string {
    if (commitments.length === 0) {
        return stableHash({ empty: true });
    }

    let level = commitments.slice().sort();
    while (level.length > 1) {
        const next: string[] = [];
        for (let index = 0; index < level.length; index += 2) {
            const left = level[index];
            const right = level[index + 1] ?? left;
            next.push(stableHash({ left, right }));
        }
        level = next;
    }
    return level[0];
}

export function createRouteHash(route: LiquiditySnapshot): string {
    return stableHash({
        source: route.source,
        poolOrRouteId: route.poolOrRouteId,
        quotedAmountOut: route.quotedAmountOut,
        priceImpactPct: route.priceImpactPct,
        feeBps: route.feeBps,
        routeHops: route.routeHops,
        observedAt: route.observedAt
    });
}

export function createExecutionResultHash(params: {
    batchId: number;
    commitmentRoot: string;
    routeHash: string;
    expectedAmountOut: string;
    actualAmountOut: string;
    actualSlippageBps: number;
}): string {
    return stableHash(params);
}
