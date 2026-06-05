import { createContractAddress, hjson } from "../crypto";
import { WorldState } from "../state";
import { txId } from "../transaction";
import type {
  Address,
  CallTx,
  ContractMetadata,
  DeployTx,
  Hash,
  SignedTransaction,
  TransactionGraph,
  TxDepEdge,
  TxKey,
  TxNode,
} from "../types";
import { topoSortTxGraph } from "./topoSortTxGraph";
import { transitiveReduction } from "./transativeReduction";

export function txGraphRoot(g: TransactionGraph): Hash {
  const edges = [...g.edges]
    .map(e => ({ from: e.from, to: e.to }))
    .sort((a, b) =>
      a.from === b.from ? (a.to < b.to ? -1 : a.to > b.to ? 1 : 0) : a.from < b.from ? -1 : 1
    );

  const keys = (Object.keys(g.txs) as TxKey[]).sort();
  const txsCanonical = keys.map(k => ({ id: k, tx: g.txs[k] }));

  return hjson({ edges, txs: txsCanonical });
}

export function buildSequentialTxGraphFromTxs(txs: SignedTransaction[]): TransactionGraph {
  const txMap: Partial<Record<TxKey, TxNode>> = {};
  const edges: TxDepEdge[] = [];
  const ids: TxKey[] = [];

  for (const tx of txs) {
    const id = txId(tx);
    ids.push(id);
    txMap[id] = { tx, redundant: false };
  }

  for (let i = 1; i < ids.length; i++) {
    edges.push({ from: ids[i - 1]!, to: ids[i]! });
  }

  return { txs: txMap as Record<TxKey, TxNode>, edges };
}

function relationMatches(
  rule: ContractMetadata["nonCommutativeOperations"][number],
  prev: CallTx,
  curr: CallTx,
  metadata: ContractMetadata
): boolean {
  const [op1, op2, relation] = rule;
  if (prev.data.method !== op1 || curr.data.method !== op2) return false;

  const method1Args = metadata.methods[op1] ?? [];
  const method2Args = metadata.methods[op2] ?? [];
  const idx1 = method1Args.indexOf(relation.argOp1);
  const idx2 = method2Args.indexOf(relation.argOp2);

  const prevArgs = [prev.from, prev.value ?? 0, ...(prev.data.args ?? [])];
  const currArgs = [curr.from, curr.value ?? 0, ...(curr.data.args ?? [])];

  // Unknown argument mapping should over-constrain for safety.
  if (idx1 < 0 || idx2 < 0) return true;

  const left = prevArgs[idx1];
  const right = currArgs[idx2];

  const leftStr = hjson(left);
  const rightStr = hjson(right);

  switch (relation.argRelation) {
    case "Equals":
      return leftStr === rightStr;
    case "NotEquals":
      return leftStr !== rightStr;
    default:
      throw new Error(
        `Unsupported argRelation '${relation.argRelation}' for operations ${op1} -> ${op2}`
      );
  }
}

function shouldOrderCalls(
  prev: CallTx,
  curr: CallTx,
  metadata: ContractMetadata | undefined
): boolean {
  if (!metadata) {
    // Without metadata we order to preserve correctness.
    return true;
  }

  const prevMethod = prev.data.method;
  const currMethod = curr.data.method;

  if (!metadata.methods[prevMethod] || !metadata.methods[currMethod]) {
    return true;
  }

  const rules = metadata.nonCommutativeOperations;
  let hasPairRule = false;
  for (const r of rules) {
    if (r[0] !== prevMethod || r[1] !== currMethod) continue;
    hasPairRule = true;
    if (relationMatches(r, prev, curr, metadata)) return true;
  }

  if (hasPairRule) return false;

  // Dependencies are defined by nonCommutativeOperations only, so if there are no rules for this pair, we can consider them independent.
  return false;
}

function getMetadataForCall(
  ws: WorldState,
  callTo: Address,
  previousDeploys: DeployTx[]
): ContractMetadata | undefined {
  const onChain = ws.read(callTo).metadata;
  if (onChain) return onChain;

  for (let i = previousDeploys.length - 1; i >= 0; i--) {
    const deploy = previousDeploys[i]!;
    const addr = createContractAddress(deploy.from, deploy.nonce);
    if (addr === callTo) {
      return deploy.data.metadata;
    }
  }

  return undefined;
}

function addEdge(edges: Set<string>, from: SignedTransaction, to: SignedTransaction) {
  edges.add(`${txId(from)}->${txId(to)}`);
}

function parseEdge(encoded: string): TxDepEdge {
  const [from, to] = encoded.split("->");
  if (!from || !to) throw new Error(`Invalid encoded edge: ${encoded}`);
  return { from: from as TxKey, to: to as TxKey };
}

export function buildTxGraphFromTxs(txs: SignedTransaction[], ws: WorldState): TransactionGraph {
  const txMap: Partial<Record<TxKey, TxNode>> = {};
  const edges = new Set<string>();
  const seen = new Set<TxKey>();

  const previous: SignedTransaction[] = [];

  for (const tx of txs) {
    const id = txId(tx);
    if (seen.has(id)) throw new Error(`Duplicate transaction detected with id: ${id}`);
    seen.add(id);
    txMap[id] = { tx, redundant: false };

    for (const p of previous) {
      if (p.from === tx.from && p.nonce + 1 === tx.nonce) {
        addEdge(edges, p, tx);
      }

      if (
        tx.kind === "call" &&
        p.kind === "deploy" &&
        createContractAddress(p.from, p.nonce) === tx.to
      ) {
        addEdge(edges, p, tx);
      }
    }

    if (tx.kind === "transfer") {
      for (const p of previous) {
        if (p.kind === "transfer" || p.kind === "call") {
          addEdge(edges, p, tx);
        }
      }
    }

    if (tx.kind === "call") {
      const prevDeploys = previous.filter(p => p.kind === "deploy") as DeployTx[];
      const currMeta = getMetadataForCall(ws, tx.to, prevDeploys);

      for (const p of previous) {
        if (p.kind === "transfer") { //as long as we do not know what the side effects of the call are, any kind of funds exchange can interfere
          addEdge(edges, p, tx);
          continue;
        }

        if (p.kind !== "call") continue;

        if (p.to !== tx.to) {
          if ((p.value ?? 0) > 0 || (tx.value ?? 0) > 0) {
            addEdge(edges, p, tx);
          }
          continue;
        }

        if (shouldOrderCalls(p, tx, currMeta)) {
          addEdge(edges, p, tx);
        }
      }
    }

    if (tx.kind === "generation") {
      throw new Error("Failed building graph: Generation transactions should not be included in a non-genesis block");
    }

    previous.push(tx);
  }

  const graph: TransactionGraph = {
    txs: txMap as Record<TxKey, TxNode>,
    edges: [...edges].map(parseEdge),
  };

  const reduced = transitiveReduction(graph);
  return markSupersededTransactions(reduced, ws);
}

//todo: should we include prev.from and prev.value, I dont think so but I am not sure
function sameArgs(prev: CallTx, curr: CallTx): boolean {
  return hjson([prev.from, prev.value ?? 0, ...(prev.data.args ?? [])]) ===
    hjson([curr.from, curr.value ?? 0, ...(curr.data.args ?? [])]);
}

function callSupersedes(
  supersededTx: SignedTransaction,
  supersedingTx: SignedTransaction,
  ws: WorldState,
  previousDeploys: DeployTx[]
): boolean {
  if (supersededTx.kind !== "call" || supersedingTx.kind !== "call") return false;
  if (supersededTx.to !== supersedingTx.to) return false;

  const metadata = getMetadataForCall(ws, supersededTx.to, previousDeploys);
  if (!metadata) return false;

  const supersededMethod = supersededTx.data.method;
  const supersedingMethod = supersedingTx.data.method;

  // Idempotent is a special case of supersede: same method and same args.
  if (
    supersededMethod === supersedingMethod &&
    metadata.idempotentOperations.includes(supersededMethod) &&
    sameArgs(supersededTx, supersedingTx)
  ) {
    return true;
  }

  for (const r of metadata.supersedeOperations) {
    if (r[0] !== supersededMethod || r[1] !== supersedingMethod) continue;
    if (relationMatches(r, supersededTx, supersedingTx, metadata)) return true;
  }

  return false;
}

function markSupersededTransactions(graph: TransactionGraph, ws: WorldState): TransactionGraph {
  const topoSortedKeys = topoSortTxGraph(graph);
  const topoSortedTxs = topoSortedKeys.map(k => graph.txs[k]!.tx);
  const previousDeploys = topoSortedTxs.filter(tx => tx.kind === "deploy") as DeployTx[];

  for (const key of topoSortedKeys) {
    const tx = graph.txs[key]!.tx;
    const dependents = graph.edges
      .filter(e => e.from === key)
      .map(e => graph.txs[e.to]!.tx);

    const redundant =
      dependents.length > 0 &&
      dependents.every(dep => callSupersedes(tx, dep, ws, previousDeploys));
    graph.txs[key]!.redundant = redundant;
  }

  return graph;
}
