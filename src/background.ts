import type { Identifier } from './id';
import { OBSERVABLE_EVENT, RPC_EVENT_NAME, RPC_RESPONSE_EVENT_NAME, SUBSCRIBABLE_OBSERVABLE, UNSUBSCRIBE_OBSERVABLE } from './const';
import type { RpcRequest, RpcResponse, RpcService, SubjectLike, RpcObservableUpdateMessage, RpcObservableSubscribeMessage } from './types';

export class BackgroundRPC {
    private services: Record<string, RpcService> = {};

    constructor() {
        chrome.runtime.onMessage.addListener((msg: RpcRequest & { type?: string }, sender) => {
            if (msg.type !== RPC_EVENT_NAME) return;
            const senderId = sender.tab!.id!;
            const sendResponse = (response: RpcResponse) => {
                chrome.tabs.sendMessage(senderId, {
                    ...response,
                    type: RPC_RESPONSE_EVENT_NAME
                });
            };

            const { id, method, args, service } = msg;
            const serviceInstance = this.services[service];

            if (!serviceInstance) {
                const resp: RpcResponse = {
                    id,
                    error: { message: `Unknown service: ${service}` },
                    service,
                    method,
                };
                sendResponse(resp);
                return true;
            }

            if (!(method in serviceInstance)) {
                const resp: RpcResponse = {
                    id,
                    error: { message: `Unknown method: ${method}` },
                    service,
                    method,
                };
                sendResponse(resp);
                return true;
            }

            Promise.resolve()
                .then(() => serviceInstance[method](...args))
                .then((result) => sendResponse({
                    id,
                    result,
                    service,
                    method
                }))
                .catch((err) => sendResponse({
                    id,
                    error: {
                        message: err.message,
                        stack: err.stack,
                        name: err.name
                    },
                    service,
                    method
                }));

            return true; // 异步 sendResponse
        });
    }

    register<T>(service: Identifier<T>, serviceInstance: T) {
        this.services[service.key] = serviceInstance as unknown as RpcService;
    }
}

export class RemoteSubject<T> implements SubjectLike<T> {
    private completed = false;

    private get _finalKey() {
        return `${this.identifier.key}-${this._key}`;
    }

    private senders = new Set<number>();

    constructor(
        private identifier: Identifier<T>,
        private _key: string,
        private initialValue: T,
    ) {
        // 初始化时立即广播一次
        chrome.runtime.onMessage.addListener((msg: RpcObservableSubscribeMessage, sender) => {
            const senderId = sender.tab!.id!;
            if (!senderId) return;

            if (msg.type === SUBSCRIBABLE_OBSERVABLE) {
                const { key } = msg;
                if (key === this._finalKey) {
                    this.senders.add(senderId);
                    chrome.tabs.sendMessage(senderId, {
                        operation: 'next',
                        key: this._finalKey,
                        value: this.initialValue,
                    });
                }
            }

            if (msg.type === UNSUBSCRIBE_OBSERVABLE) {
                const { key } = msg;
                if (key === this._finalKey) {
                    this.senders.delete(senderId);
                }
            }
        });

        chrome.tabs.onRemoved.addListener((tabId) => {
            this.senders.delete(tabId);
        });
    }

    private _sendMessage(message: RpcObservableUpdateMessage<any>) {
        chrome.runtime.sendMessage(message);
        this.senders.forEach(senderId => {
            chrome.tabs.sendMessage(senderId, message);
        });
    }

    next(value: T): void {
        if (this.completed) return;
        this._sendMessage({
            operation: 'next',
            key: this._finalKey,
            value,
            type: OBSERVABLE_EVENT
        });
    }

    complete(): void {
        if (this.completed) return;
        this.completed = true;
        this._sendMessage({
            operation: 'complete',
            key: this._finalKey,
            type: OBSERVABLE_EVENT
        });
    }

    subscribe(): () => void {
        throw new Error('RemoteSubject should not be subscribed locally.');
    }
}
