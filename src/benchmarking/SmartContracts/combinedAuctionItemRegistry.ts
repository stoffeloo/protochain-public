import { Address, ContractMetadata, ContractModule, UInt } from "../../core/types";
import { RetryLaterWhen, SmartContractParameterGenerator } from "../types";

type ItemId = string;
type AuctionId = string;

type Item = {
    owner: Address;
    metadata?: string;
};

type ItemRegistryState = Record<ItemId, Item>;

type Auction = {
    seller: Address;
    itemId: ItemId;
    endBlock: number;
    highestBid: number;
    highestBidder: Address | null;
    active: boolean;
};

type AuctionsState = Record<AuctionId, Auction>;

type EscrowState = Record<ItemId, AuctionId>;

type CombinedState = {
    items: ItemRegistryState;
    auctions: AuctionsState;
    escrowed: EscrowState;
    nextAuctionId: number;
};

export const CombinedAuctionItemRegistry: ContractModule<CombinedState> = {
    name: "CombinedAuctionItemRegistry",

    initialState: {
        items: {},
        auctions: {},
        escrowed: {},
        nextAuctionId: 0,
    },

    methods: {
        createItem: {
            run: ([_caller, _value, itemIdRaw, metadataRaw], env) => {
                const state = env.getSelfState() as CombinedState;

                env.require(typeof itemIdRaw === "string" && itemIdRaw.length > 0, "bad itemId");
                const itemId = itemIdRaw as ItemId;

                env.require(state.items[itemId] === undefined, "item already exists");

                const item: Item = {
                    owner: _caller as Address,
                    ...(typeof metadataRaw === "string" ? { metadata: metadataRaw } : {}),
                };

                return {
                    ...state,
                    items: {
                        ...state.items,
                        [itemId]: item,
                    },
                };
            },
        },

        transferFrom: {
            run: ([_caller, _value, fromRaw, toRaw, itemIdRaw], env) => {
                const state = env.getSelfState() as CombinedState;

                env.require(typeof fromRaw === "string" && fromRaw.startsWith("0x"), "bad from address");
                env.require(typeof toRaw === "string" && toRaw.startsWith("0x"), "bad to address");
                env.require(typeof itemIdRaw === "string" && (itemIdRaw as string).length > 0, "bad itemId");

                const from = fromRaw as Address;
                const to = toRaw as Address;
                const itemId = itemIdRaw as ItemId;

                const item = state.items[itemId];
                env.require(item !== undefined, "item missing");
                env.require(item!.owner === from, "from not owner");
                env.require(state.escrowed[itemId] === undefined, "item is on active auction");

                env.require(_caller === from, "caller must be from");

                return {
                    ...state,
                    items: {
                        ...state.items,
                        [itemId]: {
                            ...item,
                            owner: to,
                        },
                    },
                };
            },
        },

        createAuction: {
            run: ([_caller, _value, itemIdRaw, durationRaw, startingBidRaw], env) => {
                const state = env.getSelfState() as CombinedState;

                env.require(typeof itemIdRaw === "string" && itemIdRaw.length > 0, "bad itemId");
                env.require(typeof durationRaw === "number" && Number.isInteger(durationRaw) && durationRaw > -1, "bad duration"); //used to be 0 but for benchmarking simulation slight modifaction
                env.require(typeof startingBidRaw === "number" && Number.isInteger(startingBidRaw) && startingBidRaw >= 0, "bad startingBid");

                const itemId = itemIdRaw as ItemId;
                const duration = durationRaw as number;
                const startingBid = startingBidRaw as number;

                const item = state.items[itemId];
                env.require(item !== undefined, "item missing");
                env.require(item!.owner === _caller, "only owner can create auction");
                env.require(state.escrowed[itemId] === undefined, "item already escrowed");

                const auctionId = String(state.nextAuctionId);

                const auction: Auction = {
                    seller: _caller as Address,
                    itemId,
                    endBlock: env.blockCtx.number + duration,
                    highestBid: startingBid,
                    highestBidder: null,
                    active: true,
                };

                return {
                    ...state,
                    auctions: {
                        ...state.auctions,
                        [auctionId]: auction,
                    },
                    escrowed: {
                        ...state.escrowed,
                        [itemId]: auctionId,
                    },
                    nextAuctionId: state.nextAuctionId + 1,
                };
            },
        },

        placeBid: {
            run: ([_caller, valueRaw, auctionIdRaw], env) => {
                const state = env.getSelfState() as CombinedState;

                env.require(typeof auctionIdRaw === "string" && auctionIdRaw.length > 0, "bad auctionId");

                const auctionId = auctionIdRaw as AuctionId;
                const auction = state.auctions[auctionId];
                env.require(auction !== undefined, "auction missing");
                env.require(auction!.active === true, "auction inactive");
                env.require(env.blockCtx.number <= auction!.endBlock, "auction ended");

                    env.require(typeof valueRaw === "number" && Number.isInteger(valueRaw) && valueRaw >= 0, "bad bid value");
                    const bid = valueRaw as number;
                env.require(typeof bid === "number" && Number.isInteger(bid) && bid >= 0, "bad bid value");

                if (bid <= auction!.highestBid) {
                    // bid not high enough, send back the bid amount if any and do not update the auction
                    if (bid > 0) {
                            env.transfer(_caller as Address, bid as UInt);
                    }
                    return state;
                }

                //transfer previously highest bid back to previous highest bidder, if there is one
                if (auction!.highestBidder) {
                    env.transfer(auction!.highestBidder, auction!.highestBid as UInt);
                }

                const nextAuction: Auction = {
                    ...auction!,
                        highestBid: bid as number,
                    highestBidder: _caller as Address,
                };

                return {
                    ...state,
                    auctions: {
                        ...state.auctions,
                        [auctionId]: nextAuction,
                    },
                };
            },
        },

        settleAuction: {
            run: ([_caller, _value, auctionIdRaw], env) => {
                const state = env.getSelfState() as CombinedState;

                env.require(typeof auctionIdRaw === "string" && auctionIdRaw.length > 0, "bad auctionId");

                const auctionId = auctionIdRaw as AuctionId;
                const auction = state.auctions[auctionId];
                env.require(auction !== undefined, "auction missing");
                env.require(auction!.active === true, "auction inactive");
                env.require(env.blockCtx.number >= auction!.endBlock, "not ended yet");

                const itemId = auction!.itemId;
                const item = state.items[itemId];
                env.require(item !== undefined, "item missing");
                const currentItemOwner = item!.owner;
                const newOwner = auction!.highestBidder ?? currentItemOwner;

                const nextAuction: Auction = {
                    ...auction!,
                    active: false,
                };

                const nextItems = {
                    ...state.items,
                    [itemId]: {
                        ...item,
                        owner: newOwner,
                    },
                };

                const nextEscrow = { ...state.escrowed };
                delete nextEscrow[itemId];

                // transfer winning bid to seller if there is a winning bid
                if (auction!.highestBidder) {
                    env.transfer(auction!.seller, auction!.highestBid as UInt);
                }

                return {
                    ...state,
                    auctions: {
                        ...state.auctions,
                        [auctionId]: nextAuction,
                    },
                    items: nextItems,
                    escrowed: nextEscrow,
                };
            },
        },
    },
};

//hand written metadata until genration works
export const contractMetadata: ContractMetadata = {
    hash: "combined-auction-item-registry-v1",
    seqName: "CombinedAuctionItemRegistry",
    methods: {
        createItem: ["_caller", "_value", "itemId", "metadata"],
        transferFrom: ["_caller", "_value", "from", "to", "itemId"],
        createAuction: ["_caller", "_value", "itemId", "duration", "startingBid"],
        placeBid: ["_caller", "_value", "auctionId"],
        settleAuction: ["_caller", "_value", "auctionId"],
    },
    nonCommutativeOperations: [
    ],
    idempotentOperations: [], //mogelijks settleAuction
    constructiveOperations: [],
    supersedeOperations: [],
    dependentOperations: [],
};

type CombinedAuctionItemRegistryGeneratorState = {
    nextItemId: number;
    nextAuctionId: number;
    items: Record<ItemId, { owner: Address; metadata?: string; onAuction: boolean }>;
    auctions: Record<AuctionId, { itemId: ItemId; highestBid: number; highestBidder: Address | null; active: boolean; endBlock: number }>;
};

const getBlockForTransactionIndex = (transactionIndex: number, maxTxsPerBlock: number) => Math.floor(transactionIndex / maxTxsPerBlock);

export const CombinedAuctionItemRegistryParameterGenerator: SmartContractParameterGenerator<CombinedAuctionItemRegistryGeneratorState> = {
    state: {
        nextItemId: 0,
        nextAuctionId: 0,
        items: {},
        auctions: {},
    },
    suggestPossibleAccounts(methodName, accounts, kind, transactionIndex, maxTxsPerBlock) {
        if (kind === "failed") {
            return accounts;
        }

        const currentBlock = getBlockForTransactionIndex(transactionIndex, maxTxsPerBlock);

        switch (methodName) {
            case "createItem":
                return accounts;
            case "transferFrom": {
                if (accounts.length < 2) {
                    return RetryLaterWhen;
                }
                const owners = Object.values(this.state.items)
                    .filter((item) => item.onAuction === false)
                    .map((item) => item.owner);
                const uniqueOwners = Array.from(new Set(owners));
                return uniqueOwners.length > 0 ? uniqueOwners : RetryLaterWhen;
            }
            case "createAuction": {
                const owners = Object.values(this.state.items)
                    .filter((item) => item.onAuction === false)
                    .map((item) => item.owner);
                const uniqueOwners = Array.from(new Set(owners));
                return uniqueOwners.length > 0 ? uniqueOwners : RetryLaterWhen;
            }
            case "placeBid": {
                const hasActiveAuction = Object.values(this.state.auctions)
                    .some((auction) => auction.active && auction.endBlock >= currentBlock);
                return hasActiveAuction ? accounts : RetryLaterWhen;
            }
            case "settleAuction": {
                const hasSettleableAuction = Object.values(this.state.auctions)
                    .some((auction) => auction.active && auction.endBlock <= currentBlock);
                return hasSettleableAuction ? accounts : RetryLaterWhen;
            }
            default:
                return accounts;
        }
    },
    generateParameter(methodName, caller, accounts, transactionIndex, remainingTransactions, maxTxsPerBlock) {
        const currentBlock = getBlockForTransactionIndex(transactionIndex, maxTxsPerBlock);
        const lastPossibleBlock = getBlockForTransactionIndex(transactionIndex + Math.max(0, remainingTransactions - 1), maxTxsPerBlock);
        const blocksRemainingAfterCurrent = lastPossibleBlock - currentBlock;

        switch (methodName) {
            case "createItem": {
                const itemId = `item-${this.state.nextItemId++}`;
                const metadata = `metadata-${itemId}`;
                this.state.items[itemId] = { owner: caller, metadata, onAuction: false };
                return { params: [itemId, metadata] };
            }
            case "transferFrom": {
                if (accounts.length < 2) {
                    return RetryLaterWhen;
                }

                const ownedItems = Object.entries(this.state.items)
                    .filter(([, item]) => item.owner === caller && item.onAuction === false)
                    .map(([itemId]) => itemId);

                if (ownedItems.length === 0) {
                    return RetryLaterWhen;
                }

                const itemId = ownedItems[~~(Math.random() * ownedItems.length)]!;
                let to = accounts[~~(Math.random() * accounts.length)]!;
                while (to === caller) {
                    to = accounts[~~(Math.random() * accounts.length)]!;
                }
                return { params: [caller, to, itemId] };
            }
            case "createAuction": {
                const possibleItemIds = Object.entries(this.state.items)
                    .filter(([, item]) => item.owner === caller && item.onAuction === false)
                    .map(([itemId]) => itemId);

                if (possibleItemIds.length === 0) {
                    return RetryLaterWhen;
                }

                const itemId = possibleItemIds[~~(Math.random() * possibleItemIds.length)];
                const maxReachableDuration = Math.max(0, blocksRemainingAfterCurrent - 1);
                // Keep the first auction long-lived so there is always at least one
                // bid-eligible auction for remaining normal placeBid calls.
                const duration = this.state.nextAuctionId === 0
                    ? 10000
                    : (maxReachableDuration === 0
                        ? 0
                        : 1 + ~~(Math.random() * Math.min(3, maxReachableDuration)));
                const startingBid = ~~(Math.random() * 11); // random starting bid between 0 and 10
                const auctionId = String(this.state.nextAuctionId++);
                this.state.items[itemId!]!.onAuction = true;
                this.state.auctions[auctionId] = {
                    itemId: itemId!,
                    highestBid: startingBid,
                    highestBidder: null,
                    active: true,
                    endBlock: currentBlock + duration,
                };

                return { params: [itemId, duration, startingBid] };
            }
            case "placeBid": {
                const possibleAuctionIds = Object.entries(this.state.auctions)
                    .filter(([, auction]) => auction.active && auction.endBlock >= currentBlock)
                    .map(([auctionId]) => auctionId);

                if (possibleAuctionIds.length === 0) {
                    return RetryLaterWhen;
                }

                const auctionId = possibleAuctionIds[~~(Math.random() * possibleAuctionIds.length)]!;
                const lowestBid = this.state.auctions[auctionId]!.highestBid;
                const goodBid = lowestBid + 1 + ~~(Math.random() * 10);
                const badBid = Math.max(0, lowestBid - 1 - ~~(Math.random() * 10));
                //intresting to have "bad" bids because they will create transactions that can be marked as redundant
                //not sure because they should be marked as supersedeOperations anyways I think
                const bid = Math.random() < 0.6 ? goodBid : badBid; // 60% chance to place a good bid
                this.state.auctions[auctionId]!.highestBid = bid;
                this.state.auctions[auctionId]!.highestBidder = caller;
                return { params: [auctionId], transferValue: bid };
            }
            case "settleAuction": {
                const possibleAuctionIds = Object.entries(this.state.auctions)
                    .filter(([, auction]) => auction.active && auction.endBlock <= currentBlock)
                    .map(([auctionId]) => auctionId);

                if (possibleAuctionIds.length === 0) {
                    return RetryLaterWhen;
                }

                const auctionId = possibleAuctionIds[~~(Math.random() * possibleAuctionIds.length)]!;
                this.state.auctions[auctionId]!.active = false; 
                
                // some stuff to keep the state synced
                const settledAuction = this.state.auctions[auctionId]!;
                const itemId = settledAuction.itemId;
                const currentOwner = this.state.items[itemId]!.owner;
                this.state.items[itemId]!.owner = settledAuction.highestBidder ?? currentOwner;
                this.state.items[itemId]!.onAuction = false;


                return { params: [auctionId] };

            }
            default:
                return { params: [] };
        }
    },
    generateFailedParameters(methodName, caller, accounts, transactionIndex, maxTxsPerBlock) {
        switch (methodName) {
            case "createItem": {
                return { params: ["", "metadata-invalid"] };
            }
            case "transferFrom": {
                const itemIds = Object.keys(this.state.items);
                if (itemIds.length === 0) {
                    return { params: [caller, caller, "nonExistingItem"] };
                }

                const itemId = itemIds[~~(Math.random() * itemIds.length)]!;
                return { params: ["not-an-address", caller, itemId] };
            }
            case "createAuction": {
                const possibleItemIds = Object.entries(this.state.items)
                    .filter(([, item]) => item.owner !== caller || item.onAuction)
                    .map(([itemId]) => itemId);

                if (possibleItemIds.length > 0) {
                    const itemId = possibleItemIds[~~(Math.random() * possibleItemIds.length)]!;
                    return { params: [itemId, 10, 0] };
                }

                return { params: ["nonExistingItem", 10, 0] };
            }
            case "placeBid": {
                return { params: ["nonExistingAuction"], transferValue: 0 };
            }
            case "settleAuction": {
                const currentBlock = getBlockForTransactionIndex(transactionIndex, maxTxsPerBlock);
                const tooEarlyAuctionIds = Object.entries(this.state.auctions)
                    .filter(([, auction]) => auction.active && auction.endBlock >= currentBlock)
                    .map(([auctionId]) => auctionId);

                if (tooEarlyAuctionIds.length > 0) {
                    const auctionId = tooEarlyAuctionIds[~~(Math.random() * tooEarlyAuctionIds.length)]!;
                    return { params: [auctionId] };
                }

                return { params: ["nonExistingAuction"] };
            }
            default:
                return { params: [] };
        }
    },
};