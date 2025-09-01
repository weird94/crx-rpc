import type { Identifier } from './id';
import { OBSERVABLE_EVENT, RPC_EVENT_NAME, RPC_RESPONSE_EVENT_NAME, SUBSCRIBABLE_OBSERVABLE, UNSUBSCRIBE_OBSERVABLE } from './const';
import type { RpcRequest, RpcResponse, RpcService, SubjectLike, RpcObservableUpdateMessage, RpcObservableSubscribeMessage } from './types';
import { Disposable } from './disposable';

export class BackgroundRPC extends Disposable {
    private services: Record<string, RpcService> = {};

    constructor() {
        super();
        const handler = ((msg: RpcRequest & { type?: string }, sender: chrome.runtime.MessageSender) => {
            if (msg.type !== RPC_EVENT_NAME) return;
            const senderId = sender.tab?.id;
            if (!senderId) {
                console.warn('Received RPC request from unknown sender, ignoring.', msg);
                return;
            }
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

        chrome.runtime.onMessage.addListener(handler);
        this.disposeWithMe(() => {
            chrome.runtime.onMessage.removeListener(handler);
        });
    }

    register<T>(service: Identifier<T>, serviceInstance: T) {
        this.services[service.key] = serviceInstance as unknown as RpcService;
    }
}

export class RemoteSubject<T> extends Disposable implements SubjectLike<T> {
    private completed = false;

    get finalKey() {
        return `${this.identifier.key}-${this._key}`;
    }

    constructor(
        private identifier: Identifier<T>,
        private _key: string,
        private initialValue: T,
        private manager: RemoteSubjectManager,
    ) {
        super();
    }

    next(value: T): void {
        if (this.completed) return;
        this.manager.sendMessage({
            operation: 'next',
            key: this.finalKey,
            value,
            type: OBSERVABLE_EVENT
        });
    }

    complete(): void {
        if (this.completed) return;
        this.completed = true;
        this.manager.sendMessage({
            operation: 'complete',
            key: this.finalKey,
            type: OBSERVABLE_EVENT
        });
    }

    subscribe(): () => void {
        throw new Error('RemoteSubject should not be subscribed locally.');
    }

    getInitialValue(): T {
        return this.initialValue;
    }
}

export class RemoteSubjectManager extends Disposable {
    private subjects = new Map<string, RemoteSubject<any>>();
    private pendingSubscriptions = new Map<string, Set<number>>(); // key -> senderIds
    private activeSenders = new Map<string, Set<number>>(); // key -> senderIds

    constructor() {
        super();

        const handleMessage = (msg: RpcObservableSubscribeMessage, sender: chrome.runtime.MessageSender) => {
            const senderId = sender.tab?.id;
            if (!senderId) {
                console.warn('Received RPC request from unknown sender, ignoring.', msg);
                return;
            }

            if (msg.type === SUBSCRIBABLE_OBSERVABLE) {
                const { key } = msg;
                this.handleSubscription(key, senderId);
            }

            if (msg.type === UNSUBSCRIBE_OBSERVABLE) {
                const { key } = msg;
                this.handleUnsubscription(key, senderId);
            }
        };

        chrome.runtime.onMessage.addListener(handleMessage);
        this.disposeWithMe(() => {
            chrome.runtime.onMessage.removeListener(handleMessage);
        });

        const handleTabRemove = (tabId: number) => {
            // 清理该 tab 的所有订阅
            this.activeSenders.forEach((senders) => {
                senders.delete(tabId);
            });
            this.pendingSubscriptions.forEach((senders) => {
                senders.delete(tabId);
            });
        };

        chrome.tabs.onRemoved.addListener(handleTabRemove);
        this.disposeWithMe(() => {
            chrome.tabs.onRemoved.removeListener(handleTabRemove);
        });
    }

    private handleSubscription(key: string, senderId: number) {
        const subject = this.subjects.get(key);

        if (subject) {
            // Subject 已存在，直接处理订阅
            if (!this.activeSenders.has(key)) {
                this.activeSenders.set(key, new Set());
            }
            this.activeSenders.get(key)!.add(senderId);

            // 发送初始值
            chrome.tabs.sendMessage(senderId, {
                operation: 'next',
                key,
                value: subject.getInitialValue(),
            });
        } else {
            // Subject 尚未创建，缓存到待处理队列
            if (!this.pendingSubscriptions.has(key)) {
                this.pendingSubscriptions.set(key, new Set());
            }
            this.pendingSubscriptions.get(key)!.add(senderId);
        }
    }

    private handleUnsubscription(key: string, senderId: number) {
        // 从活跃订阅中移除
        const activeSenders = this.activeSenders.get(key);
        if (activeSenders) {
            activeSenders.delete(senderId);
            if (activeSenders.size === 0) {
                this.activeSenders.delete(key);
            }
        }

        // 从待处理队列中移除
        const pendingSenders = this.pendingSubscriptions.get(key);
        if (pendingSenders) {
            pendingSenders.delete(senderId);
            if (pendingSenders.size === 0) {
                this.pendingSubscriptions.delete(key);
            }
        }
    }

    sendMessage(message: RpcObservableUpdateMessage<any>) {
        const { key } = message;

        // 发送到所有订阅的 tabs
        const senders = this.activeSenders.get(key);
        if (senders) {
            senders.forEach(senderId => {
                chrome.tabs.sendMessage(senderId, message);
            });
        }
    }

    createSubject<T>(id: Identifier<T>, key: string, initialValue: T): RemoteSubject<T> {
        const subject = new RemoteSubject<T>(id, key, initialValue, this);
        this.subjects.set(key, subject);

        // 处理待处理的订阅
        const pendingSenders = this.pendingSubscriptions.get(key);
        if (pendingSenders && pendingSenders.size > 0) {
            if (!this.activeSenders.has(key)) {
                this.activeSenders.set(key, new Set());
            }
            const activeSenders = this.activeSenders.get(key)!;

            // 将待处理的订阅转移到活跃订阅
            pendingSenders.forEach(senderId => {
                activeSenders.add(senderId);
                // 发送初始值
                chrome.tabs.sendMessage(senderId, {
                    operation: 'next',
                    key,
                    value: initialValue,
                });
            });

            // 清空待处理队列
            this.pendingSubscriptions.delete(key);
        }

        return subject;
    }

    getSubject<T>(key: string): RemoteSubject<T> | undefined {
        return this.subjects.get(key) as RemoteSubject<T> | undefined;
    }

    removeSubject(key: string): void {
        const subject = this.subjects.get(key);
        if (subject) {
            subject.dispose();
            this.subjects.delete(key);

            // 清理相关的订阅信息
            this.activeSenders.delete(key);
            this.pendingSubscriptions.delete(key);
        }
    }
}