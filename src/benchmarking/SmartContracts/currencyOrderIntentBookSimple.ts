import { Address, ContractMetadata, ContractMethodDefinition, ContractModule } from "../../core/types";

type OrderSlot = "btcBuy" | "btcSell" | "ethBuy" | "ethSell";

type Order = {
  price: number;
  quantity: number;
};

type AccountOrders = Partial<Record<OrderSlot, Order>>;

type CurrencyOrderIntentBookSimpleState = {
  ordersByAccount: Record<Address, AccountOrders>;
};

const getAccountOrders = (state: CurrencyOrderIntentBookSimpleState, caller: Address): AccountOrders => {
  return state.ordersByAccount[caller] ?? {};
};

const writeAccountOrders = (
  state: CurrencyOrderIntentBookSimpleState,
  caller: Address,
  next: AccountOrders,
): CurrencyOrderIntentBookSimpleState => {
  const nextHasAny = Object.keys(next).length > 0;
  if (!nextHasAny) {
    const { [caller]: _removed, ...rest } = state.ordersByAccount;
    return { ...state, ordersByAccount: rest };
  }

  return {
    ...state,
    ordersByAccount: {
      ...state.ordersByAccount,
      [caller]: next,
    },
  };
};

function createOrReplaceOnSlot(slot: OrderSlot): ContractMethodDefinition<CurrencyOrderIntentBookSimpleState> {
  return {
    run: (args, env) => {
      const [_caller, _value, priceRaw, quantityRaw] = args;
      const state = env.getSelfState() as CurrencyOrderIntentBookSimpleState;

      env.require(typeof priceRaw === "number" && Number.isInteger(priceRaw) && priceRaw >= 0, "bad price");
      env.require(typeof quantityRaw === "number" && Number.isInteger(quantityRaw) && quantityRaw > 0, "bad quantity");

      const caller = _caller as Address;
      const price = priceRaw as number;
      const quantity = quantityRaw as number;
      const account = getAccountOrders(state, caller);
      const current = account[slot];

      if (current && current.price === price && current.quantity === quantity) return state;

      const next: AccountOrders = { ...account, [slot]: { price, quantity } };
      return writeAccountOrders(state, caller, next);
    },
  };
}

function cancelSlot(slot: OrderSlot): ContractMethodDefinition<CurrencyOrderIntentBookSimpleState> {
  return {
    run: (args, env) => {
      const [_caller, _value] = args;
      const state = env.getSelfState() as CurrencyOrderIntentBookSimpleState;
      const caller = _caller as Address;
      const account = { ...getAccountOrders(state, caller) };

      if (!account[slot]) return state;

      delete account[slot];
      return writeAccountOrders(state, caller, account);
    },
  };
}

function modifyPriceOnSlot(slot: OrderSlot): ContractMethodDefinition<CurrencyOrderIntentBookSimpleState> {
  return {
    run: (args, env) => {
      const [_caller, _value, newPriceRaw] = args;
      const state = env.getSelfState() as CurrencyOrderIntentBookSimpleState;
      env.require(typeof newPriceRaw === "number" && Number.isInteger(newPriceRaw) && newPriceRaw >= 0, "bad newPrice");

      const caller = _caller as Address;
      const newPrice = newPriceRaw as number;
      const account = { ...getAccountOrders(state, caller) };
      const current = account[slot];

      if (!current || current.price === newPrice) return state;

      account[slot] = { ...current, price: newPrice };
      return writeAccountOrders(state, caller, account);
    },
  };
}

function modifyQuantityOnSlot(slot: OrderSlot): ContractMethodDefinition<CurrencyOrderIntentBookSimpleState> {
  return {
    run: (args, env) => {
      const [_caller, _value, newQuantityRaw] = args;
      const state = env.getSelfState() as CurrencyOrderIntentBookSimpleState;
      env.require(
        typeof newQuantityRaw === "number" && Number.isInteger(newQuantityRaw) && newQuantityRaw >= 0,
        "bad newQuantity",
      );

      const caller = _caller as Address;
      const newQuantity = newQuantityRaw as number;
      const account = { ...getAccountOrders(state, caller) };
      const current = account[slot];

      if (!current) return state;
      if (current.quantity === newQuantity) return state;

      if (newQuantity === 0) {
        delete account[slot];
      } else {
        account[slot] = { ...current, quantity: newQuantity };
      }

      return writeAccountOrders(state, caller, account);
    },
  };
}

export const CurrencyOrderIntentBookSimpleSmartContract: ContractModule<CurrencyOrderIntentBookSimpleState> = {
  name: "CurrencyOrderIntentBookSimpleSmartContract",

  initialState: {
    ordersByAccount: {},
  },

  methods: {
    createOrReplaceBtcBuyOrder: createOrReplaceOnSlot("btcBuy"),
    createOrReplaceBtcSellOrder: createOrReplaceOnSlot("btcSell"),
    createOrReplaceEthBuyOrder: createOrReplaceOnSlot("ethBuy"),
    createOrReplaceEthSellOrder: createOrReplaceOnSlot("ethSell"),

    cancelAllMyOrders: {
      run: (args, env) => {
        const [_caller, _value] = args;
        const state = env.getSelfState() as CurrencyOrderIntentBookSimpleState;
        const caller = _caller as Address;
        const account = getAccountOrders(state, caller);

        if (Object.keys(account).length === 0) return state;
        const { [caller]: _removed, ...rest } = state.ordersByAccount;
        return { ...state, ordersByAccount: rest };
      },
    },

    cancelMyBtcBuyOrder: cancelSlot("btcBuy"),
    cancelMyBtcSellOrder: cancelSlot("btcSell"),
    cancelMyEthBuyOrder: cancelSlot("ethBuy"),
    cancelMyEthSellOrder: cancelSlot("ethSell"),

    modifyMyBtcBuyOrderPrice: modifyPriceOnSlot("btcBuy"),
    modifyMyBtcSellOrderPrice: modifyPriceOnSlot("btcSell"),
    modifyMyEthBuyOrderPrice: modifyPriceOnSlot("ethBuy"),
    modifyMyEthSellOrderPrice: modifyPriceOnSlot("ethSell"),

    modifyMyBtcBuyOrderQuantity: modifyQuantityOnSlot("btcBuy"),
    modifyMyBtcSellOrderQuantity: modifyQuantityOnSlot("btcSell"),
    modifyMyEthBuyOrderQuantity: modifyQuantityOnSlot("ethBuy"),
    modifyMyEthSellOrderQuantity: modifyQuantityOnSlot("ethSell"),
  },
};

const methods: Record<string, string[]> = {
  createOrReplaceBtcBuyOrder: ["_caller", "_value", "price", "quantity"],
  createOrReplaceBtcSellOrder: ["_caller", "_value", "price", "quantity"],
  createOrReplaceEthBuyOrder: ["_caller", "_value", "price", "quantity"],
  createOrReplaceEthSellOrder: ["_caller", "_value", "price", "quantity"],

  cancelAllMyOrders: ["_caller", "_value"],
  cancelMyBtcBuyOrder: ["_caller", "_value"],
  cancelMyBtcSellOrder: ["_caller", "_value"],
  cancelMyEthBuyOrder: ["_caller", "_value"],
  cancelMyEthSellOrder: ["_caller", "_value"],

  modifyMyBtcBuyOrderPrice: ["_caller", "_value", "newPrice"],
  modifyMyBtcSellOrderPrice: ["_caller", "_value", "newPrice"],
  modifyMyEthBuyOrderPrice: ["_caller", "_value", "newPrice"],
  modifyMyEthSellOrderPrice: ["_caller", "_value", "newPrice"],

  modifyMyBtcBuyOrderQuantity: ["_caller", "_value", "newQuantity"],
  modifyMyBtcSellOrderQuantity: ["_caller", "_value", "newQuantity"],
  modifyMyEthBuyOrderQuantity: ["_caller", "_value", "newQuantity"],
  modifyMyEthSellOrderQuantity: ["_caller", "_value", "newQuantity"],
};


//only generated the metadata for the ...slot() functions that the methods use,
//since they only confict/supersede with each other and cancelAllMyOrders, but not with other methods,
//we can use them to generate the entire metadata
const slotMethodNames: Record<
  OrderSlot,
  {
    createOrReplace: string;
    cancel: string;
    modifyPrice: string;
    modifyQuantity: string;
  }
> = {
  btcBuy: {
    createOrReplace: "createOrReplaceBtcBuyOrder",
    cancel: "cancelMyBtcBuyOrder",
    modifyPrice: "modifyMyBtcBuyOrderPrice",
    modifyQuantity: "modifyMyBtcBuyOrderQuantity",
  },
  btcSell: {
    createOrReplace: "createOrReplaceBtcSellOrder",
    cancel: "cancelMyBtcSellOrder",
    modifyPrice: "modifyMyBtcSellOrderPrice",
    modifyQuantity: "modifyMyBtcSellOrderQuantity",
  },
  ethBuy: {
    createOrReplace: "createOrReplaceEthBuyOrder",
    cancel: "cancelMyEthBuyOrder",
    modifyPrice: "modifyMyEthBuyOrderPrice",
    modifyQuantity: "modifyMyEthBuyOrderQuantity",
  },
  ethSell: {
    createOrReplace: "createOrReplaceEthSellOrder",
    cancel: "cancelMyEthSellOrder",
    modifyPrice: "modifyMyEthSellOrderPrice",
    modifyQuantity: "modifyMyEthSellOrderQuantity",
  },
};

const sameCaller = {
  argOp1: "_caller",
  argOp2: "_caller",
  argRelation: "Equals",
} as const;

const nonCommutativeOperations: ContractMetadata["nonCommutativeOperations"] = [
  ...Object.values(slotMethodNames).flatMap((m) => [
    // createOrReplace conflicts
    [m.createOrReplace, m.modifyPrice, sameCaller],
    [m.modifyPrice, m.createOrReplace, sameCaller],
    [m.createOrReplace, m.modifyQuantity, sameCaller],
    [m.modifyQuantity, m.createOrReplace, sameCaller],
    [m.createOrReplace, m.cancel, sameCaller],
    [m.cancel, m.createOrReplace, sameCaller],

    // cancel conflicts
    [m.cancel, m.modifyPrice, sameCaller],
    [m.modifyPrice, m.cancel, sameCaller],
    [m.cancel, m.modifyQuantity, sameCaller],
    [m.modifyQuantity, m.cancel, sameCaller],

    // modifyPrice conflicts (idempotent excluded via NotEquals)
    [m.modifyPrice, m.modifyPrice, { argOp1: "_caller", argOp2: "_caller", argRelation: "Equals" }],
    [m.modifyPrice, m.modifyPrice, { argOp1: "newPrice", argOp2: "newPrice", argRelation: "NotEquals" }],

    // modifyQuantity conflicts (idempotent excluded via NotEquals)
    [m.modifyQuantity, m.modifyQuantity, { argOp1: "_caller", argOp2: "_caller", argRelation: "Equals" }],
    [m.modifyQuantity, m.modifyQuantity, {
      argOp1: "newQuantity",
      argOp2: "newQuantity",
      argRelation: "NotEquals",
    }],

    // createOrReplace self-conflict only when args differ (idempotent excluded)
    [m.createOrReplace, m.createOrReplace, { argOp1: "_caller", argOp2: "_caller", argRelation: "Equals" }],
    [m.createOrReplace, m.createOrReplace, { argOp1: "price", argOp2: "price", argRelation: "NotEquals" }],
    [m.createOrReplace, m.createOrReplace, { argOp1: "quantity", argOp2: "quantity", argRelation: "NotEquals" }],
  ] as ContractMetadata["nonCommutativeOperations"]),

  // cancelAll can interfere with any mutation of this caller's slots
  ...Object.values(slotMethodNames).flatMap((m) => [
    ["cancelAllMyOrders", m.createOrReplace, sameCaller],
    [m.createOrReplace, "cancelAllMyOrders", sameCaller],
    ["cancelAllMyOrders", m.cancel, sameCaller],
    [m.cancel, "cancelAllMyOrders", sameCaller],
    ["cancelAllMyOrders", m.modifyPrice, sameCaller],
    [m.modifyPrice, "cancelAllMyOrders", sameCaller],
    ["cancelAllMyOrders", m.modifyQuantity, sameCaller],
    [m.modifyQuantity, "cancelAllMyOrders", sameCaller],
  ] as ContractMetadata["nonCommutativeOperations"]),
];

const idempotentOperations = [
  "cancelAllMyOrders",
  "cancelMyBtcBuyOrder",
  "cancelMyBtcSellOrder",
  "cancelMyEthBuyOrder",
  "cancelMyEthSellOrder",
  "modifyMyBtcBuyOrderPrice",
  "modifyMyBtcSellOrderPrice",
  "modifyMyEthBuyOrderPrice",
  "modifyMyEthSellOrderPrice",
  "modifyMyBtcBuyOrderQuantity",
  "modifyMyBtcSellOrderQuantity",
  "modifyMyEthBuyOrderQuantity",
  "modifyMyEthSellOrderQuantity",
  "createOrReplaceBtcBuyOrder",
  "createOrReplaceBtcSellOrder",
  "createOrReplaceEthBuyOrder",
  "createOrReplaceEthSellOrder",
];

const supersedeOperations: ContractMetadata["supersedeOperations"] = [
  ...Object.values(slotMethodNames).flatMap((m) => [
    // createOrReplace subsumes same-slot operations for same caller
    [m.createOrReplace, m.createOrReplace, sameCaller],
    [m.createOrReplace, m.modifyPrice, sameCaller],
    [m.createOrReplace, m.modifyQuantity, sameCaller],
    [m.createOrReplace, m.cancel, sameCaller],

    // cancel subsumes same-slot operations for same caller
    [m.cancel, m.createOrReplace, sameCaller],
    [m.cancel, m.modifyPrice, sameCaller],
    [m.cancel, m.modifyQuantity, sameCaller],
    [m.cancel, m.cancel, sameCaller],

    // idempotent subsume rules for modifies
    [m.modifyPrice, m.modifyPrice, sameCaller],
    [m.modifyQuantity, m.modifyQuantity, sameCaller],

    // cancelAll subsumes all per-slot operations for same caller
    ["cancelAllMyOrders", m.createOrReplace, sameCaller],
    ["cancelAllMyOrders", m.cancel, sameCaller],
    ["cancelAllMyOrders", m.modifyPrice, sameCaller],
    ["cancelAllMyOrders", m.modifyQuantity, sameCaller],
  ] as ContractMetadata["supersedeOperations"]),
];


export const contractMetadata: ContractMetadata = {
  hash: "currency-order-intent-book-simple-v1",
  seqName: "CurrencyOrderIntentBookSimple",
  methods,
  nonCommutativeOperations,
  idempotentOperations,
  constructiveOperations: [],
  supersedeOperations,
  dependentOperations: [],
};
