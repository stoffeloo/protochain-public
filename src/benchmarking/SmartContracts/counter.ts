import { ContractMetadata, ContractModule } from "../../core/types";

type CounterState = {
  a: number;
  b: number;
};

export const CounterSmartContract: ContractModule<CounterState> = {
  name: "CounterSmartContract",

  initialState: {
    a: 0,
    b: 0,
  },

  methods: {
    incrementA: {
      run: ([_caller, _value], env) => {
        const state = env.getSelfState() as CounterState;
        return {
          ...state,
          a: state.a + 1,
        };
      },
    },

    incrementB: {
      run: ([_caller, _value], env) => {
        const state = env.getSelfState() as CounterState;
        return {
          ...state,
          b: state.b + 1,
        };
      },
    },

    setA: {
      run: ([_caller, _value, value], env) => {
        const state = env.getSelfState() as CounterState;
        env.require(typeof value === "number" && Number.isInteger(value), "bad value");
        return {
          ...state,
          a: value as number,
        };
      },
    },

    setB: {
      run: ([_caller, _value, value], env) => {
        const state = env.getSelfState() as CounterState;
        env.require(typeof value === "number" && Number.isInteger(value), "bad value");
        return {
          ...state,
          b: value as number,
        };
      },
    },

    resetAll: {
      run: ([_caller, _value], env) => {
        return {
          a: 0,
          b: 0,
        };
      },
    },
  },
};

export const contractMetadata: ContractMetadata = {
  hash: "counter-v1",
  seqName: "Counter",
  methods: {
    incrementA: ["_caller", "_value"],
    incrementB: ["_caller", "_value"],
    setA: ["_caller", "_value", "value"],
    setB: ["_caller", "_value", "value"],
    resetAll: ["_caller", "_value"],
  },
  nonCommutativeOperations: [
    ["incrementA", "incrementA", { argOp1: "_", argOp2: "_", argRelation: "Equals" }],
    ["incrementA", "setA", { argOp1: "_", argOp2: "value", argRelation: "Equals" }],
    ["setA", "incrementA", { argOp1: "value", argOp2: "_", argRelation: "Equals" }],
    ["setA", "setA", { argOp1: "value", argOp2: "value", argRelation: "Equals" }],
    ["incrementB", "incrementB", { argOp1: "_", argOp2: "_", argRelation: "Equals" }],
    ["incrementB", "setB", { argOp1: "_", argOp2: "value", argRelation: "Equals" }],
    ["setB", "incrementB", { argOp1: "value", argOp2: "_", argRelation: "Equals" }],
    ["setB", "setB", { argOp1: "value", argOp2: "value", argRelation: "Equals" }],
    ["resetAll", "incrementA", { argOp1: "_", argOp2: "_", argRelation: "Equals" }],
    ["resetAll", "incrementB", { argOp1: "_", argOp2: "_", argRelation: "Equals" }],
    ["resetAll", "setA", { argOp1: "_", argOp2: "value", argRelation: "Equals" }],
    ["resetAll", "setB", { argOp1: "_", argOp2: "value", argRelation: "Equals" }],
    ["incrementA", "resetAll", { argOp1: "_", argOp2: "_", argRelation: "Equals" }],
    ["incrementB", "resetAll", { argOp1: "_", argOp2: "_", argRelation: "Equals" }],
    ["setA", "resetAll", { argOp1: "value", argOp2: "_", argRelation: "Equals" }],
    ["setB", "resetAll", { argOp1: "value", argOp2: "_", argRelation: "Equals" }],
  ],
  idempotentOperations: ["resetAll", "setA", "setB"],
  constructiveOperations: ["incrementA", "incrementB"],
  supersedeOperations: [],
  dependentOperations: [],
};
