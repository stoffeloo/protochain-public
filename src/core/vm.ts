import {
  asUInt,
  type Address,
  type UInt,
  type SignedTransaction,
  type BlockCtx,
  type ContractState,
  type ContractModule,
  type ContractExecutionEnv,
} from "./types";
import { WorldState } from "./state";

export function loadContract(code: string): ContractModule {
  const trimmed = code.trim();
  const mod = new Function(`"use strict"; return (${trimmed});`)();

  if (!mod || typeof mod !== "object") {
    throw new Error("contract source did not evaluate to a contract object");
  }

  if (!("initialState" in mod)) {
    throw new Error("contract object has no initialState");
  }

  if (!("methods" in mod) || typeof mod.methods !== "object" || mod.methods === null) {
    throw new Error("contract object has no methods");
  }

  return mod as ContractModule;
}

export function runContract(
  ws: WorldState,
  to: Address,
  tx: SignedTransaction,
  blockCtx: BlockCtx,
  log?: (msg: string) => void
): unknown {
  if (tx.kind !== "call") {
    throw new Error("only call transactions can run contracts");
  }

  const acc = ws.read(to);
  if (!acc.code) {
    throw new Error("no contract code at address");
  }

  const module = loadContract(acc.code);

  const methodName = tx.data.method;
  if (typeof methodName !== "string" || methodName.length === 0) {
    throw new Error("method name must be a non-empty string");
  }

  const methodSpecification = module.methods[methodName];
  if (!methodSpecification) {
    throw new Error(`method ${methodName} not found in contract`);
  }

  const env: ContractExecutionEnv = {
    self: to,
    blockCtx,

    require: (cond: boolean, msg?: string) => {
      if (!cond) throw new Error(msg || "require failed");
    },

    balanceOf: (addr: Address) => ws.read(addr).balance,

    transfer: (addr: Address, amount: UInt) => {
      ws.transfer(to, addr, amount);
    },

    getSelfState: () => {
      const self = ws.read(to);
      if (!self.code) {
        throw new Error(`no contract code at address ${to}`);
      }

      return self.state as ContractState;
    },

    readContractState: (addr: Address): ContractState => {
      const other = ws.read(addr);
      if (!other.code) {
        throw new Error(`no contract code at address ${addr}`);
      }

      return other.state as ContractState;
    },

    call: (toAddr, data, value) => {
      const amount = value ?? asUInt(0);

      // if the internal call sends value, transfer it first
      if (amount > 0) {
        ws.transfer(to, toAddr, amount);
      }

      const internalTx: SignedTransaction = {
        kind: "call",
        from: to,
        to: toAddr,
        nonce: 0,         // dummy value for internal call
        pubkey: "0x0",    // dummy value for internal call
        signature: "0x0", // dummy value for internal call
        value: amount,
        data: {
          method: data.method,
          args: data.args ?? [],
        },
      };

      return runContract(ws, toAddr, internalTx, blockCtx, log);
    },
  };

  const newState = methodSpecification.run([
    tx.from,
    asUInt(tx.value ?? 0),
    ...(tx.data.args ?? []),
  ], env);

  acc.state = newState;

  return undefined;
}