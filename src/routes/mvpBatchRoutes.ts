"use strict";

import { Router } from "express";
import { buildBatchPlans } from "../engine/batchAggregationEngine.js";
import { allocateBatchFills, simulateBatchExecution, constructJupiterSwapTransaction } from "../engine/executionEngine.js";
import { getLiquidityRoutes, selectBestRoute, routeSatisfiesMinOutputs } from "../engine/liquidityRouter.js";
import { createRouteHash } from "../privacy/commitments.js";
import {
    createExecutionBatch,
    getBatchAllocations,
    getBatchIntents,
    getExecutionBatch,
    getExecutionBatches,
    getPendingTradeIntents,
    insertBatchAllocation,
    insertLiquiditySnapshot,
    settleExecutionBatch,
    updateExecutionBatchAfterQuote
} from "../db/schema.js";

const router = Router();

router.post("/batches/aggregate", (req, res) => {
    getPendingTradeIntents((intents) => {
        const plans = buildBatchPlans(intents);

        if (plans.length === 0) {
            return res.json({ created: [], message: "No pending intents available for aggregation" });
        }

        const created: any[] = [];
        let processed = 0;

        plans.forEach(plan => {
            createExecutionBatch(plan.batch, plan.intents, (batchId) => {
                created.push({
                    batchId,
                    inputMint: plan.batch.inputMint,
                    outputMint: plan.batch.outputMint,
                    totalAmountIn: plan.batch.totalAmountIn,
                    intentCount: plan.batch.intentCount,
                    commitmentRoot: plan.batch.commitmentRoot
                });
                processed++;
                if (processed === plans.length) {
                    res.status(201).json({ created });
                }
            });
        });
    });
});

router.get("/execution-batches", (_req, res) => {
    getExecutionBatches((batches) => res.json(batches));
});

router.get("/execution-batches/:id", (req, res) => {
    const batchId = Number(req.params.id);
    if (!Number.isInteger(batchId)) {
        return res.status(400).json({ error: "Invalid batch ID" });
    }

    getExecutionBatch(batchId, (batch) => {
        if (!batch) return res.status(404).json({ error: "Batch not found" });
        getBatchAllocations(batchId, typeof req.query.ownerWallet === "string" ? req.query.ownerWallet : undefined, (allocations) => {
            res.json({
                ...batch,
                allocations,
                privacy: {
                    publicCommitment: batch.commitmentRoot,
                    publicFieldsOnly: !req.query.ownerWallet
                }
            });
        });
    });
});

router.post("/execution-batches/:id/quote", (req, res) => {
    const batchId = Number(req.params.id);
    if (!Number.isInteger(batchId)) {
        return res.status(400).json({ error: "Invalid batch ID" });
    }

    getExecutionBatch(batchId, async (batch) => {
        if (!batch) return res.status(404).json({ error: "Batch not found" });

        getBatchIntents(batchId, async (intents) => {
            try {
                const routes = await getLiquidityRoutes({
                    inputMint: batch.inputMint,
                    outputMint: batch.outputMint,
                    amountIn: batch.totalAmountIn,
                    maxSlippageBps: req.body?.maxSlippageBps
                });

                // Filter by minAmountOut satisfaction
                const validRoutes = routes.filter(r => routeSatisfiesMinOutputs(r, intents));
                validRoutes.forEach(route => insertLiquiditySnapshot(route));

                const selected = selectBestRoute(validRoutes);
                if (!selected) {
                    return res.status(422).json({ error: "No live route satisfies batch constraints" });
                }

                const routeHash = createRouteHash(selected);
                // Calculate quoteLockedUntil = 15 seconds from now
                const quoteLockedUntil = new Date(Date.now() + 15000).toISOString();

                updateExecutionBatchAfterQuote(batchId, selected, routeHash, quoteLockedUntil, () => {
                    res.json({
                        batchId,
                        selectedRoute: selected,
                        routeHash,
                        quoteLockedUntil,
                        alternatives: validRoutes
                    });
                });
            } catch (error) {
                res.status(502).json({
                    error: "Live batch quote failed",
                    details: error instanceof Error ? error.message : String(error)
                });
            }
        });
    });
});

router.post("/execution-batches/:id/execute", (req, res) => {
    const batchId = Number(req.params.id);
    if (!Number.isInteger(batchId)) {
        return res.status(400).json({ error: "Invalid batch ID" });
    }

    getExecutionBatch(batchId, async (batch) => {
        if (!batch) return res.status(404).json({ error: "Batch not found" });

        // Quote locking validation
        if (batch.quoteLockedUntil) {
            const expiry = new Date(batch.quoteLockedUntil).getTime();
            if (Date.now() > expiry) {
                return res.status(400).json({
                    error: "Quote has expired. Please request a new quote before executing."
                });
            }
        } else if (batch.status === "forming") {
            return res.status(400).json({
                error: "Batch has not been quoted yet. Please request a quote first."
            });
        }

        try {
            const routes = await getLiquidityRoutes({
                inputMint: batch.inputMint,
                outputMint: batch.outputMint,
                amountIn: batch.totalAmountIn,
                maxSlippageBps: req.body?.maxSlippageBps
            });
            const selected = routes.find(route => route.poolOrRouteId === batch.selectedRouteId) ?? selectBestRoute(routes);
            if (!selected) {
                return res.status(422).json({ error: "No executable live route available" });
            }

            const routeHash = createRouteHash(selected);
            const quotedBatch = { ...batch, routeHash };
            const result = simulateBatchExecution(quotedBatch, selected);

            // Construct real swap transaction if selected route is jupiter
            let swapTransaction: string | undefined = undefined;
            let lastValidBlockHeight: number | undefined = undefined;

            if (selected.source === "jupiter") {
                const userPublicKey = req.body?.userPublicKey || "VellaExecut11111111111111111111111111111111";
                try {
                    const jupTx = await constructJupiterSwapTransaction({
                        inputMint: batch.inputMint,
                        outputMint: batch.outputMint,
                        amountIn: batch.totalAmountIn,
                        maxSlippageBps: req.body?.maxSlippageBps ?? 100,
                        userPublicKey
                    });
                    swapTransaction = jupTx.swapTransaction;
                    lastValidBlockHeight = jupTx.lastValidBlockHeight;
                } catch (txError) {
                    console.error("Failed to construct Jupiter swap transaction:", txError);
                }
            }

            getBatchIntents(batchId, (intents) => {
                const allocations = allocateBatchFills(batchId, intents, selected.quotedAmountOut, result.actualAmountOut);
                allocations.forEach(allocation => insertBatchAllocation(allocation));
                
                // Clear the quote lock on execution
                updateExecutionBatchAfterQuote(batchId, selected, routeHash, null, () => {
                    settleExecutionBatch(
                        batchId,
                        result.actualAmountOut,
                        result.actualSlippageBps,
                        result.txSignature,
                        result.executionResultHash,
                        () => {
                            res.json({
                                batchId,
                                mode: "quote-backed-settlement",
                                selectedRoute: selected,
                                routeHash,
                                swapTransaction,
                                lastValidBlockHeight,
                                ...result,
                                allocations,
                                privacy: {
                                    commitmentRoot: batch.commitmentRoot,
                                    note: "Transaction constructed and prepared. Proportional allocation performed on private commitments. Called: wallet-scoped intent prototype."
                                }
                            });
                        }
                    );
                });
            });
        } catch (error) {
            res.status(502).json({
                error: "Live execution failed",
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });
});

export default router;
