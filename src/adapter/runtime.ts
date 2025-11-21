import { createRuntimeMessageChannel } from '../messaging'
import { BaseObservable, RPCClient } from '../client'
import { IMessageAdapter } from '../types'
import { Identifier } from '../id'

export const runtimeChannel = createRuntimeMessageChannel<any>()

const runtimeMessageAdapter: IMessageAdapter = {
  onMessage<T>(type: string, callback: (message: T) => void) {
    const handler = (msg: { type?: string } & T) => {
      if (msg.type === type) {
        callback(msg)
      }
    }

    return runtimeChannel.onMessage(handler)
  },
  sendMessage<T>(type: string, message: T): void {
    runtimeChannel.sendMessage({ ...message, type }).catch(error => {
      console.warn('Failed to send RPC message from content to background', type, error)
    })
  },
}

/**
 * 在 content-script/popup/sidepanel 中使用的 rpc-client，可以调用 background-rpc-service
 */
export class RuntimeRPCClient extends RPCClient {
  constructor() {
    super(runtimeMessageAdapter, 'runtime')
  }
}

export class RuntimeObservable<T> extends BaseObservable<T> {
  constructor(identifier: Identifier<T>, key: string, callback: (value: T) => void) {
    super(identifier, key, callback, runtimeMessageAdapter)
  }
}
