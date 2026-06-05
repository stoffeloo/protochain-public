import type { ExecutionMode as CoreExecutionMode, GenesisConfig, SignedTransaction, Address, ContractModule, ContractState, Block, ContractMetadata, MiningSpeedConfig } from "../core/types";

export type ExecutionMode = CoreExecutionMode;

export type RecipientPattern = "roundRobin" | "random" | "singleSink";

export interface WorkloadConfig {
    accounts: number;
}

export interface TransferWorkloadConfig extends WorkloadConfig {
    txsPerAccount: number;
    txValue: number;
    recipientPattern: RecipientPattern;
}

//todo: later on we need to not use these fixed params but let them be autogenreated but there is relation needed between them to have the calls make sense, for example for bidding
export interface SmartContractMethodConfig {
    /** Name of the method to call */
    method: string;
    /** Number of normal transactions to generate for this method */
    normalCount: number;
    /** Number of transactions that should intentionally fail for this method */
    forceFailedCount: number;
    /** Parameters to pass to this method call */
    params?: any[];
    /** Money to send with the call */
    value?: number;
}

export type ParameterGeneratorState = Record<string, unknown>;

export interface GeneratedMethodCall {
    params: any[] | null;
    transferValue?: number;
}

export const RetryLaterWhen = Symbol("RetryLaterWhen");

export interface SmartContractParameterGenerator<TState extends ParameterGeneratorState = ParameterGeneratorState> {
    state: TState;
    suggestPossibleAccounts?(methodName: string, accounts: Address[], kind: "normal" | "failed", transactionIndex: number, maxTxsPerBlock: number): Address[] | typeof RetryLaterWhen;
    generateParameter(methodName: string, caller: Address, accounts: Address[], transactionIndex: number, remainingTransactions: number, maxTxsPerBlock: number): GeneratedMethodCall | typeof RetryLaterWhen;
    generateFailedParameters(methodName: string, caller: Address, accounts: Address[], transactionIndex: number, maxTxsPerBlock: number): GeneratedMethodCall;
}

export interface SmartContractWorkloadConfig extends WorkloadConfig {
    /** The smart contract module to deploy */
    smartContract: ContractModule<any>;
    /** Metadata passed alongside deployed contract code */
    smartContractMetadata: ContractMetadata;
    /** Configuration for each method to benchmark */
    methods: SmartContractMethodConfig[];
    /** Amount of funds to allocate to each account in genesis */
    fundsPerAccount: number;
    /** Maximum number of transactions per block used for block estimation in parameter generation */
    maxTxsPerBlock?: number;
    /** Optional generator for method call parameters */
    parameterGenerator?: SmartContractParameterGenerator;
}

export interface BenchmarkNodeConfig {
    executionMode: ExecutionMode;
    miningPower: number;
    miningSpeed?: MiningSpeedConfig;
    maxTxsPerBlock?: number;
    /**
     * Maximum number of lbock to let the node produce
     * before we stop the run even if not all txs were included
     */
    maxBlocks?: number;
}

export interface BenchmarkWorkload {
    genesis: GenesisConfig;
    txs: SignedTransaction[];
}

export interface SmartContractWorkload extends BenchmarkWorkload {
    /** Address where the smart contract will be deployed */
    contractAddress: Address;
    /** Methods that were called in this workload */
    methods: SmartContractMethodConfig[];
}

export interface TxTiming {
    txId: string;
    submittedAt: number; // timestamp in milliseconds
    includedAt?: number; // timestamp in milliseconds
}

export interface LatencyStats {
    count: number;
    minMs: number;
    maxMs: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
}

export interface BenchmarkRunConfig {
    workloadConfig: WorkloadConfig;
    node: BenchmarkNodeConfig;
    /**
     * Target number of included transactions before stopping,
     * if not set, we try to inlcude the full workload
     */
    targetIncludedTxs?: number;
}

export interface BenchmarkRunResult {
    mode: ExecutionMode;
    config: BenchmarkRunConfig;
    transactionList: SignedTransaction[];
    blockBuildTimes: BlockBuildTiming[];
    blockAppendTimes: BlockAppendTiming[];
    blockAddTimes: BlockAddTiming[];
    totalSubmitted: number;
    totalIncluded: number;
    totalFailed: number;
    startedAt: number; // timestamp in milliseconds
    finishedAt: number; // timestamp in milliseconds
    latency: LatencyStats | null;
    throughputTps: number;
    /** Final state of the deployed smart contract (if benchmark was for a smart contract) */
    finalContractState?: ContractState;
}

export interface BenchmarkSeriesResult {
    mode: ExecutionMode;
    config: BenchmarkRunConfig;
    warmupRuns: number;
    measuredRuns: number;
    transactionList: SignedTransaction[];
    blocks: Block[];
    blockBuildTimes: BlockBuildTiming[];
    blockAppendTimes: BlockAppendTiming[];
    blockAddTimes: BlockAddTiming[];
    totalSubmitted: number;
    totalIncluded: number;
    totalFailed: number;
    finalContractState?: ContractState;
}

export interface ModeComparisonResult {
    modes: BenchmarkSeriesResult[];
}

export interface BlockBuildTiming {
    block: Block;
    buildTimeMs: number;
}

export interface BlockAppendTiming {
    block: Block;
    appendTimeMs: number;
}

export interface BlockAddTiming {
    block: Block;
    addTimeMs: number;
}