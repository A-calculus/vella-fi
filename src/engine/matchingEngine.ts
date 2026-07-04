"use strict";

import { TradeOrder, MatchedPair } from "../models.js";

/***
 * FIFO matching engine - matches buy and sell orders at midpoint price
 * @param orders Array of TradeOrder objects
 * @returns Array of MatchedPair objects
 */
export function matchTrades(orders: TradeOrder[]): MatchedPair[] {
    // Separate buy and sell orders
    const buys = orders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price); // Highest buy first
    const sells = orders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price); // Lowest sell first
    
    const matched: MatchedPair[] = [];
    let buyIdx = 0, sellIdx = 0;
    
    // FIFO matching algorithm - only match orders with same symbol
    while (buyIdx < buys.length && sellIdx < sells.length) {
        const buyOrder = buys[buyIdx];
        const sellOrder = sells[sellIdx];
        
        // Only match orders with the same symbol
        if (buyOrder.symbol !== sellOrder.symbol) {
            // Skip orders with different symbols
            if (buyOrder.symbol < sellOrder.symbol) {
                buyIdx++;
            } else {
                sellIdx++;
            }
            continue;
        }
        
        // Check if orders can be matched (buy price >= sell price)
        if (buyOrder.price >= sellOrder.price) {
            // Determine the matched size (minimum of both order sizes)
            const matchedSize = Math.min(buyOrder.size, sellOrder.size);
            
            // Calculate matched price (midpoint)
            const matchedPrice = (buyOrder.price + sellOrder.price) / 2;
            
            // Calculate PnL (seller's perspective: matched price - original sell price)
            const pnl = (matchedPrice - sellOrder.price) * matchedSize;
            
            // Create matched pair
            matched.push({
                buyOrder: buyOrder,
                sellOrder: sellOrder,
                matchedPrice: matchedPrice,
                matchedSize: matchedSize,
                pnl: pnl
            });
            
            // Update order sizes
            buyOrder.size -= matchedSize;
            sellOrder.size -= matchedSize;
            
            // If buy order is fully filled, move to next buy order
            if (buyOrder.size === 0) {
                buyIdx++;
            }
            
            // If sell order is fully filled, move to next sell order
            if (sellOrder.size === 0) {
                sellIdx++;
            }
        } else {
            // No more matches possible
            break;
        }
    }
    
    return matched;
}

/***
 * Determine winner and loser based on PnL for settlement
 * @param matchedPair MatchedPair to determine winner/loser for
 * @returns Object with winner and loser public keys
 */
export function determineWinnerLoser(matchedPair: MatchedPair): { winner: string, loser: string } {
    // Winner is the trader with positive PnL (seller in this case)
    // Loser is the trader with negative PnL (effectively the buyer)
    return {
        winner: matchedPair.sellOrder.trader_pubkey, // Seller gets positive PnL
        loser: matchedPair.buyOrder.trader_pubkey   // Buyer gets negative PnL
    };
}