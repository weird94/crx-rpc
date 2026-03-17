import { RPCClient } from '../client'
import { RPC_EVENT_NAME } from '../const'
import type { IMessageAdapter, RpcNativeResponse, RpcRequest, RpcTransferable } from '../types'

class TabMessageAdapter implements IMessageAdapter {
  constructor(private readonly tabId: number) {}

  onMessage<T>(_type: string, _callback: (message: T) => void): () => void {
    return () => {}
  }

  sendMessage<T>(type: string, message: T): void {
    void type
    void message
  }

  sendRequest<TResult extends RpcTransferable>(
    request: RpcRequest
  ): Promise<RpcNativeResponse<TResult>> {
    return chrome.tabs.sendMessage(this.tabId, {
      ...request,
      type: RPC_EVENT_NAME,
    }) as Promise<RpcNativeResponse<TResult>>
  }
}

export class TabRPCClient extends RPCClient {
  constructor(tabId: number) {
    super(new TabMessageAdapter(tabId), 'wxt-page')
  }
}
