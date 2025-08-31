import { BaseObservable, RPCClient } from "./client";
import { Identifier } from "./id";
import { IMessageAdapter } from "./types";

export const webMessageAdapter: IMessageAdapter = {
    onMessage<T>(type: string, callback: (message: T) => void) {
        const handler = (event: any) => {
            callback(event.detail);
        }
        window.addEventListener(type, handler);
        return () => {
            window.removeEventListener(type, handler);
        };
    },
    sendMessage<T>(type: string, message: T): void {
        window.dispatchEvent(new CustomEvent(type, { detail: message }));
    },
};

export class WebRPCClient extends RPCClient {
    constructor() {
        super(webMessageAdapter);
    }
}

export class WebObservable<T> extends BaseObservable<T> {
    constructor(
        identifier: Identifier<T>,
        key: string,
        callback: (value: T) => void,
    ) {
        super(identifier, key, callback, webMessageAdapter);
    }
}