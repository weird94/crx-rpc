import { BaseObservable, RPCClient } from '../client';
import { Identifier } from '../id';
import type { IMessageAdapter } from '../types';

/**
 * Message adapter for extension pages (popup, options, sidepanel, etc.)
 * Uses chrome.runtime.sendMessage for communication with background script
 */
export const extPageMessageAdapter: IMessageAdapter = {
    onMessage<T>(type: string, callback: (message: T) => void) {
        const handler = (msg: { type?: string } & T) => {
            if (msg.type === type) {
                callback(msg);
            }
        };

        chrome.runtime.onMessage.addListener(handler);
        return () => {
            chrome.runtime.onMessage.removeListener(handler);
        };
    },
    sendMessage<T>(type: string, message: T): void {
        chrome.runtime.sendMessage({ ...message, type }).catch((error) => {
            console.warn('Failed to send RPC message from ext-page to background', type, error);
        });
    },
};

/**
 * RPC Client for extension pages (popup, options, sidepanel, etc.)
 * Enables extension pages to call background services directly
 * 
 * @example
 * ```typescript
 * // In popup.ts
 * import { ExtPageRPCClient } from 'crx-rpc';
 * import { IMathService } from './services/math';
 * 
 * const client = new ExtPageRPCClient();
 * const mathService = client.createWebRPCService(IMathService);
 * 
 * const result = await mathService.add(5, 3);
 * console.log('Result:', result);
 * ```
 */
export class ExtPageRPCClient extends RPCClient {
    constructor() {
        super(extPageMessageAdapter);
    }
}

/**
 * Observable for extension pages to subscribe to background RemoteSubjects
 * 
 * @example
 * ```typescript
 * // In popup.ts
 * import { ExtPageObservable } from 'crx-rpc';
 * import { ICounterObservable } from './services/counter';
 * 
 * const observable = new ExtPageObservable(
 *     ICounterObservable,
 *     'main',
 *     (value) => {
 *         console.log('Counter update:', value);
 *     }
 * );
 * 
 * // Cleanup when popup closes
 * window.addEventListener('unload', () => {
 *     observable.dispose();
 * });
 * ```
 */
export class ExtPageObservable<T> extends BaseObservable<T> {
    constructor(
        identifier: Identifier<T>,
        key: string,
        callback: (value: T) => void,
    ) {
        super(identifier, key, callback, extPageMessageAdapter);
    }
}
