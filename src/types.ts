export type RpcTo = 'content' | 'background'
export type RpcFrom = 'runtime' | 'wxt-page' | 'web'
export type RpcTransferable = boolean | number | string | null | undefined | object

export interface RpcErrorPayload {
  message: string
  stack?: string
  name?: string
}

export interface RpcRequest {
  id: string
  method: string
  service: string
  args: RpcTransferable[]
  to: RpcTo
  from: RpcFrom
}

export interface RpcResponse {
  id: string
  result?: RpcTransferable
  error?: RpcErrorPayload
  service: string
  method: string
  from?: RpcFrom
}

export interface RpcSuccessResponse<TResult extends RpcTransferable = RpcTransferable> {
  ok: true
  result: TResult
}

export interface RpcFailureResponse {
  ok: false
  error: RpcErrorPayload
}

export type RpcNativeResponse<TResult extends RpcTransferable = RpcTransferable> =
  | RpcSuccessResponse<TResult>
  | RpcFailureResponse

export type RpcHandler = (...args: RpcTransferable[]) => Promise<RpcTransferable> | RpcTransferable

export type RpcService = Record<string, RpcHandler>

export interface ObservableLike<T> {
  subscribe(next: (value: T) => void): () => void
}

export interface SubjectLike<T> extends ObservableLike<T> {
  next(value: T): void
  complete(): void
}

export interface RpcObservableUpdateMessage<T> {
  type: string
  operation: 'next' | 'complete'
  key: string
  value?: T
}

export interface RpcObservableSubscribeMessage {
  type: string
  key: string
}

export interface IMessageAdapter {
  sendRequest<TResult extends RpcTransferable>(
    request: RpcRequest
  ): Promise<RpcNativeResponse<TResult>>
}

export interface IDisposable {
  dispose(): void
}
