"use strict";

import { LiquiditySnapshot, RouteConstraints } from "../models.js";

type RouteInput = {
    inputMint: string;
    outputMint: string;
    amountIn: string;
    maxSlippageBps?: number;
    routeConstraints?: RouteConstraints;
};

const TOKEN_PRICE_HINTS: Record<string, number> = {
    SOL: 145,
    USDC: 1,
    USDT: 1,
    BONK: 0.00002,
    JUP: 0.9,
    RAY: 1.8
};

function mintHint(mint: string): number {
    const normalized = mint.toUpperCase();
    return TOKEN_PRICE_HINTS[normalized] ?? 1;
}

function toNumberAmount(amount: string): number {
    const parsed = Number(amount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function quoteAmount(inputMint: string, outputMint: string, amountIn: string, liquidity: number, feeBps: number): string {
    const amount = toNumberAmount(amountIn);
    const priceRatio = mintHint(inputMint) / mintHint(outputMint);
    const utilizationImpact = Math.min(0.08, amount / Math.max(liquidity, 1));
    const afterFee = amount * priceRatio * (1 - feeBps / 10000) * (1 - utilizationImpact);
    return afterFee.toFixed(6);
}

export function getLiquidityRoutes(input: RouteInput): LiquiditySnapshot[] {
    const now = new Date().toISOString();
    const routes: LiquiditySnapshot[] = [];
    const amount = toNumberAmount(input.amountIn);
    const constraints = input.routeConstraints ?? { allowJupiter: true, allowRaydium: true };

    if (constraints.allowJupiter !== false) {
        const liquidity = Math.max(750_000, amount * 80);
        routes.push({
            inputMint: input.inputMint,
            outputMint: input.outputMint,
            source: "jupiter",
            poolOrRouteId: `jupiter-${input.inputMint}-${input.outputMint}-best`,
            availableLiquidity: liquidity.toFixed(2),
            quotedAmountOut: quoteAmount(input.inputMint, input.outputMint, input.amountIn, liquidity, 18),
            priceImpactPct: Math.min(2.5, (amount / liquidity) * 100),
            feeBps: 18,
            routeHops: Math.min(constraints.maxRouteHops ?? 3, 3),
            observedAt: now
        });
    }

    if (constraints.allowRaydium !== false) {
        const liquidity = Math.max(1_200_000, amount * 120);
        routes.push({
            inputMint: input.inputMint,
            outputMint: input.outputMint,
            source: "raydium",
            poolOrRouteId: `raydium-${input.inputMint}-${input.outputMint}-deep`,
            availableLiquidity: liquidity.toFixed(2),
            quotedAmountOut: quoteAmount(input.inputMint, input.outputMint, input.amountIn, liquidity, 25),
            priceImpactPct: Math.min(2, (amount / liquidity) * 100),
            feeBps: 25,
            routeHops: 1,
            observedAt: now
        });
    }

    return routes
        .filter(route => !constraints.excludedPools?.includes(route.poolOrRouteId))
        .filter(route => Math.round(route.priceImpactPct * 100) <= (input.maxSlippageBps ?? 10_000))
        .sort((a, b) => Number(b.quotedAmountOut) - Number(a.quotedAmountOut));
}

export function selectBestRoute(routes: LiquiditySnapshot[]): LiquiditySnapshot | null {
    return routes[0] ?? null;
}
