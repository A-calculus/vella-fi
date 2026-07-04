"use strict";

import { Router } from "express";
import {
    getAgentPermissions,
    getExecutionBatches,
    getLiquiditySnapshots,
    getTradeIntents
} from "../db/schema.js";

const router = Router();

router.get("/analytics/live", (_req, res) => {
    getExecutionBatches((batches) => {
        getTradeIntents(undefined, (intents) => {
            getLiquiditySnapshots(undefined, undefined, (snapshots) => {
                const settled = batches.filter(batch => batch.status === "settled");
                const totalVolume = batches.reduce((sum, batch) => sum + Number(batch.totalAmountIn), 0);
                const avgSlippage = settled.length === 0
                    ? 0
                    : settled.reduce((sum, batch) => sum + (batch.actualSlippageBps ?? 0), 0) / settled.length;

                res.json({
                    timestamp: new Date().toISOString(),
                    batches: batches.slice(0, 20),
                    recentLiquidity: snapshots.slice(0, 20),
                    metrics: {
                        totalBatches: batches.length,
                        pendingIntents: intents.filter(intent => intent.status === "pending").length,
                        totalIntents: intents.length,
                        totalAggregatedVolume: totalVolume.toFixed(6),
                        settledBatches: settled.length,
                        averageActualSlippageBps: Math.round(avgSlippage)
                    }
                });
            });
        });
    });
});

router.get("/analytics/history", (_req, res) => {
    getExecutionBatches((batches) => {
        res.json({
            batches,
            performance: batches.map(batch => ({
                batchId: batch.id,
                pair: `${batch.inputMint}/${batch.outputMint}`,
                intentCount: batch.intentCount,
                volume: batch.totalAmountIn,
                expectedAmountOut: batch.expectedAmountOut,
                actualAmountOut: batch.actualAmountOut,
                actualSlippageBps: batch.actualSlippageBps,
                txSignature: batch.txSignature,
                status: batch.status
            }))
        });
    });
});

router.get("/analytics/slippage", (_req, res) => {
    getExecutionBatches((batches) => {
        res.json(batches.map(batch => ({
            batchId: batch.id,
            pair: `${batch.inputMint}/${batch.outputMint}`,
            expectedSlippageBps: batch.expectedSlippageBps,
            actualSlippageBps: batch.actualSlippageBps,
            simulatedSavingsBps: batch.actualSlippageBps && batch.expectedSlippageBps
                ? Math.max(0, 150 - batch.actualSlippageBps)
                : undefined
        })));
    });
});

router.get("/analytics/agents", (req, res) => {
    const ownerWallet = typeof req.query.ownerWallet === "string" ? req.query.ownerWallet : undefined;
    getAgentPermissions(ownerWallet, (permissions) => {
        res.json({
            active: permissions.filter(permission => permission.status === "active"),
            paused: permissions.filter(permission => permission.status === "paused"),
            revoked: permissions.filter(permission => permission.status === "revoked")
        });
    });
});

export default router;
