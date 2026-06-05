## Benchmarking / simulation framework

This folder contains the local benchmarking harness for Protochain.

It generates workloads, feeds signed transactions directly into a local core node, and records run metrics for execution-mode comparisons.

Current primary comparison is `list` vs `graph` execution.

## What it measures

- `meta.json`: `mode`, `config`
- `transactions.json`: generated transaction list
- `blocks.json`: canonical block list from measured runs
- `totals.json`: `totalSubmitted`, `totalIncluded`, `totalFailed`
- `block-build-times.json`: each block plus averaged build time (measured runs only)
- `block-append-times.json`: each block plus averaged append/apply time (measured runs only)
- `block-add-times.json`: each block plus averaged add-to-chain time (measured runs only)
- `contract-state.json`: final smart-contract state for smart-contract runs

The harness does not use HTTP polling to detect inclusion.

## Workload model

Core types are now generic:

- `BenchmarkWorkload`: generic `genesis` + `txs`.
- `TransferWorkloadConfig`: transfer-specific config.
- `SmartContractWorkloadConfig`: smart-contract-specific config.

### Transfer workload

Config:

- `accounts`
- `txsPerAccount`
- `txValue`
- `recipientPattern` (`roundRobin`, `random`, `singleSink`)

### Smart contract workload

Config:

- `accounts`
- `smartContract` (`ContractModule`)
- `smartContractMetadata` (`ContractMetadata`, deployed alongside code)
- `methods` (`SmartContractMethodConfig[]` with `normalCount` and `forceFailedCount`)
- `fundsPerAccount`
- `parameterGenerator?` (optional)

Smart contract files used by the benchmark must export both:

- a `ContractModule` (default or named export)
- a `ContractMetadata` object (exported as `contractMetadata` or `metadata`)

The deploy transaction now carries `data: { code, metadata }`.

Smart contract methods receive their execution context as the first two arguments:

- `_caller`
- `_value`

Any contract-specific parameters come after those three values. The metadata `methods` arrays should list these prefixed arguments first so graph rules can reason about them.


Graph metadata semantics:

- Dependencies are built from `nonCommutativeOperations`.
- Redundancy marking is based on `idempotentOperations` and `supersedeOperations`.
- `idempotentOperations` is treated as a special case of supersede for same-method, same-args calls.

Call generation behavior:

- Random deployer account is selected.
- Deploy transaction is created first.
- Method call generation is randomized using a method-count map.
- Each method can define `normalCount` and `forceFailedCount`.
- Caller account is randomly selected for each generated call.
- Nonce is tracked per account (not global).

Benchmark output behavior:

- Every run is written into its own directory under `bench-results/`.
- A benchmark run is executed as a series: warmup runs (ignored) + measured runs (averaged).
- Defaults are `--warmupRuns 5` and `--measuredRuns 100`.
- Invariant values (transactions, blocks, totals, contract state) are validated across measured runs and written once.
- Smart-contract runs write `transactions.json`, `blocks.json`, `totals.json`, averaged timing files, and `contract-state.json` (if applicable).
- Transfer runs write `transactions.json`, `blocks.json`, `totals.json`, and averaged timing files.
- Compare mode writes a `comparison.json` summary and separate per-mode run directories.

## Smart contract parameter generator

`SmartContractWorkloadConfig` supports an optional `parameterGenerator` with this shape:

```ts
{
  state: TState;
  suggestPossibleAccounts?(
    methodName: string,
    accounts: Address[],
    kind: "normal" | "failed",
    transactionIndex: number,
    maxTxsPerBlock: number
  ): Address[] | typeof RetryLaterWhen;
  generateParameter(
    methodName: string,
    caller: Address,
    accounts: Address[],
    transactionIndex: number,
    remainingTransactions: number,
    maxTxsPerBlock: number
  ): {
    params: any[] | null;
    transferValue?: number;
  } | typeof RetryLaterWhen;
  generateFailedParameters(
    methodName: string,
    caller: Address,
    accounts: Address[],
    transactionIndex: number,
    maxTxsPerBlock: number
  ): {
    params: any[] | null;
    transferValue?: number;
  };
}
```

If `method.params` is omitted and a generator is present, generated `params` and optional `transferValue` are used for that call.

`generateParameter(...)` is used for the `normalCount` part of a method, and `generateFailedParameters(...)` is used for the `forceFailedCount` part.

If `generateParameter(...)` returns `RetryLaterWhen`, the benchmark keeps the method counts unchanged and tries another transaction later.

If `suggestPossibleAccounts(...)` is provided, caller selection is done from that suggested subset instead of all accounts.

## CLI structure

Shared CLI helpers:

- `src/benchmarking/cli/cliUtils.ts`
- `src/benchmarking/cli/smartContractUtils.ts`

Both runners validate required arguments and throw on missing required flags.

## Example contracts for benchmarking

Folder:

- `src/benchmarking/SmartContracts/`

Included examples:

- `counter.ts`
- `combinedAuctionItemRegistry.ts`

## Running benchmarks

### Transfer benchmark (single mode)

```bash
npm run -s bench:transfer -- \
  --mode graph \
  --warmupRuns 5 \
  --measuredRuns 100 \
  --accounts 50 \
  --txsPerAccount 20 \
  --value 1 \
  --recipientPattern roundRobin \
  --miningPower 1 \
  --maxTxsPerBlock 100 \
  --maxBlocks 100 \
  --targetIncludedTxs 1000
```

### Transfer benchmark (compare modes)

```bash
npm run -s bench:transfer -- \
  --compare \
  --warmupRuns 5 \
  --measuredRuns 100 \
  --accounts 50 \
  --txsPerAccount 20 \
  --value 1 \
  --recipientPattern roundRobin \
  --miningPower 1 \
  --maxTxsPerBlock 100 \
  --maxBlocks 100 \
  --targetIncludedTxs 1000
```

### Smart contract benchmark (counter example)

```bash
npm run -s bench:smartcontract -- \
  --contract src/benchmarking/SmartContracts/counter.ts \
  --warmupRuns 5 \
  --measuredRuns 100 \
  --methods '[{"method":"incrementA","normalCount":3,"forceFailedCount":0},{"method":"incrementB","normalCount":2,"forceFailedCount":0},{"method":"setA","normalCount":1,"forceFailedCount":0,"params":[10]},{"method":"resetAll","normalCount":1,"forceFailedCount":0}]' \
  --accounts 4 \
  --fundsPerAccount 1000 \
  --miningPower 1 \
  --maxTxsPerBlock 25 \
  --maxBlocks 10 \
  --mode list
```

### Smart contract benchmark (combined auction + registry example)

```bash
npm run -s bench:smartcontract -- \
  --contract src/benchmarking/SmartContracts/combinedAuctionItemRegistry.ts \
  --parameterGeneratorExport CombinedAuctionItemRegistryParameterGenerator \
  --warmupRuns 5 \
  --measuredRuns 100 \
  --methods '[{"method":"createItem","normalCount":12,"forceFailedCount":0},{"method":"createAuction","normalCount":7,"forceFailedCount":0},{"method":"placeBid","normalCount":12,"forceFailedCount":0},{"method":"settleAuction","normalCount":6,"forceFailedCount":0}]' \
  --accounts 8 \
  --fundsPerAccount 10000 \
  --miningPower 1 \
  --maxTxsPerBlock 4 \
  --maxBlocks 120 \
  --mode list
```

## smart contract compare benchmark
npm run -s bench:smartcontract -- \
  --contract src/benchmarking/SmartContracts/combinedAuctionItemRegistry.ts \
  --parameterGeneratorExport CombinedAuctionItemRegistryParameterGenerator \
  --warmupRuns 5 \
  --measuredRuns 100 \
  --methods '[{"method":"createItem","normalCount":36,"forceFailedCount":0},{"method":"createAuction","normalCount":21,"forceFailedCount":0},{"method":"placeBid","normalCount":66,"forceFailedCount":0},{"method":"settleAuction","normalCount":18,"forceFailedCount":0}]' \
  --accounts 24 \
  --fundsPerAccount 10000 \
  --miningPower 1 \
  --maxTxsPerBlock 12 \
  --maxBlocks 120 \
  --compare

## Result files

By default, output is written to `bench-results/`. Each run gets its own directory.

- Transfer single run: `run_<mode>_<timestamp>/`
  - `meta.json`
  - `transactions.json`
  - `blocks.json`
  - `totals.json`
  - `block-build-times.json`
  - `block-append-times.json`
  - `block-add-times.json`
- Transfer compare run: `comparison_<timestamp>/comparison.json` plus per-mode run directories (`comparison.json` includes `sameFinalState`)
- Smart-contract single run: `smartcontract_run_<mode>_<timestamp>/`
  - `meta.json`
  - `transactions.json`
  - `blocks.json`
  - `totals.json`
  - `block-build-times.json`
  - `block-append-times.json`
  - `block-add-times.json`
  - `contract-state.json` (only for smart-contract runs)
- Smart-contract compare run: `smartcontract_comparison_<timestamp>/comparison.json` plus per-mode run directories (`comparison.json` includes `sameFinalState`)

## Benchmarks

### Benchmark #1: CurrencyOrderIntentBookSimple (graph vs list)

settings:

- `--compare` to run both list and graph mode
- `--accounts 32` to provide meaningful cross-account transactions
- `--maxTxsPerBlock 128` so each block is large enough for graph scheduling to matter.
- `--maxBlocks 80` as a safe cap for this workload.
- Method mix with many creates/modifies and fewer cancels to keep orders alive while still producing supersedes and idempotent updates.
- Sized to about 12 blocks total: 1535 call transactions plus the deploy transaction = 1536 txs, which fits exactly into 12 blocks at `--maxTxsPerBlock 128`.
- `forceFailedCount: 0` to isolate graph-vs-list improvments/deprevements based on supereding and indempontent transtions instead of also failing transaction

Quick smoke-check (single measured run, no warmups):

```bash
npm run -s bench:smartcontract -- \
  --compare \
  --contract src/benchmarking/SmartContracts/currencyOrderIntentBookSimple.ts \
  --parameterGeneratorExport CurrencyOrderIntentBookSimpleParameterGenerator \
  --warmupRuns 0 \
  --measuredRuns 1 \
  --methods '[{"method":"createOrReplaceBtcBuyOrder","normalCount":150,"forceFailedCount":0},
  {"method":"createOrReplaceBtcSellOrder","normalCount":150,"forceFailedCount":0},
  {"method":"createOrReplaceEthBuyOrder","normalCount":150,"forceFailedCount":0},
  {"method":"createOrReplaceEthSellOrder","normalCount":150,"forceFailedCount":0},
  {"method":"modifyMyBtcBuyOrderPrice","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyBtcSellOrderPrice","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyEthBuyOrderPrice","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyEthSellOrderPrice","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyBtcBuyOrderQuantity","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyBtcSellOrderQuantity","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyEthBuyOrderQuantity","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyEthSellOrderQuantity","normalCount":90,"forceFailedCount":0},
  {"method":"cancelMyBtcBuyOrder","normalCount":45,"forceFailedCount":0},
  {"method":"cancelMyBtcSellOrder","normalCount":45,"forceFailedCount":0},
  {"method":"cancelMyEthBuyOrder","normalCount":45,"forceFailedCount":0},
  {"method":"cancelMyEthSellOrder","normalCount":45,"forceFailedCount":0},
  {"method":"cancelAllMyOrders","normalCount":35,"forceFailedCount":0}]' \
  --accounts 32 \
  --fundsPerAccount 10000 \
  --miningPower 1 \
  --maxTxsPerBlock 128 \
  --maxBlocks 80
```

Full benchmark run (recommended):

```bash
npm run -s bench:smartcontract -- \
  --compare \
  --contract src/benchmarking/SmartContracts/currencyOrderIntentBookSimple.ts \
  --parameterGeneratorExport CurrencyOrderIntentBookSimpleParameterGenerator \
  --warmupRuns 5 \
  --measuredRuns 100 \
  --methods '[{"method":"createOrReplaceBtcBuyOrder","normalCount":150,"forceFailedCount":0},
  {"method":"createOrReplaceBtcSellOrder","normalCount":150,"forceFailedCount":0},
  {"method":"createOrReplaceEthBuyOrder","normalCount":150,"forceFailedCount":0},
  {"method":"createOrReplaceEthSellOrder","normalCount":150,"forceFailedCount":0},
  {"method":"modifyMyBtcBuyOrderPrice","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyBtcSellOrderPrice","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyEthBuyOrderPrice","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyEthSellOrderPrice","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyBtcBuyOrderQuantity","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyBtcSellOrderQuantity","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyEthBuyOrderQuantity","normalCount":90,"forceFailedCount":0},
  {"method":"modifyMyEthSellOrderQuantity","normalCount":90,"forceFailedCount":0},
  {"method":"cancelMyBtcBuyOrder","normalCount":45,"forceFailedCount":0},
  {"method":"cancelMyBtcSellOrder","normalCount":45,"forceFailedCount":0},
  {"method":"cancelMyEthBuyOrder","normalCount":45,"forceFailedCount":0},
  {"method":"cancelMyEthSellOrder","normalCount":45,"forceFailedCount":0},
  {"method":"cancelAllMyOrders","normalCount":35,"forceFailedCount":0}]' \
  --accounts 32 \
  --fundsPerAccount 10000 \
  --miningPower 1 \
  --maxTxsPerBlock 128 \
  --maxBlocks 80
```