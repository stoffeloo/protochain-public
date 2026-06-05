import { hmac } from '@noble/hashes/hmac';
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils";
import { keccak_256 } from "@noble/hashes/sha3";
import * as secp from "@noble/secp256k1";
import { Hex, Address } from './types';

//nodig om secp te laten werken
secp.etc.hmacSha256Sync = (k, ...m) => hmac(sha256, k, secp.etc.concatBytes(...m))

// hex helper functions
export const hex = (u: Uint8Array): Hex => (`0x${bytesToHex(u)}` as const);

export const fromHex = (h: Hex | string): Uint8Array =>
  hexToBytes(h.startsWith("0x") ? h.slice(2) : h);

// Hash of a JSON-able object (useful for IDs, logs, etc.)
export const hjson = (obj: unknown): Hex =>
  hex(sha256(utf8ToBytes(JSON.stringify(obj))));

// simple address rule using sha256(pubkey)'s last 20 bytes as address
export function pubkeyToAddress(pubHex: Hex): Hex {
  const h = sha256(fromHex(pubHex));
  return (`0x${bytesToHex(h.slice(-20))}`) as Hex;
}

// canonicalization for signatures
export function canonicalizeTxForSig<T extends Record<string, any>>(tx: T) {
  // exclude the signature from the signable preimage
  const { signature, ...rest } = tx;
  return rest;
}

function txMessageBytes(tx: any): Uint8Array {
  return utf8ToBytes(JSON.stringify(canonicalizeTxForSig(tx)));
}

export function txHashForSig(tx: any): Hex {
  return hex(sha256(txMessageBytes(tx)));
}

// signing & verification using noble v2 prehashes with SHA-256
// SIGN: Signature -> compact hex (64 bytes)
export function signTx(tx: any, priv: Uint8Array): Hex {
    const msg32 = sha256(txMessageBytes(tx));     // 32-byte hash
    const sig = secp.sign(msg32, priv);           // sync in v2+
    return (`0x${sig.toCompactHex()}`) as Hex;    // use toCompactHex()
  }
  
  // VERIFY: rebuild Signature from compact hex, then verify
  export function verifyTx(tx: any, signature: Hex, pubHex: Hex): boolean {
    const msg32 = sha256(txMessageBytes(tx));
    const sigObj = secp.Signature.fromCompact(hexToBytes(signature.slice(2)));
    const pub = hexToBytes(pubHex.slice(2));
    return secp.verify(sigObj, msg32, pub);
  }

// Encode an unsigned 64-bit integer in big-endian
function u64be(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`u64be expects a non-negative safe integer, got ${n}`);
  }

  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, BigInt(n), false);  // use BigInt internally only
  return new Uint8Array(buf);
}

/**
 * Deterministic contract address
 */
export function createContractAddress(
  deployer: Address,
  deployerNonce: number, // no bigint in the public type
): Address {
  const preimage = concatBytes(
    utf8ToBytes("PROTOCHAIN|CREATE|v1"),  // domain separation to prevent cross-domain collision
                                          // otherwise contract addresses could collide with e.g. the hash of the deployer + nonce in this case
                                          // todo: never done before, check if I should add this in other places as well
    hexToBytes(deployer.slice(2)),
    u64be(deployerNonce),
  );
  const h = sha256(preimage);
  const addr = h.slice(-20);
  return ("0x" + bytesToHex(addr)) as Address;
}