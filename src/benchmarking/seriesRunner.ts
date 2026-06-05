import { runLocalBenchmark } from "./localRunner";
import {
  BenchmarkRunConfig,
  BenchmarkRunResult,
  BenchmarkSeriesResult,
  BenchmarkWorkload,
  BlockAddTiming,
  BlockAppendTiming,
  BlockBuildTiming,
} from "./types";
import type { Block } from "../core/types";

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function stringifyForError(value: unknown, maxChars = 8000): string {
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) return String(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... <truncated ${text.length - maxChars} chars>`;
}

function requireInvariant<T>(name: string, baseline: T, current: T, runIndex: number): void {
  if (!jsonEqual(baseline, current)) {
    throw new Error(
      [
        `Invariant mismatch for ${name} in measured run #${runIndex + 1}`,
        `Baseline: ${stringifyForError(baseline)}`,
        `Current : ${stringifyForError(current)}`,
      ].join("\n"),
    );
  }
}

function canonicalBlockForInvariant(block: Block): {
  number: number;
  stateRoot: string;
  transactionRoot: string;
  txIds: string[];
  edges: { from: string; to: string }[];
} {
  const txIds = Object.keys(block.txGraph.txs).sort();
  const edges = [...block.txGraph.edges]
    .map(e => ({ from: e.from, to: e.to }))
    .sort((a, b) => {
      if (a.from === b.from) return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
      return a.from < b.from ? -1 : 1;
    });

  return {
    number: block.header.number,
    stateRoot: block.header.stateRoot,
    transactionRoot: block.header.transactionRoot,
    txIds,
    edges,
  };
}

function canonicalBlocksForInvariant(blocks: Block[]): ReturnType<typeof canonicalBlockForInvariant>[] {
  return [...blocks]
    .sort((a, b) => a.header.number - b.header.number)
    .map(canonicalBlockForInvariant);
}

function averageByBlock<T extends { block: Block }>(
  timingRuns: T[][],
  extractMs: (t: T) => number,
  makeTiming: (block: Block, avgMs: number) => T,
): T[] {
  if (timingRuns.length === 0) return [];

  const baseline = timingRuns[0]!;
  const baselineByNumber = new Map<number, T>();
  for (const t of baseline) {
    baselineByNumber.set(t.block.header.number, t);
  }

  for (let i = 1; i < timingRuns.length; i++) {
    const run = timingRuns[i]!;
    if (run.length !== baseline.length) {
      throw new Error(
        [
          `Timing length mismatch in measured run #${i + 1}: expected ${baseline.length}, got ${run.length}`,
          `Baseline blocks: ${stringifyForError(baseline.map(t => t.block.header.number))}`,
          `Current blocks : ${stringifyForError(run.map(t => t.block.header.number))}`,
        ].join("\n"),
      );
    }

    const runNumbers = new Set(run.map(t => t.block.header.number));
    for (const n of baselineByNumber.keys()) {
      if (!runNumbers.has(n)) {
        throw new Error(
          [
            `Timing block-number mismatch in measured run #${i + 1}: missing block ${n}`,
            `Baseline blocks: ${stringifyForError(baseline.map(t => t.block.header.number))}`,
            `Current blocks : ${stringifyForError(run.map(t => t.block.header.number))}`,
          ].join("\n"),
        );
      }
    }
  }

  const averaged: T[] = [];
  const sortedBaseline = [...baseline].sort((a, b) => a.block.header.number - b.block.header.number);
  for (const baselineTiming of sortedBaseline) {
    const blockNumber = baselineTiming.block.header.number;
    const values: number[] = [];

    for (const run of timingRuns) {
      const timing = run.find(t => t.block.header.number === blockNumber);
      if (!timing) {
        throw new Error(`Missing timing for block ${blockNumber} while averaging`);
      }
      values.push(extractMs(timing));
    }

    const avgMs = values.reduce((acc, v) => acc + v, 0) / values.length;
    averaged.push(makeTiming(baselineTiming.block, avgMs));
  }

  return averaged;
}

export async function runBenchmarkSeries(
  workload: BenchmarkWorkload,
  config: BenchmarkRunConfig,
  warmupRuns = 5,
  measuredRuns = 100,
): Promise<BenchmarkSeriesResult> {
  for (let i = 0; i < warmupRuns; i++) {
    console.log(`Warmup run #${i + 1}/${warmupRuns}... for mode ${config.node.executionMode}`);
    await runLocalBenchmark(workload, config);
  }

  const measured: BenchmarkRunResult[] = [];
  for (let i = 0; i < measuredRuns; i++) {
    console.log(`Measured run #${i + 1}/${measuredRuns}... for mode ${config.node.executionMode}`);
    measured.push(await runLocalBenchmark(workload, config));
  }

  if (measured.length === 0) {
    throw new Error("No measured runs executed.");
  }

  const baseline = measured[0]!;

  for (let i = 1; i < measured.length; i++) {
    const run = measured[i]!;
    requireInvariant("transactionList", baseline.transactionList, run.transactionList, i);
    requireInvariant("totalSubmitted", baseline.totalSubmitted, run.totalSubmitted, i);
    requireInvariant("totalIncluded", baseline.totalIncluded, run.totalIncluded, i);
    requireInvariant("totalFailed", baseline.totalFailed, run.totalFailed, i);
    requireInvariant("finalContractState", baseline.finalContractState ?? null, run.finalContractState ?? null, i);
    requireInvariant(
      "blocks",
      canonicalBlocksForInvariant(baseline.blockAddTimes.map(t => t.block)),
      canonicalBlocksForInvariant(run.blockAddTimes.map(t => t.block)),
      i,
    );
  }

  const averagedBuild = averageByBlock<BlockBuildTiming>(
    measured.map(r => r.blockBuildTimes),
    t => t.buildTimeMs,
    (block, avgMs) => ({ block, buildTimeMs: avgMs }),
  );

  const averagedAppend = averageByBlock<BlockAppendTiming>(
    measured.map(r => r.blockAppendTimes),
    t => t.appendTimeMs,
    (block, avgMs) => ({ block, appendTimeMs: avgMs }),
  );

  const averagedAdd = averageByBlock<BlockAddTiming>(
    measured.map(r => r.blockAddTimes),
    t => t.addTimeMs,
    (block, avgMs) => ({ block, addTimeMs: avgMs }),
  );

  return {
    mode: baseline.mode,
    config,
    warmupRuns,
    measuredRuns,
    transactionList: baseline.transactionList,
    blocks: baseline.blockAddTimes.map(t => t.block),
    blockBuildTimes: averagedBuild,
    blockAppendTimes: averagedAppend,
    blockAddTimes: averagedAdd,
    totalSubmitted: baseline.totalSubmitted,
    totalIncluded: baseline.totalIncluded,
    totalFailed: baseline.totalFailed,
    ...(baseline.finalContractState !== undefined ? { finalContractState: baseline.finalContractState } : {}),
  };
}
