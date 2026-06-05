import { WorldState } from "./core/state";
import { Address, UInt } from "./core/types";

export function applyGenesisAlloc(ws: WorldState, alloc: Record<Address, UInt>) {
    for (const [addr, amount] of Object.entries(alloc) as [Address, UInt][]) {
      const act = ws.getOrCreate(addr);
      act.balance = amount;
    }
  }