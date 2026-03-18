import { RPCClient } from './client'
import { RPC_EVENT_NAME } from './const'
import type { IMessageAdapter, RpcNativeResponse, RpcRequest, RpcTransferable } from './types'

class TabRequestSender implements IMessageAdapter {
  constructor(private readonly tabId: number) {}

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
    super(new TabRequestSender(tabId), 'wxt-page')
  }
}
