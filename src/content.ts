import { BaseObservable, RPCClient } from './client';
import { OBSERVABLE_EVENT, RPC_EVENT_NAME, RPC_RESPONSE_EVENT_NAME, SUBSCRIBABLE_OBSERVABLE, UNSUBSCRIBE_OBSERVABLE } from './const';
import { Disposable } from './disposable';
import { Identifier } from './id';
import type { IMessageAdapter, RpcRequest, RpcResponse, } from './types';

const WEB_TO_BACKGROUND = [RPC_EVENT_NAME, SUBSCRIBABLE_OBSERVABLE, UNSUBSCRIBE_OBSERVABLE]
const BACKGROUND_TO_WEB = [RPC_RESPONSE_EVENT_NAME, OBSERVABLE_EVENT]

export class ContentRPC extends Disposable {
    constructor() {
        super();
        WEB_TO_BACKGROUND.forEach(eventName => {
            const handler = (event: any) => {
                chrome.runtime.sendMessage({ ...event.detail, type: eventName });
            }
            window.addEventListener(eventName, handler);

            this.disposeWithMe(() => {
                window.removeEventListener(eventName, handler);
            });
        });

        const handler = (msg: { type: string } & (RpcRequest | RpcResponse)) => {
            if (!BACKGROUND_TO_WEB.includes(msg.type)) return;
            const { type, ...detail } = msg
            window.dispatchEvent(new CustomEvent(type, { detail }));
        }
        chrome.runtime.onMessage.addListener(handler);

        this.disposeWithMe(() => {
            chrome.runtime.onMessage.removeListener(handler);
        });
    }
}


export const contentMessageAdapter: IMessageAdapter = {
    onMessage<T>(type: string, callback: (message: T) => void) {
        const handler = (msg: { type: string } & T) => {
            if (msg.type === type) {
                callback(msg);
            }
        }

        chrome.runtime.onMessage.addListener(handler);
        return () => {
            chrome.runtime.onMessage.removeListener(handler);
        }
    },
    sendMessage<T>(type: string, message: T): void {
        chrome.runtime.sendMessage({ ...message, type });
    },
};

export class ContentRPCClient extends RPCClient {
    constructor() {
        super(contentMessageAdapter);
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

