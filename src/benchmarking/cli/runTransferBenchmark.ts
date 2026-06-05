import * as path from "node:path";

import { generateTransferWorkload } from "../transferWorkload";
import { runBenchmarkSeries } from "../seriesRunner";
import { runModeComparison } from "../compareModes";
import { writeBenchmarkArtifacts, writeComparisonArtifacts } from "../resultWriter";
import { asFloat, asInt, asString, ensureDir, parseArgs } from "./cliUtils";
import type { ExecutionMode } from "../../core/types";
import type { BenchmarkRunConfig, RecipientPattern, TransferWorkloadConfig } from "../types";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Parse required arguments
  if (!args["accounts"]) throw new Error("--accounts is required");
  if (!args["txsPerAccount"]) throw new Error("--txsPerAccount is required");
  if (!args["value"]) throw new Error("--value is required");
  if (!args["recipientPattern"]) throw new Error("--recipientPattern is required");
  if (!args["miningPower"]) throw new Error("--miningPower is required");
  if (!args["maxBlocks"]) throw new Error("--maxBlocks is required");

  const accounts = asInt(args["accounts"]);
  const txsPerAccount = asInt(args["txsPerAccount"]);
  const txValue = asFloat(args["value"]);
  const recipientPattern = asString<RecipientPattern>(args["recipientPattern"]);
  const miningPower = asInt(args["miningPower"]);
  const maxBlocks = asInt(args["maxBlocks"]);
  const maxTxsPerBlock = typeof args["maxTxsPerBlock"] === "string" ? asInt(args["maxTxsPerBlock"]) : undefined;

  const mode = typeof args["mode"] === "string" ? (args["mode"] as ExecutionMode) : "graph";
  const compare = Boolean(args["compare"]);
  const warmupRuns = typeof args["warmupRuns"] === "string" ? asInt(args["warmupRuns"]) : 5;
  const measuredRuns = typeof args["measuredRuns"] === "string" ? asInt(args["measuredRuns"]) : 100;
  const targetIncludedTxs =
    typeof args["targetIncludedTxs"] === "string" ? asInt(args["targetIncludedTxs"]) : undefined;
  const outDir = typeof args["outDir"] === "string" ? asString(args["outDir"]) : path.join(process.cwd(), "bench-results");

  ensureDir(outDir);

  const workloadCfg: TransferWorkloadConfig = {
    accounts,
    txsPerAccount,
    txValue,
    recipientPattern,
  };

  const workload = generateTransferWorkload(workloadCfg);

  if (compare) {
    const config = {
      workloadConfig: workloadCfg,
      node: { miningPower, maxBlocks, ...(maxTxsPerBlock !== undefined ? { maxTxsPerBlock } : {}) },
      ...(targetIncludedTxs !== undefined ? { targetIncludedTxs } : {}),
    } satisfies Omit<BenchmarkRunConfig, "node"> & {
      node: Omit<BenchmarkRunConfig["node"], "executionMode">;
    };

    const comparison = await runModeComparison(workload, config, ["list", "graph"], warmupRuns, measuredRuns);
    const runDirs = comparison.modes.map(r => writeBenchmarkArtifacts(outDir, "run", r));
    const comparisonPath = writeComparisonArtifacts(outDir, "comparison", comparison, runDirs);

    console.log(`Wrote comparison results to ${comparisonPath}`);
    return;
  }

  const runCfg: BenchmarkRunConfig = {
    workloadConfig: workloadCfg,
    node: { executionMode: mode, miningPower, maxBlocks, ...(maxTxsPerBlock !== undefined ? { maxTxsPerBlock } : {}) },
    ...(targetIncludedTxs !== undefined ? { targetIncludedTxs } : {}),
  };

  const result = await runBenchmarkSeries(workload, runCfg, warmupRuns, measuredRuns);

  const resultPath = writeBenchmarkArtifacts(outDir, "run", result);
  console.log(`Wrote run result to ${resultPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

