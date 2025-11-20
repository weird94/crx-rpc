export type RpcTo = 'content' | 'background'
export type RpcFrom = 'content' | 'wxt-page' | 'web'

export interface RpcRequest {
    id: string;
    method: string;
    service: string;
    args: any[];
    to: RpcTo
    from: RpcFrom
}

export interface RpcResponse {
    id: string;
    result?: any;
    error?: { message: string; stack?: string; name?: string };
    service: string;
    method: string;
    from: RpcFrom
}

export type RpcHandler = (...args: any[]) => Promise<any> | any;

export type RpcService = Record<string, RpcHandler>;

export interface ObservableLike<T> {
    subscribe(next: (value: T) => void): () => void;
}

export interface SubjectLike<T> extends ObservableLike<T> {
    next(value: T): void;
    complete(): void;
}

export interface RpcObservableUpdateMessage<T> {
    type: string;
    operation: 'next' | 'complete';
    key: string;
    value?: T;
}

export interface RpcObservableSubscribeMessage {
    type: string;
    key: string;
}

export interface IMessageAdapter {
    onMessage<T>(type: string, callback: (message: T) => void): () => void;

    sendMessage<T>(type: string, message: T): void;
}

export interface IDisposable {
    dispose(): void;
}