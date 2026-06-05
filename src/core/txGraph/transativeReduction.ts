import type { TransactionGraph, TxDepEdge, TxKey } from "../types";

//I did not write this implemenation of transitive reduction,
//I had it be ai generated,
//I think this part of our thesis is not so important
//having a transivite reduced graph is just cleaner but it is not necessary
//so I just wanted to have a working version fast
//and move onto implementing the conflicts between transactions as efficient as possible
//so this implementation might as well be wrong, I tested it on 3 very simple graphs and it seemed to be right

// todo: very simple transtive reduction should be made more efficient ...
export function transitiveReduction(graph: TransactionGraph): TransactionGraph {
  const adj = new Map<TxKey, TxKey[]>();
  for (const k of Object.keys(graph.txs) as TxKey[]) {
    adj.set(k, []);
  }

  for (const e of graph.edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  for (const [k, list] of adj) {
    list.sort();
  }
  const edgesSorted = [...graph.edges].sort((a, b) =>
    a.from === b.from ? (a.to < b.to ? -1 : a.to > b.to ? 1 : 0) : (a.from < b.from ? -1 : 1)
  );

  const isReachableWithoutEdge = (from: TxKey, to: TxKey, skip: TxDepEdge): boolean => {
    if (from === to) return true;

    const visited = new Set<TxKey>();
    const stack: TxKey[] = [from];
    visited.add(from);

    while (stack.length > 0) {
      const cur = stack.pop()!;
      const nexts = adj.get(cur);
      if (!nexts) continue;

      for (const nxt of nexts) {
        if (cur === skip.from && nxt === skip.to) continue;

        if (nxt === to) return true;
        if (!visited.has(nxt)) {
          visited.add(nxt);
          stack.push(nxt);
        }
      }
    }
    return false;
  };

  const kept: TxDepEdge[] = [];
  for (const e of edgesSorted) {
    const redundant = isReachableWithoutEdge(e.from, e.to, e);
    if (!redundant) kept.push(e);
  }

  return { txs: graph.txs, edges: kept };
}