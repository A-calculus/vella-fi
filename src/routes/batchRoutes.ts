"use strict";

import { Router } from "express";
import { TradeOrder, TradeBatch, MatchedPair } from "../models.js";
import { matchTrades } from "../engine/matchingEngine.js";
import { createTradeBatch, insertTradeOrder, updateTradeBatchStatus, insertMatchedPair, getTradeBatch, getAllTradeBatches } from "../db/schema.js";

const router = Router();

/**
 * POST /api/batches - Accept a new trade batch
 */
router.post("/batches", (req, res) => {
    const { orders }: { orders: TradeOrder[] } = req.body;
    
    if (!orders || !Array.isArray(orders) || orders.length === 0) {
        return res.status(400).json({ error: "Orders array is required and cannot be empty" });
    }
    
    // Validate each order
    for (const order of orders) {
        if (!order.symbol || !order.price || !order.size || !order.side || !order.trader_pubkey) {
            return res.status(400).json({ error: "Each order must have symbol, price, size, side, and trader_pubkey" });
        }
        if (order.side !== 'buy' && order.side !== 'sell') {
            return res.status(400).json({ error: "Side must be either 'buy' or 'sell'" });
        }
        if (order.price <= 0 || order.size <= 0) {
            return res.status(400).json({ error: "Price and size must be positive numbers" });
        }
    }
    
    // Create a new batch
    createTradeBatch((batchId) => {
        // Add all orders to the batch
        let ordersProcessed = 0;
        const orderIds: number[] = [];
        
        orders.forEach((order, index) => {
            insertTradeOrder({
                ...order,
                timestamp: new Date().toISOString()
            }, batchId, (orderId) => {
                orderIds[index] = orderId;
                ordersProcessed++;
                
                // When all orders are processed, run matching
                if (ordersProcessed === orders.length) {
                    // Set order IDs on the original orders for matching
                    const ordersWithIds = orders.map((order, i) => ({
                        ...order,
                        id: orderIds[i],
                        // Ensure price and size are numbers
                        price: Number(order.price),
                        size: Number(order.size)
                    }));
                    
                    // Run matching engine
                    const matchedPairs = matchTrades([...ordersWithIds]); // Use copy to avoid modifying original
                    
                    // Store matched pairs
                    let pairsProcessed = 0;
                    if (matchedPairs.length === 0) {
                        // No matches, update batch status and return
                        updateTradeBatchStatus(batchId, 'pending', () => {
                            getTradeBatch(batchId, (batch) => {
                                res.status(201).json(batch);
                            });
                        });
                    } else {
                        matchedPairs.forEach(pair => {
                            insertMatchedPair(batchId, pair, () => {
                                pairsProcessed++;
                                
                                // When all pairs are processed, update batch status
                                if (pairsProcessed === matchedPairs.length) {
                                    updateTradeBatchStatus(batchId, 'matched', () => {
                                        getTradeBatch(batchId, (batch) => {
                                            res.status(201).json(batch);
                                        });
                                    });
                                }
                            });
                        });
                    }
                }
            });
        });
    });
});

/**
 * GET /api/batches - List all trade batches
 */
router.get("/batches", (req, res) => {
    getAllTradeBatches((batches) => {
        res.json(batches);
    });
});

/**
 * GET /api/batches/:id - Fetch a specific trade batch
 */
router.get("/batches/:id", (req, res) => {
    const batchId = parseInt(req.params.id);
    if (isNaN(batchId)) {
        return res.status(400).json({ error: "Invalid batch ID" });
    }
    
    getTradeBatch(batchId, (batch) => {
        if (!batch) {
            return res.status(404).json({ error: "Batch not found" });
        }
        
        res.json(batch);
    });
});

export default router;