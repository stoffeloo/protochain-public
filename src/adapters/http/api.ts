import type { Address, SignedTransaction, Block, UInt, Hash, ContractState } from "../../core/types";

export interface StatusResponse {
  address: Address;
  height: number;
  latestHash: string | null;
  mempoolSize: number;
        //peers
      //port
      //mempool
      //worldstate.acc[ounts]
}

export interface AccountResponse {
  address: Address;
  nonce: number;
  balance: UInt;
  state: ContractState;
  code?: string;
}

// Wire-format account as returned over HTTP (JSON numbers)
export interface RawAccountResponse {
  address: Address;
  nonce: number;
  balance: number;
  state: ContractState;
  code?: string;
}

export interface ChainResponse {
  height: number;
  blocks: Block[];
}

export interface SubmitTxResponse {
  status: string;
}

export interface TxResponse {
  tx: SignedTransaction;
  status: "pending" | "included" | "failed";
  block?: number;
  logs?: { contract: Address; msg: string }[];
}

export interface BlockResponse {
  header: Block["header"];
  // txs: SignedTransaction[]; now redundent since part of graph 
  txGraph: Block["txGraph"];
  logs: Block["logs"];
  stateRoot: Hash;
}

export interface MempoolResponse {
  pending: Hash[];
}

export interface PeerListResponse {
  peers: string[];
}

export interface AddPeerRequest {
  url: string;
}

export interface PeerTxRequest {
  tx: SignedTransaction;
}

export interface PeerBlockRequest {
  block: Block;
}


export const ApiRoutes = {
  GET: {
    status: { method: "GET", path: "/status" } as const,
    chain: { method: "GET", path: "/chain" } as const,
    account: {
      method: "GET",
      path: (address: Address) => `/account/${encodeURIComponent(address)}`,
      base: "/account/" as const,
    } as const,
    tx: {
      method: "GET",
      path: (hash: Hash) => `/tx/${encodeURIComponent(hash)}`,
      base: "/tx/" as const,
    } as const,
    block: {
      method: "GET",
      path: (identifier: string | number) => `/block/${encodeURIComponent(String(identifier))}`,
      base: "/block/" as const,
    } as const,
    mempool: { method: "GET", path: "/mempool" } as const,

    peers: { method: "GET", path: "/peers" } as const,
  },
  POST: {
    // client → node
    tx: { method: "POST", path: "/tx" } as const,

    // node ↔ node (endpoints that only peers may use)
    peerTx: { method: "POST", path: "/peer/tx" } as const,
    peerBlock: { method: "POST", path: "/peer/block" } as const,
    addPeer: { method: "POST", path: "/peers" } as const,
  },
} as const;


