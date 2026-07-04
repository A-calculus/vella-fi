"use strict";

import { Router } from "express";
import { getBatchAllocations, getExecutionBatch } from "../db/schema.js";

const router = Router();

router.get("/proofs/batches/:id", (req, res) => {
    const batchId = Number(req.params.id);
    const ownerWallet = typeof req.query.ownerWallet === "string" ? req.query.ownerWallet : undefined;

    getExecutionBatch(batchId, (batch) => {
        if (!batch) return res.status(404).json({ error: "Batch not found" });

        getBatchAllocations(batchId, ownerWallet, (allocations) => {
            res.json({
                batchId,
                commitmentRoot: batch.commitmentRoot,
                routeHash: batch.routeHash,
                executionResultHash: batch.executionResultHash,
                txSignature: batch.txSignature,
                inclusionProofs: allocations.map(allocation => ({
                    intentId: allocation.intentId,
                    proofLeaf: allocation.proofLeaf,
                    allocationBps: allocation.allocationBps
                })),
                privacy: {
                    model: "MVP commitment proof",
                    limitation: "This is not a full zero-knowledge proof; it is the interface and commitment layer for the zk/privacy upgrade."
                }
            });
        });
    });
});

export default router;
