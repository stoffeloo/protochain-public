//ai generated file for writing benchmark results
import * as fs from "node:fs";
import * as path from "node:path";

import type { BenchmarkSeriesResult, ModeComparisonResult } from "./types";

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function writeBenchmarkArtifacts(baseDir: string, prefix: string, result: BenchmarkSeriesResult): string {
  const runDir = path.join(baseDir, `${prefix}_${result.mode}_${Date.now()}`);
  ensureDir(runDir);

  writeJson(path.join(runDir, "meta.json"), {
    mode: result.mode,
    config: result.config,
    warmupRuns: result.warmupRuns,
    measuredRuns: result.measuredRuns,
  });

  writeJson(path.join(runDir, "transactions.json"), result.transactionList);
  writeJson(path.join(runDir, "blocks.json"), result.blocks);
  writeJson(path.join(runDir, "totals.json"), {
    totalSubmitted: result.totalSubmitted,
    totalIncluded: result.totalIncluded,
    totalFailed: result.totalFailed,
  });
  writeJson(path.join(runDir, "block-build-times.json"), result.blockBuildTimes);
  writeJson(path.join(runDir, "block-append-times.json"), result.blockAppendTimes);
  writeJson(path.join(runDir, "block-add-times.json"), result.blockAddTimes);

  if (result.finalContractState !== undefined) {
    writeJson(path.join(runDir, "contract-state.json"), result.finalContractState);
  }

  return runDir;
}

export function writeComparisonArtifacts(baseDir: string, prefix: string, comparison: ModeComparisonResult, runDirs: string[]): string {
  const comparisonDir = path.join(baseDir, `${prefix}_${Date.now()}`);
  ensureDir(comparisonDir);

  const modeSummaries = comparison.modes.map((result, index) => ({
    mode: result.mode,
    runDir: runDirs[index],
  }));

  const referenceState = JSON.stringify(comparison.modes[0]?.finalContractState ?? null);
  const sameFinalState = comparison.modes.every(result => JSON.stringify(result.finalContractState ?? null) === referenceState);

  writeJson(path.join(comparisonDir, "comparison.json"), {
    sameFinalState,
    modes: modeSummaries,
  });

  return comparisonDir;
}