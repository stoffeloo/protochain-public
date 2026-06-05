// my own unsigned int type since bigint is not json-serializable directly and caused me lots of headaches
export type UInt = number & { readonly __brand: "UInt" };

export function asUInt(n: number): UInt {
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid UInt value: ${n}`);
  }
  return n as UInt;
}

export type Hex = `0x${string}`;
export type Hash = Hex;
export type Address = Hex;

export type TransactionKind = "transfer" | "deploy" | "call" | "generation";
export type CallData = { method: string; args?: any[] };

export type ArgRelation = "Equals" | "NotEquals" | string;

export type OperationArgumentRelation = {
  argOp1: string;
  argOp2: string;
  argRelation: ArgRelation;
};

export type OperationPairRule = [string, string, OperationArgumentRelation];

export type ContractMetadata = {
  hash: string;
  seqName: string;
  methods: Record<string, string[]>;
  nonCommutativeOperations: OperationPairRule[];
  idempotentOperations: string[];
  constructiveOperations: string[];
  supersedeOperations: OperationPairRule[];
  dependentOperations: OperationPairRule[];
};

export type BaseTx = {
  kind: TransactionKind;
  from: Address;
  nonce: number;
  pubkey: Hex;
};

export type TransferTx = BaseTx & {
  kind: "transfer";
  to: Address;
  value: UInt;
  data?: never;
};

// EVM-style contract creation like in Ethereum (evm -> etherium virtual machine)
export type DeployTx = BaseTx & {
  kind: "deploy";
  to?: undefined;                 // EVM-style: no 'to' on deploy   it computes address where contract will 'live' from sender+nonce
  value?: never;
  data: { code: string; metadata: ContractMetadata };
};

export type CallTx = BaseTx & {
  kind: "call";
  to: Address;
  value?: UInt;
  data: CallData;
};

export type GenerationTx = BaseTx & {
  kind: "generation";
  to: Address;
  value: UInt;
  data?: never;
};

export type CanonicalTransaction = TransferTx | DeployTx | CallTx | GenerationTx;

export type SignedTransaction = CanonicalTransaction & {
  signature: Hex;
};

export type TxKey = Hash; // txId(tx)

export type TxNode = { tx: SignedTransaction, redundant: boolean };

export type TxDepEdge = { from: TxKey; to: TxKey };

/*
  TransactionGraph is a DAG of transactions that are executed in a  block where edges represent dependencies between transactions (one transaction must be executed before the other)
  Nodes = transactions (identified by txId)
  Edges = dependency constraints (A -> B means “A must happen before B”)
*/
export type TransactionGraph = {
  // map txId -> full tx object
  txs: Record<TxKey, TxNode>;
  // dependency constraints
  edges: TxDepEdge[];
};


export interface BlockHeader {
  parentHash: Hash;
  number: number;
  timestamp: number;
  transactionRoot: Hash;
  stateRoot: Hash;
  proposer: Address; // node that proposed/created the block
}

export interface Block {
  header: BlockHeader;
  // txs can now be optained by looking at txGraph.txs so redundent
  txGraph: TransactionGraph;


  // Easy transactions are a list of smart contract calls that are commutative,
  // meaning all of them can be executed in parallel at the start of the block execution
  // they should be cheap to execute and cheap for the user ==> low gas fee
  // a part of the block is reserved for these easy transactions so that they do not have to share space with the comutative expensive transactions
  // and can be "outbid" out of the block by normal transactions that are prepared to pay higher fees.
  // easyTxs: SignedTransaction[]; 

  hash: Hash;
  logs: { contract: Address; msg: string }[]; // for logging from contract calls
}

export type Account = {
  nonce: number;
  balance: UInt;
  // storage: Record<string, unknown>;
  state: ContractState;
  code?: string;
  metadata?: ContractMetadata;
};

export interface GenesisConfig {
  alloc: Record<Address, UInt>;
}

export type MiningSpeedConfig =
  | { defaultMineSpeed: number }
  | { defaultMineSpeedInterval: { minTime: number; maxTime: number } };

export type ExecutionMode = "list" | "graph";
// export type ExecutionMode = "list" | "graph" | "parallel-graph";



// -----------------------------------------------------------------------------
// Contract execution model (semi-functional contracts)
// -----------------------------------------------------------------------------

export type BlockCtx = {
  number: number;
};

export type ContractState = Record<string, unknown>;

export type ContractExecutionEnv = {
  self: Address;
  blockCtx: BlockCtx;

  require: (cond: boolean, msg?: string) => void;
  balanceOf: (addr: Address) => UInt;
  transfer: (to: Address, amount: UInt) => void;
  call: (to: Address, data: { method: string; args: unknown[] }, value?: UInt) => unknown;
  //note;
  // call kan als er aan re-entrence wordt gedaan, de state van dit contract aanpassen
  // dus als er voor de call een getSelfState is dat na de call gebruikt wordt,
  // kan deze outdated zijn, dus beter na de call een nieuwe getSelfState doen als de state nog gebruikt moet worden


  getSelfState: () => ContractState;
  readContractState: (addr: Address) => ContractState;

  // we do not want a setSelfState since we want contracts in functional style where the new state is the return value of the method
  // setSelfState: (newState: ContractState) => void;
};

export type ContractMethodArgs = [_caller: Address, _value: UInt, ...args: unknown[]];

export type ContractMethod<S extends ContractState = ContractState> = (
  args: ContractMethodArgs,
  env: ContractExecutionEnv
) => S;

export type ContractMethodDefinition<S extends ContractState = ContractState> = {
  run: ContractMethod<S>;
};

export type ContractModule<S extends ContractState = ContractState> = {
  name: string;
  initialState: S;
  methods: Record<string, ContractMethodDefinition<S>>;
};

// -----------------------------------------------------------------------------
// graph building model
// -----------------------------------------------------------------------------

export type GlobalGraphBuildingEnvironment = {
  balances: Record<Address, UInt>;

  contracts: Record<Address, GraphContractObject>;

  //om gewone transfer transacties later toe te voegen om ook dependencies hiermee te modeleren niet enkel tussen calls
  transfer(from: Address, to: Address, amount: UInt): GlobalGraphBuildingEnvironment;

  // weet niet of dit nodig gaat zijn om andere dingen te vervangen
  metadata: {
    blockNumber: number;
  };
};

export type GraphContractObject = {
  address: Address;
  code?: string;
  name?: string;
  state: ContractState;
  methods: Record<string, GraphLiftedMethod>;
};

export type GraphLiftedMethod = (
  env: GlobalGraphBuildingEnvironment,
  args: unknown[],
  caller: Address,
  value: UInt
) => GlobalGraphBuildingEnvironment;