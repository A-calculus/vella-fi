import { ExecutionBatch, TradeIntent } from "../models.js";
import { createCommitmentRoot } from "../privacy/commitments.js";

type BatchPlan = {
    batch: ExecutionBatch;
    intents: TradeIntent[];
};

export function buildBatchPlans(intents: TradeIntent[]): BatchPlan[] {
    const plans: BatchPlan[] = [];

    // Group intents by inputMint, outputMint, and side
    const groupedIntents = new Map<string, TradeIntent[]>();
    intents.forEach(intent => {
        const key = `${intent.inputMint}:${intent.outputMint}:${intent.side}`;
        const list = groupedIntents.get(key) ?? [];
        list.push(intent);
        groupedIntents.set(key, list);
    });

    for (const [key, list] of groupedIntents.entries()) {
        // Sort intents by createdAt ASC
        const sorted = list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        let currentBatchIntents: TradeIntent[] = [];
        let batchAllowJupiter = true;
        let batchAllowRaydium = true;
        let batchExcludedPools: string[] = [];
        let batchMaxRouteHops: number | undefined = undefined;
        let batchWindowExpiry: number | null = null;

        for (const intent of sorted) {
            const intentTime = new Date(intent.createdAt).getTime();
            const intentAllowJup = intent.routeConstraints?.allowJupiter ?? true;
            const intentAllowRay = intent.routeConstraints?.allowRaydium ?? true;
            const intentExcluded = intent.routeConstraints?.excludedPools ?? [];
            const intentMaxHops = intent.routeConstraints?.maxRouteHops;

            const nextAllowJupiter = batchAllowJupiter && intentAllowJup;
            const nextAllowRaydium = batchAllowRaydium && intentAllowRay;
            const hasCompatibleProviders = nextAllowJupiter || nextAllowRaydium;

            const isWithinWindow = batchWindowExpiry === null || intentTime <= batchWindowExpiry;

            if (currentBatchIntents.length > 0 && hasCompatibleProviders && isWithinWindow) {
                // Add to current batch
                currentBatchIntents.push(intent);
                batchAllowJupiter = nextAllowJupiter;
                batchAllowRaydium = nextAllowRaydium;
                batchExcludedPools = Array.from(new Set([...batchExcludedPools, ...intentExcluded]));
                if (batchMaxRouteHops !== undefined && intentMaxHops !== undefined) {
                    batchMaxRouteHops = Math.min(batchMaxRouteHops, intentMaxHops);
                } else {
                    batchMaxRouteHops = batchMaxRouteHops ?? intentMaxHops;
                }
            } else {
                // If there's an active batch, push it to plans
                if (currentBatchIntents.length > 0) {
                    plans.push(createPlanFromIntents(currentBatchIntents, batchAllowJupiter, batchAllowRaydium, batchExcludedPools, batchMaxRouteHops));
                }

                // Start new batch
                currentBatchIntents = [intent];
                batchAllowJupiter = intentAllowJup;
                batchAllowRaydium = intentAllowRay;
                batchExcludedPools = [...intentExcluded];
                batchMaxRouteHops = intentMaxHops;
                batchWindowExpiry = intentTime + (intent.executionWindowMs ?? 30000);
            }
        }

        if (currentBatchIntents.length > 0) {
            plans.push(createPlanFromIntents(currentBatchIntents, batchAllowJupiter, batchAllowRaydium, batchExcludedPools, batchMaxRouteHops));
        }
    }

    return plans;
}

function createPlanFromIntents(
    intents: TradeIntent[],
    allowJupiter: boolean,
    allowRaydium: boolean,
    excludedPools: string[],
    maxRouteHops?: number
): BatchPlan {
    const totalAmount = intents.reduce((sum, intent) => sum + BigInt(intent.amountIn), 0n);
    const commitments = intents.map(intent => intent.intentCommitment ?? "");

    return {
        intents,
        batch: {
            inputMint: intents[0].inputMint,
            outputMint: intents[0].outputMint,
            totalAmountIn: totalAmount.toString(),
            intentCount: intents.length,
            aggregationWindowStartedAt: intents[0].createdAt,
            aggregationWindowClosedAt: new Date().toISOString(),
            status: "forming",
            commitmentRoot: createCommitmentRoot(commitments)
        }
    };
}
