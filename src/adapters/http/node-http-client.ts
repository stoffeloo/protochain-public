import { type Address, type SignedTransaction, asUInt, type Hash } from "../../core/types";
import {
  ApiRoutes,
  type StatusResponse,
  type AccountResponse,
  type RawAccountResponse,
  type ChainResponse,
  type SubmitTxResponse,
  type TxResponse,
  type BlockResponse,
  type MempoolResponse,
  type PeerListResponse,
} from "./api";

export class HttpNodeClient {
  constructor(public readonly baseUrl: string) {}

  // ----- low-level helper -----

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, options);

    const text = await res.text();
    const json = text ? JSON.parse(text) : {};

    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} ${res.statusText}: ${JSON.stringify(json)}`
      );
    }

    return json as T;
  }

  // ----- high-level methods -----

  async getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>(ApiRoutes.GET.status.path);
  }

  async getChain(): Promise<ChainResponse> {
    return this.request<ChainResponse>(ApiRoutes.GET.chain.path);
  }

  async getAccount(address: Address): Promise<AccountResponse> {
    const raw = await this.request<RawAccountResponse>(
      ApiRoutes.GET.account.path(address)
    );

    return {
      ...raw,
      balance: asUInt(raw.balance),
    };
  }

  async getTx(hash: Hash): Promise<TxResponse> {
    return this.request<TxResponse>(ApiRoutes.GET.tx.path(hash));
  }

  async getBlock(identifier: string | number): Promise<BlockResponse> {
    return this.request<BlockResponse>(ApiRoutes.GET.block.path(identifier));
  }

  async getMempool(): Promise<MempoolResponse> {
    return this.request<MempoolResponse>(ApiRoutes.GET.mempool.path);
  }
  
  async submitTx(tx: SignedTransaction): Promise<SubmitTxResponse> {  
    const body = JSON.stringify(tx);
    return this.request<SubmitTxResponse>(
      ApiRoutes.POST.tx.path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }
    );
  }

  // only meant for peer-to-peer
  async getPeers(): Promise<PeerListResponse> {
    return this.request<PeerListResponse>(ApiRoutes.GET.peers.path);
  }

  async addPeer(url: string): Promise<PeerListResponse> {
    const body = JSON.stringify({ url });
    return this.request<PeerListResponse>(ApiRoutes.POST.addPeer.path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }
  
}
