import { Address } from "../core/types";
import { RecipientPattern } from "./types";

export function pickRecipient(senderIndex: number, addresses: Address[], pattern: RecipientPattern, txIndexGlobal: number): Address {
    const n = addresses.length;
    if (n === 1) return addresses[0]!;

    switch (pattern) {
        case "singleSink": {
            return addresses[senderIndex === 0 ? 1 : 0]!;
        }

        case "random": {
            //need a deterministic "random" pattern to be able to compare across runs, so we use the global tx index as a seed
            const recipientIndex = (txIndexGlobal * 997) % n; // there is problably a neater way to do this, todo: fiix
            //avoid sending to self
            return addresses[recipientIndex === senderIndex ? (recipientIndex + 1) % n : recipientIndex]!;
        }

        case "roundRobin":
        default: {
            const recipientIndex = (senderIndex + 1 + (txIndexGlobal % (n - 1))) % n;
            return addresses[recipientIndex === senderIndex ? (recipientIndex + 1) % n : recipientIndex]!;
        }
    }
}