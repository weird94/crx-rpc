import { RPCClient } from './client'
import { RPC_EVENT_NAME, RPC_REQUEST_RELAY_EVENT_NAME, RPC_RESPONSE_EVENT_NAME } from './const'
import type { IMessageAdapter, RpcNativeResponse, RpcRequest, RpcTransferable } from './types'

class WebPageRequestSender implements IMessageAdapter {
  sendRequest<TResult extends RpcTransferable>(
    request: RpcRequest
  ): Promise<RpcNativeResponse<TResult>> {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('Window is required for web page RPC requests.'))
    }

    return new Promise<RpcNativeResponse<TResult>>((resolve, reject) => {
      const responseHandler = (event: Event) => {
        const customEvent = event as CustomEvent<{
          type?: string
          id?: string
          response?: RpcNativeResponse<TResult>
        }>
        const detail = customEvent.detail

        if (detail?.type !== RPC_EVENT_NAME || detail.id !== request.id || !detail.response) {
          return
        }

        window.removeEventListener(RPC_RESPONSE_EVENT_NAME, responseHandler as EventListener)
        resolve(detail.response)
      }

      window.addEventListener(RPC_RESPONSE_EVENT_NAME, responseHandler as EventListener)

      try {
        window.dispatchEvent(
          new CustomEvent(RPC_REQUEST_RELAY_EVENT_NAME, {
            detail: {
              ...request,
              type: RPC_EVENT_NAME,
            },
          })
        )
      } catch (error) {
        window.removeEventListener(RPC_RESPONSE_EVENT_NAME, responseHandler as EventListener)
        reject(error)
      }
    })
  }
}

export class WebPageRPCClient extends RPCClient {
  constructor() {
    super(new WebPageRequestSender(), 'web')
  }
}
