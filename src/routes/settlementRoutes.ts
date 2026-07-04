"use strict";

import { Router } from "express";
import { Keypair, PublicKey } from "@solana/web3.js";
import { submitTradeBatchSettlement, generateMatchedPairsHash } from "../solana/client.js";
import { getTradeBatch, updateTradeBatchStatus } from "../db/schema.js";

const router = Router();

/**
 * POST /api/settlement/submit-result - Submit a signed batch result for on-chain settlement
 */
router.post("/settlement/submit-result", async (req, res) => {
    try {
        const { batchId, authoritySecret, treasuryWallet } = req.body;
        
        // Validate input
        if (!batchId || !authoritySecret || !treasuryWallet) {
            return res.status(400).json({
                error: "batchId, authoritySecret, and treasuryWallet are required"
            });
        }
        
        // Get the trade batch from database
        getTradeBatch(batchId, async (batch) => {
            if (!batch) {
                return res.status(404).json({ error: "Batch not found" });
            }
            
            if (batch.status !== 'matched') {
                return res.status(400).json({
                    error: `Batch status must be 'matched' for settlement, got '${batch.status}'`
                });
            }
            
            // Generate authority keypair from secret
            let authorityKeypair: Keypair;
            try {
                // Convert secret from base58 or array format
                if (typeof authoritySecret === 'string') {
                    const secretKey = new Uint8Array(JSON.parse(authoritySecret));
                    authorityKeypair = Keypair.fromSecretKey(secretKey);
                } else if (Array.isArray(authoritySecret)) {
                    authorityKeypair = Keypair.fromSecretKey(new Uint8Array(authoritySecret));
                } else {
                    return res.status(400).json({
                        error: "authoritySecret must be base58 string or array of numbers"
                    });
                }
            } catch (error) {
                return res.status(400).json({
                    error: "Invalid authoritySecret format"
                });
            }
            
            // Generate matched pairs hash
            const matchedHash = await generateMatchedPairsHash(
                batch.matchedPairs.map(pair => ({
                    buyOrderId: pair.buyOrder.id!,
                    sellOrderId: pair.sellOrder.id!,
                    matchedPrice: pair.matchedPrice,
                    matchedSize: pair.matchedSize,
                    pnl: pair.pnl
                }))
            );
            
            // Determine winner and loser (using PnL-based determination)
            // For this MVP, we'll use the first matched pair to determine winner/loser
            if (batch.matchedPairs.length === 0) {
                return res.status(400).json({
                    error: "No matched pairs in batch"
                });
            }
            
            const firstPair = batch.matchedPairs[0];
            const winner = firstPair.pnl > 0 ? firstPair.sellOrder.trader_pubkey : firstPair.buyOrder.trader_pubkey;
            const loser = firstPair.pnl > 0 ? firstPair.buyOrder.trader_pubkey : firstPair.sellOrder.trader_pubkey;
            
            // Calculate total amount to settle (sum of all PnL from matched pairs)
            const totalAmount = batch.matchedPairs.reduce((sum, pair) => sum + Math.abs(pair.pnl), 0);
            
            // In a real implementation, the escrow wallet would be funded with the total amount
            // For this MVP, we'll use the authority wallet as the escrow wallet
            const escrowWallet = authorityKeypair.publicKey;
            
            // Submit to Solana
            const txSignature = await submitTradeBatchSettlement({
                authority: authorityKeypair,
                batchId: batchId.toString(),
                matchedHash: matchedHash,
                winner: new PublicKey(winner),
                loser: new PublicKey(loser),
                amountSoc: totalAmount,
                escrowWallet: escrowWallet,
                treasuryWallet: new PublicKey(treasuryWallet)
            });
            
            // Update database with settlement info
            // Note: In a real implementation, we'd use a transaction callback
            updateTradeBatchStatus(batchId, 'settled', (err) => {
                if (err) {
                    console.error("Error updating batch status:", err);
                }
            });
            
            res.json({
                success: true,
                transactionSignature: txSignature,
                batchId: batchId,
                winner: winner,
                loser: loser,
                amount: totalAmount
            });
        });
        
    } catch (error) {
        console.error("Error submitting settlement result:", error);
        res.status(500).json({
            error: "Internal server error",
            details: error instanceof Error ? error.message : String(error)
        });
    }
});

export default router;