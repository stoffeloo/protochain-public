import { ExecutionMode } from "../core/types";
import { runBenchmarkSeries } from "./seriesRunner";
import { BenchmarkRunConfig, BenchmarkSeriesResult, BenchmarkWorkload, ModeComparisonResult } from "./types";

export async function runModeComparison(
    workload: BenchmarkWorkload,
    baseConfig: Omit<BenchmarkRunConfig, "node"> & {
        node: Omit<BenchmarkRunConfig["node"], "executionMode">;
    },
    modes: ExecutionMode[] = ["list", "graph"],
    warmupRuns = 5,
    measuredRuns = 100,
): Promise<ModeComparisonResult> {
    const results: BenchmarkSeriesResult[] = [];

    for (const mode of modes) {
        const cfg: BenchmarkRunConfig = {
            ...baseConfig,
            node: {
                ...baseConfig.node,
                executionMode: mode,
            },
        };
        results.push(await runBenchmarkSeries(workload, cfg, warmupRuns, measuredRuns));
    }

    return  {modes: results};
}