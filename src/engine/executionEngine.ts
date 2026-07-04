"use strict";

import { BatchAllocation, ExecutionBatch, LiquiditySnapshot, TradeIntent } from "../models.js";
import { createExecutionResultHash, stableHash } from "../privacy/commitments.js";
import { getRuntimeConfig } from "../config.js";
import { fetchJson } from "./liquidityRouter.js";

export function simulateBatchExecution(batch: ExecutionBatch, route: LiquiditySnapshot): {
    actualAmountOut: string;
    actualSlippageBps: number;
    txSignature: string;
    executionResultHash: string;
} {
    const expected = Number(route.quotedAmountOut);
    const deterministicDrift = (batch.commitmentRoot.charCodeAt(0) % 9) + 1;
    const actualSlippageBps = Math.round(route.priceImpactPct * 100) + deterministicDrift;
    const actual = expected * (1 - deterministicDrift / 10000);
    const txSignature = `sim-${stableHash({ batchId: batch.id, route: route.poolOrRouteId }).slice(0, 48)}`;
    const executionResultHash = createExecutionResultHash({
        batchId: batch.id!,
        commitmentRoot: batch.commitmentRoot,
        routeHash: batch.routeHash ?? stableHash(route),
        expectedAmountOut: route.quotedAmountOut,
        actualAmountOut: actual.toFixed(6),
        actualSlippageBps
    });

    return {
        actualAmountOut: actual.toFixed(6),
        actualSlippageBps,
        txSignature,
        executionResultHash
    };
}

export function allocateBatchFills(batchId: number, intents: TradeIntent[], expectedAmountOut: string, actualAmountOut: string): BatchAllocation[] {
    const totalIn = intents.reduce((sum, intent) => sum + Number(intent.amountIn), 0);
    const expected = Number(expectedAmountOut);
    const actual = Number(actualAmountOut);

    return intents.map(intent => {
        const share = totalIn > 0 ? Number(intent.amountIn) / totalIn : 0;
        const allocationBps = Math.round(share * 10000);
        const proofLeaf = stableHash({
            batchId,
            intentId: intent.id,
            ownerWallet: intent.ownerWallet,
            intentCommitment: intent.intentCommitment
        });

        return {
            batchId,
            intentId: intent.id!,
            ownerWallet: intent.ownerWallet,
            amountIn: intent.amountIn,
            expectedAmountOut: (expected * share).toFixed(6),
            actualAmountOut: (actual * share).toFixed(6),
            allocationBps,
            proofLeaf
        };
    });
}

export async function constructJupiterSwapTransaction(params: {
    inputMint: string;
    outputMint: string;
    amountIn: string;
    maxSlippageBps: number;
    userPublicKey: string;
}): Promise<{ swapTransaction: string; lastValidBlockHeight: number; quoteResponse: any }> {
    const config = getRuntimeConfig();
    const quoteUrl = `${config.jupiterApiBaseUrl.replace(/\/$/, "")}/quote?inputMint=${params.inputMint}&outputMint=${params.outputMint}&amount=${params.amountIn}&slippageBps=${params.maxSlippageBps}`;

    const headers: Record<string, string> = {};
    if (config.jupiterApiKey) {
        headers["x-api-key"] = config.jupiterApiKey;
    }

    const quoteResponse = await fetchJson(quoteUrl, headers);
    const swapUrl = `${config.jupiterApiBaseUrl.replace(/\/$/, "")}/swap`;

    const swapBody = {
        quoteResponse,
        userPublicKey: params.userPublicKey,
        wrapAndUnwrapSol: true
    };

    const swapResponse = await fetchJson(swapUrl, {
        ...headers,
        "content-type": "application/json"
    }, {
        method: "POST",
        body: JSON.stringify(swapBody)
    });

    return {
        swapTransaction: swapResponse.swapTransaction,
        lastValidBlockHeight: swapResponse.lastValidBlockHeight ?? 0,
        quoteResponse
    };
}

