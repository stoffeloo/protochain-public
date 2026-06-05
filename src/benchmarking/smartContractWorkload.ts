import * as secp from "@noble/secp256k1";
import { Address, asUInt, SignedTransaction, DeployTx, CallTx } from "../core/types";
import { hex, signTx, createContractAddress } from "../core/crypto";
import { contractToCode } from "../core/contractToCode";
import { RetryLaterWhen, SmartContractWorkload, SmartContractWorkloadConfig, SmartContractMethodConfig } from "./types";
import { buildAccounts, createGenesisWithAllocations } from "./workloadUtils";

export function generateSmartContractWorkload(cfg: SmartContractWorkloadConfig): SmartContractWorkload {
    if (cfg.accounts < 1) throw new Error("workload must have at least 1 account");
    if (cfg.methods.length === 0) throw new Error("workload must have at least 1 method to benchmark");

    const { addresses, privateKeys } = buildAccounts(cfg.accounts);

    // Pick a random deployer account (deploys do not take money)
    const deployerIndex = Math.floor(Math.random() * addresses.length);
    const deployerAddress = addresses[deployerIndex]!;
    const deployerPriv = privateKeys[deployerIndex]!;
    const deployerPub = secp.getPublicKey(deployerPriv, true);

    const genesis = createGenesisWithAllocations(addresses, asUInt(cfg.fundsPerAccount));
    const maxTxsPerBlock = cfg.maxTxsPerBlock ?? 100;

    // Create deploy transaction
    const contractCode = contractToCode(cfg.smartContract);
    const deployTx: DeployTx = {
        kind: "deploy",
        from: deployerAddress,
        nonce: 0,
        pubkey: hex(deployerPub),
        data: {
            code: contractCode,
            metadata: cfg.smartContractMetadata,
        },
    };

    const signedDeployTx: SignedTransaction = {
        ...deployTx,
        signature: signTx(deployTx, deployerPriv),
    };

    // Calculate contract address
    const contractAddress = createContractAddress(deployerAddress, deployTx.nonce);

    // Generate all call transactions in randomized order
    const callTxs: SignedTransaction[] = [];
    let nextTransactionIndex = 1;

    // Create a map to track nonce per address (deployer has nonce 1 after deployment)
    const addressNonceMap = new Map<Address, number>();
    addresses.forEach((addr) => {
        addressNonceMap.set(addr, addr === deployerAddress ? 1 : 0);
    });

    // Build method count map and track total calls
    type MethodCountEntry = {
        config: SmartContractMethodConfig;
        remainingNormal: number;
        remainingFailed: number;
    };

    const methodCounts = new Map<string, MethodCountEntry>();
    let totalMethodCalls = 0;
    for (const method of cfg.methods) {
        const normalCount = Math.max(0, method.normalCount);
        const forceFailedCount = Math.max(0, method.forceFailedCount);
        if (normalCount + forceFailedCount < 1) continue;
        methodCounts.set(method.method, {
            config: method,
            remainingNormal: normalCount,
            remainingFailed: forceFailedCount,
        });
        totalMethodCalls += normalCount + forceFailedCount;
    }

    const processCall = (method: SmartContractMethodConfig, kind: "normal" | "failed") => {
        let possibleAddresses = addresses;
        if (cfg.parameterGenerator?.suggestPossibleAccounts) {
            const suggested = cfg.parameterGenerator.suggestPossibleAccounts(method.method, addresses, kind, nextTransactionIndex, maxTxsPerBlock);
            if (suggested === RetryLaterWhen || suggested.length === 0) {
                return false;
            }
            possibleAddresses = suggested;
        }

        // Pick a random caller from all addresses or the suggested subset
        const randomIndex = Math.floor(Math.random() * possibleAddresses.length);
        const callerAddress = possibleAddresses[randomIndex]!;
        const keyIndex = addresses.indexOf(callerAddress);
        if (keyIndex < 0) {
            return false;
        }
        const callerPriv = privateKeys[keyIndex]!;
        const callerPub = secp.getPublicKey(callerPriv, true);

        // Get nonce for this address. We only increment after we know the transaction will be emitted.
        const currentNonce = addressNonceMap.get(callerAddress)!;

        const generatedCall = cfg.parameterGenerator
            ? (kind === "normal"
                ? cfg.parameterGenerator.generateParameter(method.method, callerAddress, addresses, nextTransactionIndex, totalMethodCalls, maxTxsPerBlock)
                : cfg.parameterGenerator.generateFailedParameters(method.method, callerAddress, addresses, nextTransactionIndex, maxTxsPerBlock))
            : undefined;

        if (generatedCall === RetryLaterWhen) {
            return false;
        }

        addressNonceMap.set(callerAddress, currentNonce + 1);

        const params = method.params ?? generatedCall?.params ?? [];
        const txValue = generatedCall?.transferValue ?? method.value ?? 0;

        const callTx: CallTx = {
            kind: "call",
            from: callerAddress,
            to: contractAddress,
            nonce: currentNonce,
            pubkey: hex(callerPub),
            data: {
                method: method.method,
                args: params,
            },
            value: asUInt(txValue),
        };

        const signedCallTx: SignedTransaction = {
            ...callTx,
            signature: signTx(callTx, callerPriv),
        };

        callTxs.push(signedCallTx);
        nextTransactionIndex += 1;
        return true;
    };

    // Randomly pick methods from methodCounts until exhausted
    let noProgressIterations = 0;
    const maxNoProgressIterations = Math.max(1000, totalMethodCalls * 50);
    while (totalMethodCalls > 0 && methodCounts.size > 0) {
        const availableMethods = Array.from(methodCounts.entries()).filter(([, entry]) => entry.remainingNormal + entry.remainingFailed > 0);
        if (availableMethods.length === 0) {
            break;
        }

        const randomIndex = Math.floor(Math.random() * availableMethods.length);
        const [methodName, entry] = availableMethods[randomIndex]!;

        const totalRemainingForMethod = entry.remainingNormal + entry.remainingFailed;
        const kind: "normal" | "failed" = entry.remainingNormal > 0 && entry.remainingFailed > 0
            ? (Math.floor(Math.random() * totalRemainingForMethod) < entry.remainingNormal ? "normal" : "failed")
            : entry.remainingNormal > 0
                ? "normal"
                : "failed";

        const generated = processCall(entry.config, kind);
        if (!generated) {
            noProgressIterations += 1;
            if (noProgressIterations >= maxNoProgressIterations) {
                const remainingByMethod = Array.from(methodCounts.entries())
                    .map(([name, m]) => `${name}(normal=${m.remainingNormal},failed=${m.remainingFailed})`)
                    .join(", ");
                throw new Error(
                    `Smart contract workload generation made no progress after ${noProgressIterations} attempts. ` +
                    `Remaining calls=${totalMethodCalls}. Remaining by method: [${remainingByMethod}]. ` +
                    `Ensure parameter generator can provide valid callers/params or implement suggestPossibleAccounts ` +
                    `for methods that have caller constraints.` +
                    `Generator state: ${JSON.stringify(cfg.parameterGenerator?.state)}`
                );
            }
            continue;
        }

        noProgressIterations = 0;

        if (kind === "normal") {
            entry.remainingNormal -= 1;
        } else {
            entry.remainingFailed -= 1;
        }
        totalMethodCalls -= 1;
        if (entry.remainingNormal + entry.remainingFailed <= 0) {
            methodCounts.delete(methodName);
        }
    }

    const allTxs = [signedDeployTx, ...callTxs];

    return {
        genesis,
        txs: allTxs,
        contractAddress,
        methods: cfg.methods,
    };
} 