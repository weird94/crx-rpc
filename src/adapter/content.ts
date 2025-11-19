import { createRuntimeMessageChannel } from '@webext-core/messaging';
import { BaseObservable, RPCClient } from '../client';
import { OBSERVABLE_EVENT, RPC_EVENT_NAME, RPC_RESPONSE_EVENT_NAME, SUBSCRIBABLE_OBSERVABLE, UNSUBSCRIBE_OBSERVABLE } from '../const';
import { Disposable } from '../disposable';
import { Identifier } from '../id';
import type { IMessageAdapter, RpcRequest, RpcResponse, RpcService } from '../types';

const WEB_TO_BACKGROUND = [RPC_EVENT_NAME, SUBSCRIBABLE_OBSERVABLE, UNSUBSCRIBE_OBSERVABLE];
const BACKGROUND_TO_WEB = [RPC_RESPONSE_EVENT_NAME, OBSERVABLE_EVENT];

const runtimeChannel = createRuntimeMessageChannel<any>();

function getRuntimeId(): string | undefined {
    const browserNs = (globalThis as any)?.browser;
    if (browserNs?.runtime?.id) {
        return browserNs.runtime.id;
    }
    const chromeNs = (globalThis as any)?.chrome;
    if (chromeNs?.runtime?.id) {
        return chromeNs.runtime.id;
    }
    return undefined;
}

export class ContentRPC extends Disposable {
    constructor() {
        super();
        WEB_TO_BACKGROUND.forEach(eventName => {
            const handler = (event: any) => {
                runtimeChannel.sendMessage({ ...event.detail, type: eventName }).catch((error) => {
                    console.warn('Failed to forward RPC event from web to background', eventName, error);
                });
            };
            window.addEventListener(eventName, handler);

            this.disposeWithMe(() => {
                window.removeEventListener(eventName, handler);
            });
        });

        const handler = (msg: { type?: string } & (RpcRequest | RpcResponse)) => {
            if (!msg.type || !BACKGROUND_TO_WEB.includes(msg.type)) return;
            const { type, ...detail } = msg;
            window.dispatchEvent(new CustomEvent(type, { detail }));
        };
        const dispose = runtimeChannel.onMessage(handler);

        this.disposeWithMe(dispose);
    }
}

export class ContentRPCHost extends Disposable {
    private services: Record<string, RpcService> = {};

    private runtimeId = getRuntimeId();

    constructor(private log: boolean = false) {
        super();

        const handler = (msg: RpcRequest & { type?: string }, sender: chrome.runtime.MessageSender) => {
            if (msg.type !== RPC_EVENT_NAME) return;
            if (this.runtimeId && sender.id && sender.id !== this.runtimeId) return;

            const { id, service, method, args } = msg;
            const serviceInstance = this.services[service];

            const sendResponse = (response: RpcResponse) => {
                runtimeChannel.sendMessage({
                    ...response,
                    type: RPC_RESPONSE_EVENT_NAME,
                }).catch((error) => {
                    console.warn('Failed to send RPC response from content to background', response, error);
                });
            };

            if (this.log) {
                console.log(
                    `%c RPC %c Call (tab): %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
                    'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
                    'color: #6b7280; font-weight: 500;',
                    'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                    'color: #6b7280; font-weight: 500;',
                    'background: #dc2626; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                    'color: #6b7280; font-weight: 500;',
                    'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                    'color: #6b7280; font-weight: 500;',
                    {
                        args,
                        timestamp: new Date().toISOString(),
                    }
                );
            }

            if (!serviceInstance) {
                if (this.log) {
                    console.warn(
                        `%c RPC %c Unknown service (tab): %c ${service} %c [%c ${id} %c]`,
                        'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
                        'color: #d97706; font-weight: bold;',
                        'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                        'color: #6b7280; font-weight: 500;',
                        'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                        'color: #6b7280; font-weight: 500;',
                        {
                            timestamp: new Date().toISOString(),
                        }
                    );
                }
                sendResponse({
                    id,
                    error: { message: `Unknown service: ${service}` },
                    service,
                    method,
                });
                return;
            }

            if (!(method in serviceInstance)) {
                if (this.log) {
                    console.warn(
                        `%c RPC %c Unknown method (tab): %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
                        'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
                        'color: #d97706; font-weight: bold;',
                        'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                        'color: #6b7280; font-weight: 500;',
                        'background: #dc2626; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                        'color: #6b7280; font-weight: 500;',
                        'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                        'color: #6b7280; font-weight: 500;',
                        {
                            timestamp: new Date().toISOString(),
                        }
                    );
                }
                sendResponse({
                    id,
                    error: { message: `Unknown method: ${method}` },
                    service,
                    method,
                });
                return;
            }

            Promise.resolve()
                .then(() => (serviceInstance as RpcService)[method](...args))
                .then((result) => {
                    if (this.log) {
                        console.log(
                            `%c RPC %c Success (tab): %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
                            'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
                            'color: #16a34a; font-weight: bold;',
                            'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                            'color: #6b7280; font-weight: 500;',
                            'background: #dc2626; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                            'color: #6b7280; font-weight: 500;',
                            'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                            'color: #6b7280; font-weight: 500;',
                            {
                                result,
                                timestamp: new Date().toISOString(),
                            }
                        );
                    }
                    sendResponse({
                        id,
                        result,
                        service,
                        method,
                    });
                })
                .catch((err) => {
                    if (this.log) {
                        console.error(
                            `%c RPC %c Error (tab): %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
                            'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
                            'color: #dc2626; font-weight: bold;',
                            'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                            'color: #6b7280; font-weight: 500;',
                            'background: #dc2626; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                            'color: #6b7280; font-weight: 500;',
                            'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                            'color: #6b7280; font-weight: 500;',
                            {
                                error: err?.message,
                                timestamp: new Date().toISOString(),
                            }
                        );
                    }
                    sendResponse({
                        id,
                        error: {
                            message: err?.message ?? 'Unknown error',
                            stack: err?.stack,
                            name: err?.name,
                        },
                        service,
                        method,
                    });
                });
        };

        const dispose = runtimeChannel.onMessage(handler);
        this.disposeWithMe(dispose);
    }

    register<T>(service: Identifier<T>, serviceInstance: T) {
        this.services[service.key] = serviceInstance as unknown as RpcService;
    }
}


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

