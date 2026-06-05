import invariant from "tiny-invariant";
import type { TransactionGraph, TxKey } from "../types";

// Deterministic topo sort: Kahn + tie-break by txId lexicographic
export function topoSortTxGraph(g: TransactionGraph): TxKey[] {
    const nodes = Object.keys(g.txs) as TxKey[];
  
    // build indegree + adjacency
    const indeg = new Map<TxKey, number>();
    const out = new Map<TxKey, TxKey[]>();
    for (const n of nodes) {
      indeg.set(n, 0);
      out.set(n, []);
    }
  
    for (const e of g.edges) {
      invariant(g.txs[e.from], "edge.from missing tx");
      invariant(g.txs[e.to], "edge.to missing tx");
      out.get(e.from)!.push(e.to);
      indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    }
  
    // initial ready set
    const ready: TxKey[] = [];
    for (const n of nodes) if ((indeg.get(n) ?? 0) === 0) ready.push(n);
    ready.sort(); // lexicographic by txId
  
    const result: TxKey[] = [];
  
    while (ready.length > 0) {
      const n = ready.shift()!;
      result.push(n);
  
      const succ = out.get(n)!;
      succ.sort(); // deterministic iteration
      for (const m of succ) {
        indeg.set(m, (indeg.get(m) ?? 0) - 1);
        if (indeg.get(m) === 0) {
          ready.push(m);
          ready.sort();
        }
      }
    }
  
    invariant(result.length === nodes.length, "cycle detected (graph not a DAG)");
    return result;
  }
  