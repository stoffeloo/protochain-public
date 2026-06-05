import { asUInt, type Account, type Address, type ContractMetadata, type UInt } from "./types";
import invariant from "tiny-invariant";
import _ from "lodash";
import { loadContract } from "./vm";

export class WorldState {
  private acc = new Map<Address, Account>();

  //get the account of an address, if there is no account yet (address has never been used before) make a new account for it
  getOrCreate(a: Address): Account {
    if (!this.acc.has(a)) this.acc.set(a, { nonce: 0, balance: asUInt(0), state: {} });
    return this.acc.get(a)!;
  }

  read(a: Address) { return this.getOrCreate(a); }

  transfer(from: Address, to: Address, amount: UInt) {
    const amt = asUInt(amount);
    const fromAcc = this.getOrCreate(from);
    const toAcc   = this.getOrCreate(to);
    invariant(fromAcc.balance >= amt, "insufficient_balance");
    fromAcc.balance = asUInt(fromAcc.balance - amt);
    toAcc.balance   = asUInt(toAcc.balance + amt);
  }

  mint(to: Address, amount: UInt) {
    const amt = asUInt(amount);
    const toAcc = this.getOrCreate(to);
    toAcc.balance = asUInt(toAcc.balance + amt);
  }

  createContract(addr: Address, code: string, metadata: ContractMetadata) {
    const acc = this.getOrCreate(addr);
    invariant(!acc.code, "contract already exists at address");
    acc.code = code;
    acc.metadata = metadata;
    const module = loadContract(code);
    acc.state = _.cloneDeep(module.initialState);
    //todo: maybe should put acc.code to code without the initialState part, since it will never be used again,
    //and is not accessable only good to be able to verify at any point what the original initial state was so maybe useful
  }

  snapshotObj(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    [...this.acc.entries()].sort(([a],[b]) => a.localeCompare(b))
      .forEach(([addr, act]) => obj[addr] = act);
    return obj;
  }

  clone(): WorldState {
    return _.cloneDeep(this);
  }

  fromClone(other: WorldState) {
    this.acc = _.cloneDeep(other.acc);
  }

  entries(): Array<[Address, Account]> {
    return [...this.acc.entries()].sort(([a], [b]) => a.localeCompare(b));
  }
}
