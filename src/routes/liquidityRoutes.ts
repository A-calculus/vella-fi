"use strict";

import { Router } from "express";
import { getLiquidityRoutes } from "../engine/liquidityRouter.js";
import { getLiquiditySnapshots, insertLiquiditySnapshot } from "../db/schema.js";

const router = Router();

router.get("/liquidity/routes", (req, res) => {
    const inputMint = String(req.query.inputMint ?? "SOL");
    const outputMint = String(req.query.outputMint ?? "USDC");
    const amountIn = String(req.query.amountIn ?? "100");
    const maxSlippageBps = req.query.maxSlippageBps ? Number(req.query.maxSlippageBps) : undefined;

    const routes = getLiquidityRoutes({ inputMint, outputMint, amountIn, maxSlippageBps });
    routes.forEach(route => insertLiquiditySnapshot(route));

    res.json({
        inputMint,
        outputMint,
        amountIn,
        routes,
        note: "Routes are deterministic MVP simulations shaped like Jupiter/Raydium quote data."
    });
});

router.get("/liquidity/snapshots", (req, res) => {
    const inputMint = typeof req.query.inputMint === "string" ? req.query.inputMint : undefined;
    const outputMint = typeof req.query.outputMint === "string" ? req.query.outputMint : undefined;
    getLiquiditySnapshots(inputMint, outputMint, (snapshots) => res.json(snapshots));
});

export default router;
