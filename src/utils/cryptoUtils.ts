"use strict";

import tweetnacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP: Record<string, number> = {};
for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    BASE58_MAP[BASE58_ALPHABET[i]] = i;
}

export function decodeBase58(str: string): Uint8Array {
    if (str.length === 0) return new Uint8Array(0);
    const bytes = [0];
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (!(c in BASE58_MAP)) throw new Error("Non-base58 character");
        let carry = BASE58_MAP[c];
        for (let j = 0; j < bytes.length; j++) {
            carry += bytes[j] * 58;
            bytes[j] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    for (let i = 0; i < str.length && str[i] === "1"; i++) {
        bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
}

export function verifySolanaSignature(
    publicKeyBase58: string,
    message: string,
    signatureBase58: string
): boolean {
    try {
        const messageBytes = new TextEncoder().encode(message);
        const signatureBytes = decodeBase58(signatureBase58);
        const publicKeyBytes = new PublicKey(publicKeyBase58).toBytes();
        return tweetnacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch (e) {
        console.error("Signature verification error:", e);
        return false;
    }
}

export function verifyIntentSignature(intent: {
    ownerWallet: string;
    inputMint: string;
    outputMint: string;
    amountIn: string | number;
    side: string;
    maxSlippageBps: number;
    blindingFactor: string;
    signature: string;
}): boolean {
    const message = `Vella Intent: ownerWallet=${intent.ownerWallet}, inputMint=${intent.inputMint}, outputMint=${intent.outputMint}, amountIn=${intent.amountIn}, side=${intent.side}, maxSlippageBps=${intent.maxSlippageBps}, blindingFactor=${intent.blindingFactor}`;
    return verifySolanaSignature(intent.ownerWallet, message, intent.signature);
}

export function verifyAgentPermissionSignature(permission: {
    ownerWallet: string;
    agentName: string;
    maxTradeAmount: string | number;
    maxDailyVolume: string | number;
    maxSlippageBps: number;
    canAutoExecute: boolean;
    allowedInputMints: string[];
    allowedOutputMints: string[];
    walletSignature: string;
}): boolean {
    const allowedInputs = Array.isArray(permission.allowedInputMints) ? permission.allowedInputMints.join(",") : "";
    const allowedOutputs = Array.isArray(permission.allowedOutputMints) ? permission.allowedOutputMints.join(",") : "";
    const message = `Vella Agent Permission: ownerWallet=${permission.ownerWallet}, agentName=${permission.agentName}, maxTradeAmount=${permission.maxTradeAmount}, maxDailyVolume=${permission.maxDailyVolume}, maxSlippageBps=${permission.maxSlippageBps}, canAutoExecute=${permission.canAutoExecute}, allowedInputMints=${allowedInputs}, allowedOutputMints=${allowedOutputs}`;
    return verifySolanaSignature(permission.ownerWallet, message, permission.walletSignature);
}
