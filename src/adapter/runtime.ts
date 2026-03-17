import { RPCClient } from '../client'
import { RPC_EVENT_NAME } from '../const'
import type { IMessageAdapter, RpcNativeResponse, RpcRequest, RpcTransferable } from '../types'

const runtimeMessageAdapter: IMessageAdapter = {
  onMessage<T>(_type: string, _callback: (message: T) => void) {
    return () => {}
  },
  sendMessage<T>(type: string, message: T): void {
    void type
    void message
  },
  sendRequest<TResult extends RpcTransferable>(
    request: RpcRequest
  ): Promise<RpcNativeResponse<TResult>> {
    return chrome.runtime.sendMessage({
      ...request,
      type: RPC_EVENT_NAME,
    }) as Promise<RpcNativeResponse<TResult>>
  },
}

export class RuntimeRPCClient extends RPCClient {
  constructor() {
    super(runtimeMessageAdapter, 'runtime')
  }
}
