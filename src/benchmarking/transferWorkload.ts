import * as secp from "@noble/secp256k1";
import { Address, asUInt, GenesisConfig, SignedTransaction, TransferTx, UInt } from "../core/types";
import { hex, pubkeyToAddress, signTx } from "../core/crypto";
import { TransferWorkloadConfig, BenchmarkWorkload } from "./types";
import { buildAccounts, createGenesisWithAllocations } from "./workloadUtils";
import { pickRecipient } from "./transactionGenerationUtils";

export function generateTransferWorkload(cfg: TransferWorkloadConfig): BenchmarkWorkload {
    if (cfg.accounts < 1) throw new Error("workload must have at least 1 account");
    if (cfg.txsPerAccount < 1) throw new Error("workload must have at least 1 tx per account");

    const totalTxs = cfg.accounts * cfg.txsPerAccount;

    const { addresses, privateKeys } = buildAccounts(cfg.accounts);
    const totalOutgoingPerSender = cfg.txsPerAccount * cfg.txValue;
    const genesis = createGenesisWithAllocations(addresses, asUInt(totalOutgoingPerSender));
    const txs: SignedTransaction[] = [];

    let globalIndex = 0;

    for (let i = 0; i < addresses.length; i++) {
        const from = addresses[i]!;
        const priv = privateKeys[i]!;
        const pub = secp.getPublicKey(priv, true);

        let nonce = 0;

        for (let t = 0; t < cfg.txsPerAccount; t++) {
            const to = pickRecipient(i, addresses, cfg.recipientPattern, globalIndex);
            const value = asUInt(cfg.txValue);

            const unsignedTx: TransferTx = {
                kind: "transfer",
                from,
                to,
                value,
                nonce: nonce++,
                pubkey: hex(pub),
            }

            const signedTx: SignedTransaction = {
                ...unsignedTx,
                signature: signTx(unsignedTx, priv),
            };

            txs.push(signedTx);
            globalIndex++;
        }
    }
    return { genesis, txs };
}