"use strict";

import { Router } from "express";
import { createAgentPermission, getAgentPermissions, updateAgentPermissionStatus } from "../db/schema.js";
import { AgentPermission } from "../models.js";
import { verifyAgentPermissionSignature } from "../utils/cryptoUtils.js";

const router = Router();

router.post("/agents/permissions", (req, res) => {
    const {
        ownerWallet,
        agentName,
        allowedInputMints = [],
        allowedOutputMints = [],
        maxTradeAmount,
        maxDailyVolume,
        maxSlippageBps = 100,
        canAutoExecute = false,
        expiresAt,
        walletSignature
    } = req.body;

    if (!ownerWallet || !agentName || !maxTradeAmount || !maxDailyVolume || !walletSignature) {
        return res.status(400).json({
            error: "ownerWallet, agentName, maxTradeAmount, maxDailyVolume, and walletSignature are required"
        });
    }

    const permission: AgentPermission = {
        ownerWallet,
        agentName,
        allowedInputMints,
        allowedOutputMints,
        maxTradeAmount: String(maxTradeAmount),
        maxDailyVolume: String(maxDailyVolume),
        maxSlippageBps: Number(maxSlippageBps),
        canAutoExecute: Boolean(canAutoExecute),
        expiresAt,
        walletSignature,
        status: "active",
        createdAt: new Date().toISOString()
    };

    // Verify cryptographic signature
    const isValid = verifyAgentPermissionSignature(permission);
    if (!isValid) {
        return res.status(400).json({
            error: "Invalid cryptographic signature for owner wallet agent permission"
        });
    }

    createAgentPermission(permission, (id) => {
        res.status(201).json({ ...permission, id });
    });
});

router.get("/agents", (req, res) => {
    const ownerWallet = typeof req.query.ownerWallet === "string" ? req.query.ownerWallet : undefined;
    getAgentPermissions(ownerWallet, (permissions) => res.json(permissions));
});

router.post("/agents/:id/pause", (req, res) => {
    updateAgentPermissionStatus(Number(req.params.id), "paused", () => res.json({ id: Number(req.params.id), status: "paused" }));
});

router.post("/agents/:id/resume", (req, res) => {
    updateAgentPermissionStatus(Number(req.params.id), "active", () => res.json({ id: Number(req.params.id), status: "active" }));
});

router.post("/agents/:id/revoke", (req, res) => {
    updateAgentPermissionStatus(Number(req.params.id), "revoked", () => res.json({ id: Number(req.params.id), status: "revoked" }));
});

export default router;
