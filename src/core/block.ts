import { asUInt, ExecutionMode, TransactionGraph, type Address, type Block, type BlockHeader, type GenerationTx, type GenesisConfig, type Hash, type SignedTransaction } from "./types";
import { WorldState } from "./state";
import { hjson } from "./crypto";
import { GENESIS_PARENT_HASH, ZERO_ADDRESS, ZERO_HEX } from "../constants";
import { executeTxGraph, executeTxList } from "./transaction";
import { buildSequentialTxGraphFromTxs, buildTxGraphFromTxs, txGraphRoot } from "./txGraph/txgraph";

export function stateRoot(ws: WorldState): Hash {
  return hjson(ws.snapshotObj()) as Hash;
}

export async function buildGenesisBlock(ws: WorldState, genesisConfig?: GenesisConfig): Promise<{ block: Block, ws: WorldState }> {
  const blockLogs: { contract: Address; msg: string }[] = [];
  const log = (contract: Address, msg: string) => {
    blockLogs.push({ contract, msg });
  };

  const txs: SignedTransaction[] = [];

  if (genesisConfig) {
    for (const [address, balance] of Object.entries(genesisConfig.alloc)) { //todo: prolly a neater way to do this for loop
      const genTx: GenerationTx = {
        kind: "generation",
        from: ZERO_ADDRESS,
        to: address as Address,
        value: asUInt(balance),
        nonce: 0,
        pubkey: ZERO_HEX
      };
      const signedGenTx: SignedTransaction = { ...genTx, signature: ZERO_HEX };
      txs.push(signedGenTx);
    }
  }

  const transactionGraph: TransactionGraph = buildSequentialTxGraphFromTxs(txs);
  const wsClone = ws.clone();
  await executeTxGraph(wsClone, transactionGraph, { blockNumber: 0 }, log);

  const header: BlockHeader = {
    parentHash: GENESIS_PARENT_HASH,
    number: 0,
    timestamp: 0, // Date.now() would make genesis non-deterministic, but this is for all blocks and I think all of them must be deterministic so need to cahnge everywhere?
    transactionRoot: txGraphRoot(transactionGraph),
    stateRoot: stateRoot(wsClone), // cloned world state after applying the block's transactions
    proposer: ZERO_ADDRESS,
  };

  const genesisBlock: Block = { header, txGraph: transactionGraph, hash: hjson(header) as Hash, logs: blockLogs };
  return { block: genesisBlock, ws: wsClone };
}

//even when executionMode is list and not graph, we return a graph, but a sequentialTxGraph, we have to do a graph, since the block type etc all expect graphs, be we will just do a sequential list execution during execution etc, to is a ugly detail, check if this is good enough or if we should refactor block etc
export async function buildBlock(
  parent: Block | null, // null in case of genesis block
  proposer: string, // node that proposes the block
  txs: SignedTransaction[],
  ws: WorldState,
  executionMode: ExecutionMode,
  maxTxsPerBlock: number,
): Promise<Block> {

  const blockLogs: { contract: Address; msg: string }[] = [];
  const log = (contract: Address, msg: string) => {
    blockLogs.push({ contract, msg });
  };

  if (txs.length > maxTxsPerBlock) {
    throw new Error(`Block has ${txs.length} txs, max ${maxTxsPerBlock} transactions allowed per block`);
  }

  const blockNumber = parent!.header.number + 1;

  // if executionMode is list we use the sequential version to build the graph, otherwise the normal version,
  // sequential version just gives us a graph with edges to the previous tx in the list, so it is easly interpretable as a list
  const transactionGraph: TransactionGraph = executionMode === "list" ? buildSequentialTxGraphFromTxs(txs) : buildTxGraphFromTxs(txs, ws);

  // simulate applying the transactions to get the new state root after applying the block without mutating the current world state
  const wsClone = ws.clone();

  if (executionMode === "list") {
    await executeTxList(wsClone, txs, { blockNumber: blockNumber }, log);

  } else {
    await executeTxGraph(wsClone, transactionGraph, { blockNumber: blockNumber }, log);

  }


  const header: BlockHeader = {
    parentHash: parent!.hash,
    number: blockNumber,
    // Genesis block must be deterministic across nodes.
    timestamp: Date.now(),
    transactionRoot: txGraphRoot(transactionGraph),
    stateRoot: stateRoot(wsClone), // cloned world state after applying the block's transactions
    proposer: proposer as any,
  };

  const block: Block = { header, txGraph: transactionGraph, hash: hjson(header) as Hash, logs: blockLogs };
  return block;
}

export async function appendBlock(
  chain: Block[],
  ws: WorldState,
  block: Block,
  executionMode: ExecutionMode,
  maxTxsPerBlock: number,
): Promise<void> {
  const supposedParent = chain.at(-1);

  //  Allow genesis as the first block in an empty chain (needed for rebuildChainFromPath)
  if (!supposedParent) {
    if (block.header.number !== 0) {
      throw new Error("Cannot append non-genesis block to empty chain");
    }
    if (block.header.parentHash !== GENESIS_PARENT_HASH) {
      throw new Error("bad genesis parentHash");
    }

    // Verify genesis roots
    const tmp = ws.clone();
    await executeTxGraph(tmp, block.txGraph, { blockNumber: 0 });
    if (txGraphRoot(block.txGraph) !== block.header.transactionRoot) throw new Error("bad genesis txRoot");
    if (stateRoot(tmp) !== block.header.stateRoot) throw new Error("bad genesis stateRoot");

    // Apply
    await executeTxGraph(ws, block.txGraph, { blockNumber: 0 });
    chain.push(block);
    return;
  }

  // Normal block checks...
  if (block.header.number !== supposedParent.header.number + 1) throw new Error("bad block number");
  if (Object.keys(block.txGraph.txs).length > maxTxsPerBlock) throw new Error("Invalid block: too many transactions");
  if (block.header.parentHash !== supposedParent.hash) throw new Error("bad parent link");  // de vorige block van de binnenkomende block is niet de laatste block in de chain

  const tmp = ws.clone();
  if (executionMode === "list") {
    const txList = Object.values(block.txGraph.txs).map(node => node.tx);
    await executeTxList(tmp, Object.values(txList), { blockNumber: block.header.number });
  } else {
    await executeTxGraph(tmp, block.txGraph, { blockNumber: block.header.number });
  }
  if (txGraphRoot(block.txGraph) !== block.header.transactionRoot) throw new Error("bad txRoot");
  if (stateRoot(tmp) !== block.header.stateRoot) throw new Error("bad stateRoot");

  if (executionMode === "list") {
    const txList = Object.values(block.txGraph.txs).map(node => node.tx);
    await executeTxList(ws, txList, { blockNumber: block.header.number });
  }
  else {
    await executeTxGraph(ws, block.txGraph, { blockNumber: block.header.number });
  }
  chain.push(block);
}
