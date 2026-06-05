import { loadContract } from "../vm";
import {
    type Address,
    type UInt,
    type GlobalGraphBuildingEnvironment,
    type GraphContractObject,
    type GraphLiftedMethod,
    type ContractMethodDefinition,
    asUInt,
} from "../types";
import { WorldState } from "../state";

export function buildGlobalGraphBuildingEnvironment(
    ws: WorldState,
    blockNumber: number
): GlobalGraphBuildingEnvironment {
    const balances: Record<Address, UInt> = {} as Record<Address, UInt>;
    const contracts: Record<Address, GraphContractObject> = {} as Record<Address, GraphContractObject>;

    for (const [addr, acc] of ws.entries()) {
        balances[addr] = acc.balance;

        if (acc.code) {
            const module = loadContract(acc.code);
            const liftedMethods: Record<string, GraphLiftedMethod> = {};

            for (const [methodName, methodSpec] of Object.entries(module.methods)) {
                liftedMethods[methodName] = liftMethod(addr, methodSpec);
            }

            contracts[addr] = {
                address: addr,
                code: acc.code,
                name: module.name,
                state: structuredClone(acc.state),
                methods: liftedMethods,
            };
        }
    }

    return {
        balances,
        contracts,

        transfer(from: Address, to: Address, amount: UInt) {
            return applyGraphTransfer(this, from, to, amount);
        },

        metadata: {
            blockNumber,
        },
    };
}

function applyGraphTransfer(
    env: GlobalGraphBuildingEnvironment,
    from: Address,
    to: Address,
    amount: UInt
): GlobalGraphBuildingEnvironment {
    const amt = asUInt(amount);

    if (amt < 0) {
        throw new Error("transfer amount must be non-negative");
    }

    const fromBalance = env.balances[from] ?? asUInt(0);
    const toBalance = env.balances[to] ?? asUInt(0);

    if (fromBalance < amt) {
        throw new Error("insufficient balance for transfer");
    }

    return {
        ...env,
        balances: {
            ...env.balances,
            [from]: asUInt(fromBalance - amt),
            [to]: asUInt(toBalance + amt),
        },
    };
}

function applyGraphCall(
    env: GlobalGraphBuildingEnvironment,
    to: Address,
    method: string,
    args: unknown[],
    caller: Address,
    value: UInt
): GlobalGraphBuildingEnvironment {
    const contract = env.contracts[to];
    if (!contract) {
        throw new Error(`target contract ${to} not found in graph env`);
    }

    const lifted = contract.methods[method];
    if (!lifted) {
        throw new Error(`method ${method} not found on contract ${to}`);
    }

    return lifted(env, args, caller, value);
}

function liftMethod(
    contractAddr: Address,
    methodSpec: ContractMethodDefinition
): GraphLiftedMethod {
    return (env, args, caller, value) => {
        const contract = env.contracts[contractAddr];
        if (!contract) {
            throw new Error(`contract ${contractAddr} not found in graph env`);
        }

        let workingEnv: GlobalGraphBuildingEnvironment = {
            ...env,
            balances: { ...env.balances },
            contracts: { ...env.contracts },
            metadata: { ...env.metadata },
        };

        const getBalance = (addr: Address): UInt =>
            workingEnv.balances[addr] ?? asUInt(0);

        const getContractState = (addr: Address) => {
            const c = workingEnv.contracts[addr];
            if (!c) {
                throw new Error(`contract ${addr} not found in graph env`);
            }
            return c.state;
        };

        // If the call carries value, simulate caller -> contract transfer first
        if (value > 0) {
            workingEnv = applyGraphTransfer(workingEnv, caller, contractAddr, value);
        }

        const localEnv = {
            self: contractAddr,
            blockCtx: { number: workingEnv.metadata.blockNumber },

            require: (cond: boolean, msg?: string) => {
                if (!cond) throw new Error(msg || "require failed");
            },

            balanceOf: (addr: Address) => getBalance(addr),

            getSelfState: () => getContractState(contractAddr),

            readContractState: (addr: Address) => getContractState(addr),

            transfer: (to: Address, amount: UInt) => {
                workingEnv = applyGraphTransfer(workingEnv, contractAddr, to, amount);
            },

            call: (to: Address, data: { method: string; args: unknown[] }, callValue?: UInt) => {
                workingEnv = applyGraphCall(
                    workingEnv,
                    to,
                    data.method,
                    data.args ?? [],
                    contractAddr,
                    callValue ?? asUInt(0)
                );
            },
        };

        const newState = methodSpec.run([
            caller,
            value,
            ...args,
        ], localEnv);

        workingEnv = {
            ...workingEnv,
            contracts: {
                ...workingEnv.contracts,
                [contractAddr]: {
                    ...workingEnv.contracts[contractAddr],
                    state: newState,
                },
            },
        };

        return workingEnv;
    };
}