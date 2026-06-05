import * as path from "node:path";

import { generateSmartContractWorkload } from "../smartContractWorkload";
import { runBenchmarkSeries } from "../seriesRunner";
import { runModeComparison } from "../compareModes";
import { writeBenchmarkArtifacts, writeComparisonArtifacts } from "../resultWriter";
import { loadContractArtifact, loadNamedExport, parseMethods } from "./smartContractUtils";
import { asInt, asString, ensureDir, parseArgs } from "./cliUtils";
import type { ExecutionMode } from "../../core/types";
import type { BenchmarkRunConfig, SmartContractParameterGenerator, SmartContractWorkloadConfig } from "../types";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Parse required arguments
  if (!args["contract"]) throw new Error("--contract is required (path to smart contract module)");
  if (!args["accounts"]) throw new Error("--accounts is required");
  if (!args["fundsPerAccount"]) throw new Error("--fundsPerAccount is required");
  if (!args["miningPower"]) throw new Error("--miningPower is required");
  if (!args["maxBlocks"]) throw new Error("--maxBlocks is required");

  const contractPath = asString(args["contract"]);
  const accounts = asInt(args["accounts"]);
  const fundsPerAccount = asInt(args["fundsPerAccount"]);
  const miningPower = asInt(args["miningPower"]);
  const maxBlocks = asInt(args["maxBlocks"]);
  const maxTxsPerBlock = typeof args["maxTxsPerBlock"] === "string" ? asInt(args["maxTxsPerBlock"]) : undefined;

  const mode = typeof args["mode"] === "string" ? (args["mode"] as ExecutionMode) : "graph";
  const compare = Boolean(args["compare"]);
  const warmupRuns = typeof args["warmupRuns"] === "string" ? asInt(args["warmupRuns"]) : 5;
  const measuredRuns = typeof args["measuredRuns"] === "string" ? asInt(args["measuredRuns"]) : 100;

  const artifact = await loadContractArtifact(contractPath);
  const parameterGeneratorExport = typeof args["parameterGeneratorExport"] === "string"
    ? asString(args["parameterGeneratorExport"])
    : undefined;
  const parameterGenerator = parameterGeneratorExport
    ? await loadNamedExport<SmartContractParameterGenerator>(contractPath, parameterGeneratorExport)
    : undefined;
  const methods = parseMethods(args["methods"]);
  const targetIncludedTxs =
    typeof args["targetIncludedTxs"] === "string" ? asInt(args["targetIncludedTxs"]) : undefined;

  const outDir = typeof args["outDir"] === "string" ? asString(args["outDir"]) : path.join(process.cwd(), "bench-results");
  ensureDir(outDir);

  const workloadCfg: SmartContractWorkloadConfig = {
    accounts,
    smartContract: artifact.module,
    smartContractMetadata: artifact.metadata,
    methods,
    fundsPerAccount,
    ...(maxTxsPerBlock !== undefined ? { maxTxsPerBlock } : {}),
    ...(parameterGenerator ? { parameterGenerator } : {}),
  };

  const workload = generateSmartContractWorkload(workloadCfg);

  if (compare) {
    const config = {
      workloadConfig: workloadCfg,
      node: { miningPower, maxBlocks, ...(maxTxsPerBlock !== undefined ? { maxTxsPerBlock } : {}) },
      ...(targetIncludedTxs !== undefined ? { targetIncludedTxs } : {}),
    } satisfies Omit<BenchmarkRunConfig, "node"> & {
      node: Omit<BenchmarkRunConfig["node"], "executionMode">;
    };

    const comparison = await runModeComparison(workload, config, ["list", "graph"], warmupRuns, measuredRuns);
    const runDirs = comparison.modes.map(r => writeBenchmarkArtifacts(outDir, "smartcontract_run", r));
    const comparisonPath = writeComparisonArtifacts(outDir, "smartcontract_comparison", comparison, runDirs);

    console.log(`Wrote smart contract comparison results to ${comparisonPath}`);
    return;
  }

  const runCfg: BenchmarkRunConfig = {
    workloadConfig: workloadCfg,
    node: { executionMode: mode, miningPower, maxBlocks, ...(maxTxsPerBlock !== undefined ? { maxTxsPerBlock } : {}) },
    ...(targetIncludedTxs !== undefined ? { targetIncludedTxs } : {}),
  };

  const result = await runBenchmarkSeries(workload, runCfg, warmupRuns, measuredRuns);

  const resultPath = writeBenchmarkArtifacts(outDir, "smartcontract_run", result);
  console.log(`Wrote smart contract run result to ${resultPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});