import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import type { Address, SignedTransaction, Block, GenesisConfig, Hash, ExecutionMode, MiningSpeedConfig } from "../../core/types";
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
  type AddPeerRequest,
} from "./api";
import { Node } from "../../core/node";
import { txId } from "../../core/transaction";
import { appendBlock } from "../../core/block";
import { formatError } from "../../error";
import { encode } from "node:punycode";
import { renderTxGraphHtml } from "./txgraph-html";

export class HttpNodeServer {
  private httpServer: ReturnType<typeof createServer> | undefined;
  private peers: string[];

  constructor(
    readonly node: Node,
    readonly port: number,
    peers: string[] = [],
  ) {
    this.peers = peers;

    // When this node produces a block it is broadcasted to all peers
    this.node.onBlockProduced = (block: Block) => {
      void this.broadcastBlock(block);
    };
  }

  listen() {
    if (this.httpServer) return;

    this.httpServer = createServer(async (req, res) => {
      try {
        await this.route(req, res);
      } catch (err) {
        console.error("HTTP handler threw:", err);
        this.sendJson(res, 500, { error: "internal_error" });
      }
    });

    this.httpServer.listen(this.port, () => {
      const id = this.node.proposer?.slice(0, 10) ?? "unknown";
      console.log(`HTTP node ${id} listening on port ${this.port}`);
    });
  }

  close() {
    if (!this.httpServer) return;
    this.httpServer.close();
    this.httpServer = undefined;
  }

  // -------- routing --------

  private async route(req: IncomingMessage, res: ServerResponse) {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);

    // --- peer endpoints (node ↔ node) ---

    // POST /peer/tx
    if (method === "POST" && url.pathname === ApiRoutes.POST.peerTx.path) {
      const body = await this.readJsonBody(req);
      return this.handlePeerTx(res, body);
    }

    // POST /peer/block
    if (method === "POST" && url.pathname === ApiRoutes.POST.peerBlock.path) {
      const body = await this.readJsonBody(req);
      return this.handlePeerBlock(res, body);
    }

    // GET /peers
    if (method === "GET" && url.pathname === ApiRoutes.GET.peers.path) {
      return this.handlePeers(res);
    }

    // POST /peers
    if (method === "POST" && url.pathname === ApiRoutes.POST.addPeer.path) {
      const body = await this.readJsonBody(req);
      return this.handleAddPeer(res, body);
    }

    // ---  client endpoints ---

    // GET /status
    if (method === "GET" && url.pathname === ApiRoutes.GET.status.path) {
      return this.handleStatus(res);
    }

    // GET /chain
    if (method === "GET" && url.pathname === ApiRoutes.GET.chain.path) {
      return this.handleChain(res);
    }

    // GET /account/:address
    if (method === "GET" && url.pathname.startsWith(ApiRoutes.GET.account.base)) {
      const addr = decodeURIComponent(
        url.pathname.slice(ApiRoutes.GET.account.base.length),
      ) as Address;
      return this.handleAccount(res, addr);
    }

    // GET /tx/:hash
    if (method === "GET" && url.pathname.startsWith(ApiRoutes.GET.tx.base)) {
      const hash = decodeURIComponent(
        url.pathname.slice(ApiRoutes.GET.tx.base.length),
      ) as Hash;
      return this.handleTx(res, hash);
    }

    // GET /block/:number or :hash
    if (method === "GET" && url.pathname.startsWith(ApiRoutes.GET.block.base)) {
      const identifier = decodeURIComponent(
        url.pathname.slice(ApiRoutes.GET.block.base.length),
      );
      return this.handleBlock(res, identifier);
    }

    // GET /mempool
    if (method === "GET" && url.pathname === ApiRoutes.GET.mempool.path) {
      return this.handleMempool(res);
    }

    // POST /tx
    if (method === "POST" && url.pathname === ApiRoutes.POST.tx.path) {
      const body = await this.readJsonBody(req);
      return this.handleSubmitTx(res, body);
    }

    // 404 fallthrough
    this.sendJson(res, 404, { error: "not_found" });
  }

  // -------- handlers (client) --------

  private handleStatus(res: ServerResponse): void {
    const head: Block | undefined = this.node.chain[this.node.chain.length - 1];
    const payload: StatusResponse = {
      address: this.node.proposer,
      height: head?.header.number ?? 0,
      latestHash: head?.hash ?? null,
      mempoolSize: this.node.mempool.length,

    };

    this.sendJson(res, 200, payload);
  }

  private handleChain(res: ServerResponse): void {
    const payload: ChainResponse = {
      height: this.node.chain.length,
      blocks: this.node.chain,
    };

    this.sendJson(res, 200, payload);
  }

  private handleAccount(res: ServerResponse, address: Address): void {
    try {
      const account = this.node.ws.read(address);
      const payload: AccountResponse = {
        address,
        nonce: account.nonce,
        balance: account.balance,
        state: account.state,
        ...(account.code && { code: account.code }),
      };

      this.sendJson(res, 200, payload);
    } catch {
      this.sendJson(res, 404, { error: "unknown_account" }); //door hoe ws.read werkt zou nooit mogen gebeuren
    }
  }

  private handleTx(res: ServerResponse, hash: Hash): void {
    // Check mempool first
    for (const tx of this.node.mempool) {
      if (txId(tx) === hash) {
        const payload: TxResponse = {
          tx,
          status: "pending",
          logs: [],
        };
        this.sendJson(res, 200, payload);
        return;
      }
    }

    // Check blocks
    for (const block of this.node.chain) {
      const txs = Object.values(block.txGraph.txs).map(node => node.tx);
      for (const tx of txs) {
        if (txId(tx) === hash) {
          const payload: TxResponse = {
            tx,
            status: "included",
            block: block.header.number,
            logs: block.logs.filter((log) => {
              // Filter logs relevant to this transaction
              // For simplicity, include all logs from the block
              // todo: track which logs belong to which tx
              return true;
            }),
          };
          this.sendJson(res, 200, payload);
          return;
        }
      }
    }

    // Check failed transactions
    const tx = this.node.failedTransactions.get(hash);
    if (tx) {
      const payload: TxResponse = { tx, status: "failed" };
      this.sendJson(res, 200, payload);
      return;
    }

    this.sendJson(res, 404, { error: "transaction_not_found" });
  }

  private handleBlock(res: ServerResponse, identifier: string): void {
    let block: Block | undefined;

    // Try as block number first
    const blockNum = Number.parseInt(identifier, 10);
    if (!Number.isNaN(blockNum) && blockNum >= 0 && blockNum < this.node.chain.length) {
      block = this.node.chain[blockNum];
    } else {
      // Try as hash
      block = this.node.chain.find((b) => b.hash === identifier);
    }

    if (!block) {
      this.sendJson(res, 404, { error: "block_not_found" });
      return;
    }


    //if json for entire block is asked
    const payload: BlockResponse = {
      header: block.header,
      txGraph: block.txGraph,
      logs: block.logs,
      stateRoot: block.header.stateRoot,
    };

    const wantsTxGraphHtml = identifier.endsWith("/txgraph");

    if (wantsTxGraphHtml) {
      return this.sendHtml(res, 200, renderTxGraphHtml(identifier, block.txGraph));
    }

    this.sendJson(res, 200, payload);
  }

  private handleMempool(res: ServerResponse): void {
    const pending = this.node.mempool.map((tx) => txId(tx));
    const payload: MempoolResponse = { pending };
    this.sendJson(res, 200, payload);
  }

  private handleSubmitTx(res: ServerResponse, raw: unknown): void {
    try {
      const tx = this.toSignedTransaction(raw);
      const status = this.node.submitTx(tx);
      if (status === "accepted") {void this.broadcastTx(tx);} // broadcast the received tx to peers if it was the first time we saw it and it was accepted
      const payload: SubmitTxResponse = { status: status };
      this.sendJson(res, 200, payload);
    } catch (err) {
      console.error("Rejecting tx:", err);
      this.sendJson(res, 400, {
        error: "invalid_tx",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------- handlers (peers) --------

  private handlePeerTx(res: ServerResponse, body: any): void {
    try {
      const rawTx = body && typeof body === "object" && "tx" in body ? body.tx : body;
      const tx = this.toSignedTransaction(rawTx);
      const status = this.node.submitTx(tx);
      if (status === "accepted") {void this.broadcastTx(tx);} // Only rebroadcast if accepted, not if duplicate since that transaction would already have been broadcasted
      const payload: SubmitTxResponse = { status: status };
      this.sendJson(res, 200, payload);
    } catch (err) {
      console.error(formatError("Rejecting peer tx:", 'peer-communication'), err);
      this.sendJson(res, 400, {
        error: "invalid_tx",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handlePeerBlock(res: ServerResponse, body: any): Promise<void> {
    try {
      const block: Block =
        body && typeof body === "object" && "block" in body ? body.block : body;
      const isNew = !this.node.hasBlock(block.hash);

      //todo: I think the block should first also be verified before appending it to the chain, to avoid invalid blocks being added to the chain

      await this.node.addBlock(block);
      // Only gossip if this is the first time we see it, to prevent rebroadcast loops
      if (isNew) this.broadcastBlock(block);

      this.sendJson(res, 200, { status: "accepted" });
    } catch (err) {
      console.error(formatError("Rejecting peer block:", 'peer-communication'), err);
      this.sendJson(res, 400, {
        error: "invalid_block",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handlePeers(res: ServerResponse): void {
    const payload: PeerListResponse = { peers: this.peers };
    this.sendJson(res, 200, payload);
  }

  private handleAddPeer(res: ServerResponse, body: any): void {
    const url = (body as AddPeerRequest | null)?.url;
    if (!url || typeof url !== "string") {
      console.error(formatError("Invalid peer URL in addPeer:", 'peer-communication'), body);
      this.sendJson(res, 400, { error: "invalid_peer_url" });
      return;
    }

    if (!this.peers.includes(url)) {
      this.peers.push(url);
    }

    const payload: PeerListResponse = { peers: this.peers };
    this.sendJson(res, 200, payload);
  }

  // -------- helpers --------

  /**
   * Read the request body (if any) and parse JSON.
   */
  private readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let buf = "";

      req.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        if (buf.length > 1_000_000) {
          // sanity limit
          req.destroy();
          reject(new Error("request_body_too_large"));
        }
      });

      req.on("end", () => {
        if (!buf) {
          resolve({});
          return;
        }
        try {
          const parsed = JSON.parse(buf);
          resolve(parsed);
        } catch (e) {
          reject(new Error("invalid_json"));
        }
      });

      req.on("error", (e) => reject(e));
    });
  }

  private toSignedTransaction(raw: any): SignedTransaction {
    if (!raw || typeof raw !== "object") {
      throw new Error("tx_payload_must_be_object");
    }

    const copy = { ...raw };

    // Ensure nonce is a number (it might have been a string)
    if (typeof copy.nonce === "string") {
      copy.nonce = Number(copy.nonce);
    }
    // if value/amount fields can be strings, normalize those as numbers too:
    if (typeof copy.value === "string") copy.value = Number(copy.value);
    if (typeof copy.amount === "string") copy.amount = Number(copy.amount);

    return copy as SignedTransaction;
  }


  private sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
    const body = JSON.stringify(payload);
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(body);
  }

  private sendHtml(res: ServerResponse, statusCode: number, html: string) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  }

  // -- peer broadcasting --

  private async broadcastTx(tx: SignedTransaction): Promise<void> {
    if (!this.peers.length) return;

    const payload = { tx };
    await Promise.all(
      this.peers.map(async (baseUrl) => {
        try {
          const url = new URL(ApiRoutes.POST.peerTx.path, baseUrl).toString();
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } catch (err) {
          console.error(`Failed to broadcast tx to ${baseUrl}:`, err);
        }
      }),
    );
  }

  private async broadcastBlock(block: Block): Promise<void> {
    if (!this.peers.length) return;

    const payload = { block };
    await Promise.all(
      this.peers.map(async (baseUrl) => {
        try {
          const url = new URL(ApiRoutes.POST.peerBlock.path, baseUrl).toString();
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } catch (err) {
          console.error(`Failed to broadcast block to ${baseUrl}:`, err);
        }
      }),
    );
  }
}


export interface NodeHttpOptions {
  proposer: Address;
  port: number;
  executionMode: ExecutionMode;
  miningPower?: number;
  miningSpeed?: MiningSpeedConfig;
  genesis?: GenesisConfig;
  peers?: string[];
  startProducer?: boolean; // whether this node should produce blocks
}

export async function startNodeWithHttp(opts: NodeHttpOptions) {
  const { proposer, port, executionMode, miningPower, miningSpeed, genesis, peers, startProducer } = opts;
  const node = new Node(proposer, miningPower, miningSpeed ?? { defaultMineSpeed: 1000 }, executionMode, genesis);
  // node.start();
  if (startProducer) await node.start();
  const httpServer = new HttpNodeServer(node, port, peers);
  httpServer.listen();
  return { node, httpServer };
}