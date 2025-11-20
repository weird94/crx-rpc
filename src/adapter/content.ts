import { createRuntimeMessageChannel } from "@webext-core/messaging";
import { BaseObservable, RPCClient } from "../client";
import { IMessageAdapter } from "../types";
import { Identifier } from "../id";

export const runtimeChannel = createRuntimeMessageChannel<any>();

export const contentMessageAdapter: IMessageAdapter = {
    onMessage<T>(type: string, callback: (message: T) => void) {
        const handler = (msg: { type?: string } & T) => {
            if (msg.type === type) {
                callback(msg);
            }
        };

        return runtimeChannel.onMessage(handler);
    },
    sendMessage<T>(type: string, message: T): void {
        runtimeChannel.sendMessage({ ...message, type }).catch((error) => {
            console.warn('Failed to send RPC message from content to background', type, error);
        });
    },
};

export class ContentRPCClient extends RPCClient {
    constructor() {
        super(contentMessageAdapter, 'content');
    }
}

export class ContentObservable<T> extends BaseObservable<T> {
    constructor(
        identifier: Identifier<T>,
        key: string,
        callback: (value: T) => void,
    ) {
        super(identifier, key, callback, contentMessageAdapter);
    }
}