import { ExecutionMode, type Address, type Block, type GenesisConfig, type Hash, type MiningSpeedConfig, type SignedTransaction } from "./types";
import { WorldState } from "./state";
import { appendBlock, buildBlock, buildGenesisBlock } from "./block";
import { GENESIS_PARENT_HASH } from "../constants";
import { applyTx, txId } from "./transaction";
import { formatError } from "../error";
import { buildTxGraphFromTxs } from "./txGraph/txgraph";
import { topoSortTxGraph } from "./txGraph/topoSortTxGraph";

export class Node {
  ws = new WorldState();
  chain: Block[] = []; // Canonical chain (best chain according to longest chain rule)
  mempool: SignedTransaction[] = []; // Pending transactions
  failedTransactions = new Map<Hash, SignedTransaction>();
  running = false;
  timer: any;
  maxTxsPerBlock: number;

  onBlockProduced?: (block: Block) => void; // hook that is called wehenever a block is produced
  private allBlocks = new Map<Hash, Block>(); // all blocks known to this node, indexed by hash
  private bestHeadHash: Hash | null = null; // hash of the current canonical head (last block in the chain)
  private genesisConfig: GenesisConfig | undefined;

  // hooks used for benchmarking
  beforeBlockBuild?: (blockNumber: number) => void;
  afterBlockBuild?: (block: Block) => void;
  beforeBlockAppend?: (block: Block) => void;
  afterBlockAppend?: (block: Block) => void;
  beforeBlockAdd?: (block: Block) => void; // hook that is called whenever a block is added to the chain, either by production or by receiving a new block from the network
  afterBlockAdd?: (block: Block) => void; // hook that is called whenever a block is added to the chain, either by production or by receiving a new block from the network

  constructor(
    public proposer: Address, 
    public miningPower = 1, 
    public miningSpeed: MiningSpeedConfig = { defaultMineSpeed: 1000 },
    public executionMode: ExecutionMode = "graph",
    genesis?: GenesisConfig,
    maxTxsPerBlock = 100)
    {
    this.genesisConfig = genesis;
    this.maxTxsPerBlock = maxTxsPerBlock;
    if (this.miningPower <= 0) {
      throw new Error("miningPower must be > 0");
    }
  }

  submitTx(tx: SignedTransaction): 'accepted' | 'duplicate' {
    if (tx.kind === 'generation') {
      throw new Error("generation transactions may only appear in the genesis block (#0)");
    }

    for (const transaction of this.mempool) {
      if (txId(transaction) === txId(tx)) { //tx already in mempool
        return 'duplicate';
      }
    }

    const account = this.ws.read(tx.from);
    if (tx.nonce < account.nonce) { // nonce already used
      return 'duplicate';
    }

    this.mempool.push(tx);
    this.failedTransactions.delete(txId(tx));
    return 'accepted';
  }

  async batchSubmit(txs: SignedTransaction[]): Promise<Map<string, 'accepted' | 'duplicate'>> {
    const results = new Map<string, 'accepted' | 'duplicate'>();
    
    for (const tx of txs) {
      const id = txId(tx);
      const status = this.submitTx(tx);
      results.set(id, status);
      
      // Yield the event loop to allow block production to happen concurrently
      await new Promise(resolve => setImmediate(resolve));
    }
    
    return results;
  }

  getTxCount(addr: Address, includeMempool: Boolean): number {
    let count = this.ws.read(addr).nonce;
    if (includeMempool) {
      for (const tx of this.mempool) {
        if (tx.from === addr) count++;
      }
    }
    return count;
  }

  hasBlock(hash: Hash): boolean {
    return this.allBlocks.has(hash);
  }

  pruneMempoolForBlock(block: Block) {
    // const blockTxIds = new Set(block.txs.map(tx => txId(tx)));
    const blockTxIds = new Set(Object.values(block.txGraph.txs).map(node => txId(node.tx)));
    this.mempool = this.mempool.filter(tx => !blockTxIds.has(txId(tx)));
  }

  async start() {
    if (this.running) return;

    // every node that starts must have a genesis block
    // (even when no genesis config is provided)
    if (this.chain.length === 0) {
      const { block: genesisBlock, ws: newWs } = await buildGenesisBlock(this.ws, this.genesisConfig);
      this.ws = newWs;
      this.chain.push(genesisBlock);
      this.allBlocks.set(genesisBlock.hash, genesisBlock);
      this.bestHeadHash = genesisBlock.hash;
    }

    this.running = true;
    this.startMining();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  // "mining", to simulate the mining of blocks, let the node "mine" for a random time, and after that time it produces a block
  private mineSpeedBaseMs(): number {
    if ("defaultMineSpeed" in this.miningSpeed) {
      return this.miningSpeed.defaultMineSpeed;
    }

    const { minTime, maxTime } = this.miningSpeed.defaultMineSpeedInterval;
    if (maxTime < minTime) {
      throw new Error("defaultMineSpeedInterval.maxTime must be >= minTime");
    }

    return minTime + Math.random() * (maxTime - minTime);
  }

  private startMining() {
    if (!this.running) return;
    const timeToMine = this.mineSpeedBaseMs() / this.miningPower;
    this.timer = setTimeout(async () => {
      try {
        await this.produce();
      } catch (e) {
        console.error("Producer error:", e);
      } finally {
        this.startMining();
      }
    }, Math.max(0, timeToMine)); // at least 1 ms
  }

  private resetMiningTimer() {
    if (!this.running) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.startMining();
  }

  //integrate a new block accordign to the longest chain rule
  //can trigger a reorg if the new block extends a different chain that is now longer than the current canonical chain
  async addBlock(block: Block): Promise<void> {
    //1. save the block
    this.allBlocks.set(block.hash, block);

    //2. try building the chain from this block backwards to genesis
    const path = this.buildChainPath(block.hash);
    if (!path) {
      console.warn(`Node ${this.proposer} received block #${block.header.number} but cannot build chain to genesis (missing parent along the way)`);
      return; // orphan block (I think)
    }

    //3. check if the new chain is longer than the current canonical chain
    const candidateChainLength = path.length;
    const currentChainLength = this.chain.length;

    //ignore shorter chains
    if (candidateChainLength < currentChainLength) {
      return;
    }

    //deterministic tiebreaker for chains of equal length: compare head hashes
    if (candidateChainLength === currentChainLength) {
      const currentHead = this.chain.at(-1);
      // if we somehow have no current head, treat candidate as better
      if (currentHead) {
        const currentHash = currentHead.hash;
        const candidateHash = block.hash;
        // tie-breaker: keep chain whose head has the smaller hash
        if (candidateHash >= currentHash) {
          return;
        }
      }
    }


    //4. Candidate chain is longer, try recomputing the new state and canonical chain
    if (this.beforeBlockAdd) this.beforeBlockAdd(block);
    const { ws: newWs, chain: newChain } = await this.rebuildChainFromPath(path);

    //5. if rebuild successful, switch to the new chain and state
    this.ws = newWs;
    this.chain = newChain;
    this.bestHeadHash = newChain.at(-1)!.hash;

    for (const b of newChain) {
      this.pruneMempoolForBlock(b);
    }
    if (block.header.proposer !== this.proposer) {
      this.resetMiningTimer();
    }
    if (this.afterBlockAdd) this.afterBlockAdd(block);
  }


  private async produce() {
    if (this.executionMode === "list") return this.produceList();
    if (this.executionMode === "graph") return this.produceGraph();
    throw new Error(`Unknown execution mode: ${this.executionMode}`);
  }

  private async produceList() {
    const parent = this.chain.at(-1) ?? null;
    const included: SignedTransaction[] = [];
    let failedInBlock = 0;
    const blockNumber = parent ? parent.header.number + 1 : 0;

    const wsClone = this.ws.clone();

    while (included.length < this.maxTxsPerBlock && this.mempool.length > 0) {
      const tx = this.mempool.shift()!;
      try {
        await applyTx(wsClone, tx, { blockNumber: blockNumber });
      } catch (e) {
        failedInBlock++;
        const message = e instanceof Error ? e.message : String(e);
        console.warn(formatError(`Tx failed in block production: id=${txId(tx)} reason=${message}`, 'transaction'));
        this.failedTransactions.set(txId(tx), tx);
      }

      // Failed transactions still belong in the block: they consume nonce and
      // must be replayed when reconstructing state so later transactions stay aligned.
      included.push(tx);
    }

    if (this.beforeBlockBuild) this.beforeBlockBuild(blockNumber);
    // could produce an empty block
    const block = await buildBlock(parent, this.proposer, included, this.ws, this.executionMode, this.maxTxsPerBlock);
    if (this.afterBlockBuild) this.afterBlockBuild(block);
    await this.addBlock(block);

    //notify listenrs that a new block is produced
    if (this.onBlockProduced) this.onBlockProduced(block);

    console.log(`\n\x1b[32m Node ${this.proposer} produced block #${block.header.number} (included=${included.length}, failed=${failedInBlock}, mempool=${this.mempool.length})`);
  }

  private async produceGraph() {
    const parent = this.chain.at(-1) ?? null;
    const included: SignedTransaction[] = [];
    let failedInBlock = 0;
    const blockNumber = (parent ? parent.header.number + 1 : 0);

    const candidates: SignedTransaction[] = this.mempool.splice(0, this.maxTxsPerBlock);
    const graph = buildTxGraphFromTxs(candidates, this.ws);
    const topoOrder = topoSortTxGraph(graph);
    const wsClone = this.ws.clone();

    for (const txId of topoOrder) {
      const node = graph.txs[txId]!;
      // if (node.redundant) continue;
      const tx = node.tx;
      try {
        await applyTx(wsClone, tx, { blockNumber });
      } catch (e) {
        failedInBlock++;
        const message = e instanceof Error ? e.message : String(e);
        console.warn(formatError(`Tx failed in block production: id=${txId} reason=${message}`, 'transaction'));
        this.failedTransactions.set(txId, tx);
      }

      // Failed transactions still belong in the block so their nonce consumption
      // is preserved when the block is replayed.
      included.push(tx);
    }

    if (this.beforeBlockBuild) this.beforeBlockBuild(blockNumber);
    // could produce an empty block
    const block = await buildBlock(parent, this.proposer, included, this.ws, this.executionMode, this.maxTxsPerBlock);
    if (this.afterBlockBuild) this.afterBlockBuild(block);
    await this.addBlock(block);

    //notify listenrs that a new block is produced
    if (this.onBlockProduced) this.onBlockProduced(block);

    console.log(`\n\x1b[32m Node ${this.proposer} produced block #${block.header.number} (included=${included.length}, failed=${failedInBlock}, mempool=${this.mempool.length})`);
  }



  // --- longest chain rule and reorg helpers ---

  // build ancestor path from headHash back to genesis
  //  head ... -> ... -> genesis
  // returns null if any block in the chain is missing
  // otherwise returns the array of blocks from oldest (genesis) to newest (headHash)
  private buildChainPath(headHash: Hash): Block[] | null {
    const path: Block[] = [];
    let currentHash: Hash | null = headHash;

    while (currentHash) {
      const block = this.allBlocks.get(currentHash);
      if (!block) {
        return null; // missing block in the chain
      }
      path.push(block);

      const parentHash = block.header.parentHash;
      if (!parentHash || parentHash === GENESIS_PARENT_HASH) {
        break; // reached genesis
      }

      currentHash = parentHash;
    }

    return path.reverse(); // from genesis to head
  }

  // rebuild the world state and chain from the given path of blocks
  // by re-applying all blocks from genesis to the tip
  private async rebuildChainFromPath(path: Block[]): Promise<{
    ws: WorldState;
    chain: Block[];
  }> {
    const ws = new WorldState();

    const chain: Block[] = [];
    let parent: Block | null = null;

    for (let index = 0; index < path.length; index++) {
      const block = path[index]!;
      if (index === path.length - 1 && this.beforeBlockAppend) this.beforeBlockAppend(block);
      await appendBlock(chain, ws, block, this.executionMode, this.maxTxsPerBlock);
      if (index === path.length - 1 && this.afterBlockAppend) this.afterBlockAppend(block);
      parent = block;
    }

    return { ws, chain };
  }

}
