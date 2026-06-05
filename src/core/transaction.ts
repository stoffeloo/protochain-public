import invariant from "tiny-invariant";
import type { Address, SignedTransaction, TransactionGraph } from "./types";
import { WorldState } from "./state";
import { hjson, pubkeyToAddress, verifyTx, createContractAddress } from "./crypto";
import { runContract } from "./vm";
import { formatError } from "../error";
import { topoSortTxGraph } from "./txGraph/topoSortTxGraph";

// compute an id for a transaction
export function txId(tx: SignedTransaction) {
  // done by hashing the canonical transaction (no signature) using hjson
  const { signature, ...rest } = tx as any;
  return hjson(rest);
}

// validate a transaction in the context of the given world state
export type TxContext = { blockNumber?: number };

export async function validateTx(tx: SignedTransaction, ws: WorldState, ctx: TxContext = {}) {
  // --- GENESISBLOCK ONLY GENERATION TRANSACTIONS ---
  // These are the only way to mint balance. They are only valid in block #0.
  if (tx.kind === "generation") {
    invariant(ctx.blockNumber === 0, "generation tx only allowed in genesis block (#0)");
    invariant(!!tx.to, "generation requires 'to'");
    invariant(typeof (tx as any).value === "number" && (tx as any).value >= 0, "generation requires value");
    // No signature/pubkey checks for generation transactions, since they are all done by the node's genesis config.
    // No nonce rules either (they do not consume a sender nonce).
    return;
  }

  // 1) Check that pubkey derives to from-address (can only sign transactions for an address if you have the corresponding private key)
  const derived = pubkeyToAddress(tx.pubkey);
  invariant(derived.toLowerCase() === tx.from.toLowerCase(), "from/pubkey mismatch");

  // 2) Verify signature over canonical preimage
  const ok = verifyTx(tx, tx.signature, tx.pubkey);
  invariant(ok, "bad signature");

  // 3) Shape rules (check if each kind of transaction has the required fields)
  invariant(Number.isInteger(tx.nonce) && tx.nonce >= 0, "bad nonce");
  switch (tx.kind) {
    case "transfer":
      invariant(!!tx.to, "transfer requires 'to'");
      break;

    case "deploy":
      invariant(tx.to === undefined, "deploy must not have 'to'");
      invariant(!!tx.data && typeof (tx.data as any).code === "string", "deploy requires data.code:string");
      invariant(!!tx.data && typeof (tx.data as any).metadata === "object", "deploy requires data.metadata:object");
      break;

    case "call":
      invariant(!!tx.to, "call requires 'to'");
      invariant(tx.data !== undefined, "call requires data");
      invariant(typeof tx.data.method === "string" && tx.data.method.length > 0, "call transaction must actually call a method");
      break;
  }
}

export function applyTransfer(ws: WorldState, tx: SignedTransaction) {
  const sender = ws.read(tx.from);
  invariant(sender.nonce === tx.nonce, "nonce mismatch");
  ws.transfer(tx.from, tx.to as Address, tx.value!);
  sender.nonce++; // increment only after successful apply
}

export function applyDeploy(ws: WorldState, tx: SignedTransaction) {
  const sender = ws.read(tx.from);
  invariant(sender.nonce === tx.nonce, "nonce mismatch");
  const contractAddr = createContractAddress(tx.from, tx.nonce);
  const contractCode = (tx.data as any).code;
  const contractMetadata = (tx.data as any).metadata;
  ws.createContract(contractAddr, contractCode, contractMetadata);
  sender.nonce++; // increment only after successful apply
}

export function applyCall(ws: WorldState, tx: SignedTransaction, ctx: TxContext, log?: (contract: Address, msg: string) => void) {
  const clone = ws.clone(); // to be able to revert in case of error during contract execution

  const sender = ws.read(tx.from);
  invariant(sender.nonce === tx.nonce, "nonce mismatch");

  // call transactions can also have a value field
  // ifso, we transfer that value first to the contract address
  // if during the contract execution an error occurs, the whole tx is reverted including this transfer, 
  // this can be due to the require statement in the contract for example
  try {
    // 1. pre-transfer value if any
    if (tx.value && tx.value > 0 ) { ws.transfer(tx.from, tx.to as Address, tx.value); }

    // 2. run contract
    const contractAddr = tx.to as Address;
    const transactionLogger = log ? (msg: string) => log(contractAddr, msg) : undefined;
    runContract(ws, contractAddr, tx, {number: ctx.blockNumber!}, transactionLogger);

    // 3. everything ok, increment nonce
    sender.nonce++; // increment only after successful apply
  } catch (e) {
    // something went wrong, revert entire tx including pre-transfer
    ws.fromClone(clone);
    ws.read(tx.from).nonce++; // still increment nonce, this is how Ethereum does it to avoid replaying the same nonce forever
    const errormsg = e instanceof Error ? e.message : String(e);
    throw new Error( formatError( `Contract execution reverted: ${errormsg} `, 'contract'));
  }
}

export function applyGeneration(ws: WorldState, tx: SignedTransaction) {
  // validateTx enforces genesis-only
  ws.mint(tx.to as Address, (tx as any).value);
}


export async function applyTx(ws: WorldState, tx: SignedTransaction,ctx: TxContext, log?: (contract: Address, msg: string) => void) {
  await validateTx(tx, ws, ctx);
  if (tx.kind === "generation") return applyGeneration(ws, tx);
  if (tx.kind === "transfer") return applyTransfer(ws, tx);
  if (tx.kind === "deploy") return applyDeploy(ws, tx);
  if (tx.kind === "call") return applyCall(ws, tx, ctx, log);
}

export async function executeTxList(ws: WorldState, txs: SignedTransaction[], ctx: TxContext, log?: (contract: Address, msg: string) => void): Promise<void> {
  for (const tx of txs) {
    try {
      await applyTx(ws, tx, ctx, log);
    } catch {
      // Reverted transactions still consume nonce inside applyTx, so we keep
      // replaying the remaining transactions in the block.
    }
  }
}
export async function executeTxGraph(ws: WorldState, txGraph: TransactionGraph, ctx: TxContext, log?: (contract: Address, msg: string) => void): Promise<void> {
  //todo: currenly defaults to topological execution, but we could also support other strategies here (e.g. execute independent txs in parallel)
  await executeTxGraphTopologically(ws, txGraph, ctx, log);
}

async function executeTxGraphTopologically(ws: WorldState, txGraph: TransactionGraph, ctx: TxContext, log?: (contract: Address, msg: string) => void): Promise<void> {
  const order = topoSortTxGraph(txGraph);
  const txs = order.map(id => txGraph.txs[id]!);
  for (const node of txs) 
  {
    if (node.redundant) {
      // Keep redundant txs state-neutral but nonce-consuming to avoid nonce gaps
      // across blocks when superseded txs are included but intentionally not applied.
      try {
        if (node.tx.kind !== "generation") {
          const sender = ws.read(node.tx.from);
          sender.nonce = Math.max(sender.nonce, node.tx.nonce + 1);
        }
      } catch {
        // Ignore invalid redundant txs; they remain non-state-changing no-ops.
      }
      continue;
    }
    try {
      await applyTx(ws, node.tx, ctx, log);
    } catch {
      // Reverted transactions still consume nonce inside applyTx, so we keep
      // replaying the remaining transactions in the block.
    }
  }    
}