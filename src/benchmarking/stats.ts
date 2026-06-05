//AI generated statistic functions for benchmarking results
import { LatencyStats } from "./types";

export function percentile(sortedAsc: number[], p: number): number {
    if (sortedAsc.length === 0) throw new Error("percentile of empty array");
    if (p < 0 || p > 100) throw new Error("percentile must be between 0 and 100");

    const pos = (p / 100) * (sortedAsc.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sortedAsc[lo]!;
    const w = pos - lo;
    return sortedAsc[lo]! * (1 - w) + sortedAsc[hi]! * w;
}

export function latencyStatsFromLatenciesMs(latenciesMs: number[]): LatencyStats {
    if (latenciesMs.length === 0) throw new Error("latencyStatsFromLatenciesMs requeres non-empty latencies");

    const sorted = [...latenciesMs].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
        count: sorted.length,
        minMs: sorted[0]!,
        maxMs: sorted[sorted.length - 1]!,
        avgMs: sum / sorted.length,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
    };
}