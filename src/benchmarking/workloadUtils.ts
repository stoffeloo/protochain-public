import * as secp from "@noble/secp256k1";
import { Address, asUInt, GenesisConfig, UInt } from "../core/types";
import { hex, pubkeyToAddress } from "../core/crypto";

export function buildAccounts(count: number): {
    addresses: Address[];
    privateKeys: Uint8Array[];
} {
    const addresses: Address[] = [];
    const privateKeys: Uint8Array[] = [];

    for (let i = 0; i < count; i++) {
        const priv = secp.utils.randomPrivateKey();
        const pub = secp.getPublicKey(priv, true);
        const addr = pubkeyToAddress(hex(pub));
        addresses.push(addr);
        privateKeys.push(priv);
    }

    return { addresses, privateKeys };
}

export function createGenesisWithAllocations(addresses: Address[], initialBalance: UInt): GenesisConfig {
    const alloc: Record<Address, UInt> = {};

    for (const addr of addresses) {
        alloc[addr] = initialBalance;
    }

    return { alloc };
}