export type RpcTo = 'content' | 'background'
export type RpcFrom = 'runtime' | 'web' | 'wxt-page'

export interface RpcRequest {
  id: string
  method: string
  service: string
  args: any[]
  to: RpcTo
  from: RpcFrom
}

export interface RpcResponse {
  id: string
  result?: any
  error?: { message: string; stack?: string; name?: string }
  service: string
  method: string
  from: RpcFrom
}

export type RpcHandler = (...args: any[]) => Promise<any> | any

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
  onMessage<T>(type: string, callback: (message: T) => void): () => void

  sendMessage<T>(type: string, message: T): void
}

export interface IDisposable {
  dispose(): void
}

/**
 * RPC 调用上下文，包含调用者信息
 * Service 方法可以通过最后一个参数获取此上下文
 */
export interface RpcContext {
  /** 调用来源的 tab ID，如果来自 sidepanel/popup 则为 undefined */
  tabId?: number
  /** 完整的 sender 信息 */
  sender: chrome.runtime.MessageSender
  /** 是否来自 runtime（sidepanel/popup），而非 content script */
  isFromRuntime: boolean
}
