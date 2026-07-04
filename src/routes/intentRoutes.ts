"use strict";

import { Router } from "express";
import { createIntentCommitment } from "../privacy/commitments.js";
import { insertTradeIntent, getTradeIntents, getTradeIntent } from "../db/schema.js";
import { RouteConstraints, TradeIntent } from "../models.js";

const router = Router();

function defaultRouteConstraints(input?: Partial<RouteConstraints>): RouteConstraints {
    return {
        allowJupiter: input?.allowJupiter ?? true,
        allowRaydium: input?.allowRaydium ?? true,
        maxRouteHops: input?.maxRouteHops,
        excludedPools: input?.excludedPools ?? []
    };
}

router.post("/intents", (req, res) => {
    const {
        ownerWallet,
        agentId,
        inputMint,
        outputMint,
        side = "swap",
        amountIn,
        minAmountOut,
        maxSlippageBps,
        executionWindowMs = 30000,
        routeConstraints,
        signature
    } = req.body;

    if (!ownerWallet || !inputMint || !outputMint || !amountIn || !signature) {
        return res.status(400).json({
            error: "ownerWallet, inputMint, outputMint, amountIn, and signature are required"
        });
    }

    if (!["buy", "sell", "swap"].includes(side)) {
        return res.status(400).json({ error: "side must be buy, sell, or swap" });
    }

    if (Number(amountIn) <= 0) {
        return res.status(400).json({ error: "amountIn must be positive" });
    }

    const normalizedIntent = {
        ownerWallet,
        agentId,
        inputMint,
        outputMint,
        side,
        amountIn: String(amountIn),
        minAmountOut: minAmountOut ? String(minAmountOut) : undefined,
        maxSlippageBps: Number(maxSlippageBps ?? 100),
        executionWindowMs: Number(executionWindowMs),
        routeConstraints: defaultRouteConstraints(routeConstraints),
        signature
    };

    const intent: TradeIntent = {
        ...normalizedIntent,
        status: "pending",
        intentCommitment: createIntentCommitment(normalizedIntent),
        createdAt: new Date().toISOString()
    };

    insertTradeIntent(intent, (id) => {
        getTradeIntent(id, (createdIntent) => {
            res.status(201).json({
                ...createdIntent,
                privacy: {
                    publicCommitment: createdIntent?.intentCommitment,
                    note: "Raw intent details are wallet-scoped; public batch records expose commitments only."
                }
            });
        });
    });
});

router.get("/intents", (req, res) => {
    const ownerWallet = typeof req.query.ownerWallet === "string" ? req.query.ownerWallet : undefined;
    getTradeIntents(ownerWallet, (intents) => {
        res.json(intents);
    });
});

export default router;
