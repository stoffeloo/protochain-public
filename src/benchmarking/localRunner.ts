import { Node } from "../core/node";
import { txId } from "../core/transaction";
import { Block } from "../core/types";
import { latencyStatsFromLatenciesMs } from "./stats";
import { BenchmarkRunConfig, BenchmarkRunResult, BenchmarkWorkload, ExecutionMode, type BlockAddTiming, type BlockAppendTiming, type BlockBuildTiming } from "./types";


type RunInternalState = {
    submittedAtById: Map<string, number>;
    includedAtById: Map<string, number>;
    blocksProduced: number;
    blockBuildStartedAtByNumber: Map<number, number>;
    blockBuildTimes: BlockBuildTiming[];
    blockAppendStartedAtByNumber: Map<number, number>;
    blockAppendTimes: BlockAppendTiming[];
    blockAddStartedAtByNumber: Map<number, number>;
    blockAddTimes: BlockAddTiming[];
}

function includedTxIdsFromBlock(block: Block): string[] {
    return Object.values(block.txGraph.txs).map(txNode => txNode.tx).map(tx => txId(tx));
}

export async function runLocalBenchmark(
    workload: BenchmarkWorkload,
    config: BenchmarkRunConfig,
): Promise<BenchmarkRunResult> {
    const mode: ExecutionMode = config.node.executionMode;
    const miningPower = config.node.miningPower;
    const miningSpeed = config.node.miningSpeed ?? { defaultMineSpeed: 0 };
    const maxBlocks = config.node.maxBlocks ?? Infinity;
    const maxTxsPerBlock = config.node.maxTxsPerBlock ?? 100;

    const node = new Node("0xbenchmarkNode", miningPower, miningSpeed, mode, workload.genesis, maxTxsPerBlock);

    const state: RunInternalState = {
        submittedAtById: new Map(),
        includedAtById: new Map(),
        blocksProduced: 0,
        blockBuildStartedAtByNumber: new Map(),
        blockBuildTimes: [],
        blockAppendStartedAtByNumber: new Map(),
        blockAppendTimes: [],
        blockAddStartedAtByNumber: new Map(),
        blockAddTimes: [],
    };

    const workloadTxIdSet = new Set<string>(workload.txs.map(tx => txId(tx)));

    const totalSubmittedTarget = workload.txs.length;
    const targetIncluded = config.targetIncludedTxs ?? totalSubmittedTarget

    const startedAt = Date.now();

    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => {
        resolveDone = resolve;
    });

    node.onBlockProduced = (block: Block) => {
        state.blocksProduced++;

        const now = Date.now();
        for (const id of includedTxIdsFromBlock(block)) {
            if (!workloadTxIdSet.has(id)) continue;

            // Count inclusion even if submission timestamp registration lags behind.
            if (!state.includedAtById.has(id)) {
                state.includedAtById.set(id, now);
            }
        }

        const accountedFor = state.includedAtById.size + node.failedTransactions.size;
        if (state.includedAtById.size >= targetIncluded || accountedFor >= totalSubmittedTarget || state.blocksProduced >= maxBlocks) {
            resolveDone();
            return;
        }
    };

    node.beforeBlockBuild = (blockNumber: number) => {
        state.blockBuildStartedAtByNumber.set(blockNumber, Date.now());
    };

    node.afterBlockBuild = (block: Block) => {
        const startedAt = state.blockBuildStartedAtByNumber.get(block.header.number);
        if (startedAt !== undefined) {
            state.blockBuildTimes.push({
                block,
                buildTimeMs: Date.now() - startedAt,
            });
            state.blockBuildStartedAtByNumber.delete(block.header.number);
        }
    };

    node.beforeBlockAppend = (block: Block) => {
        state.blockAppendStartedAtByNumber.set(block.header.number, Date.now());
    };

    node.afterBlockAppend = (block: Block) => {
        const startedAt = state.blockAppendStartedAtByNumber.get(block.header.number);
        if (startedAt !== undefined) {
            state.blockAppendTimes.push({
                block,
                appendTimeMs: Date.now() - startedAt,
            });
            state.blockAppendStartedAtByNumber.delete(block.header.number);
        }
    };

    node.beforeBlockAdd = (block: Block) => {
        state.blockAddStartedAtByNumber.set(block.header.number, Date.now());
    };

    node.afterBlockAdd = (block: Block) => {
        const startedAt = state.blockAddStartedAtByNumber.get(block.header.number);
        if (startedAt !== undefined) {
            state.blockAddTimes.push({
                block,
                addTimeMs: Date.now() - startedAt,
            });
            state.blockAddStartedAtByNumber.delete(block.header.number);
        }
    };

    // Pre-register submission timestamps.
    const submittedAt = Date.now();
    for (const tx of workload.txs) {
        state.submittedAtById.set(txId(tx), submittedAt);
    }

    // Submit all transactions before mining starts.
    const submitResults = await node.batchSubmit(workload.txs);
    let acceptedCount = 0;
    let duplicateCount = 0;
    for (const [id, status] of submitResults.entries()) {
        if (status === 'accepted') {
            acceptedCount++;
        } else {
            duplicateCount++;
            // For simplicity we let the benchmark crash if a transaction is rejected, might have to change this later
            throw new Error(`Transaction ${id} was rejected by the node with status: ${status}`);
        }
    }
    console.log(`Submitted ${submitResults.size} transactions (accepted=${acceptedCount}, duplicates=${duplicateCount}).`);

    await node.start();
    console.log(`Node started with execution mode ${mode} and mining power ${miningPower}.`);

    await done;
    node.stop();
    console.log('node stopped, calculating results...');

    const finishedAt = Date.now();

    const includedIds = [...state.includedAtById.keys()];
    const latenciesMs: number[] = [];
    for (const id of includedIds) {
        const submittedAt = state.submittedAtById.get(id);
        const includedAt = state.includedAtById.get(id);
        if (submittedAt !== undefined && includedAt !== undefined) {
            latenciesMs.push(includedAt - submittedAt);
        }
    }

    const totalIncluded = state.includedAtById.size;
    const durationMs = Math.max(finishedAt - startedAt, 1);
    const throughputTps = totalIncluded / (durationMs / 1000);
    
    const totalFailed = node.failedTransactions.size;

    // Capture final contract state if this was a smart contract workload
    let finalContractState: any = undefined;
    if ('contractAddress' in workload) {
        const scWorkload = workload as any; // SmartContractWorkload
        const contractAccount = node.ws.read(scWorkload.contractAddress);
        if (contractAccount.state) {
            finalContractState = contractAccount.state;
        }
    }

    return {
        mode,
        config,
        transactionList: workload.txs,
        blockBuildTimes: state.blockBuildTimes,
        blockAppendTimes: state.blockAppendTimes,
        blockAddTimes: state.blockAddTimes,
        totalSubmitted: totalSubmittedTarget,
        totalIncluded,
        totalFailed,
        startedAt,
        finishedAt,
        latency: latenciesMs.length ? latencyStatsFromLatenciesMs(latenciesMs) : null,
        throughputTps,
        finalContractState,
    }
}