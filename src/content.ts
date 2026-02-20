import { runtimeChannel } from './adapter'
import {
  OBSERVABLE_EVENT,
  RPC_EVENT_NAME,
  RPC_PING,
  RPC_PONG,
  RPC_RESPONSE_EVENT_NAME,
  SUBSCRIBABLE_OBSERVABLE,
  UNSUBSCRIBE_OBSERVABLE,
} from './const'
import { Disposable } from './disposable'
import { toRpcErrorLike } from './error'
import { Identifier } from './id'
import type { RpcRequest, RpcResponse, RpcService } from './types'

const WEB_TO_BACKGROUND = [RPC_EVENT_NAME, SUBSCRIBABLE_OBSERVABLE, UNSUBSCRIBE_OBSERVABLE]
const BACKGROUND_TO_WEB = [RPC_RESPONSE_EVENT_NAME, OBSERVABLE_EVENT, RPC_PONG]

function getRuntimeId(): string | undefined {
  const browserNs = (globalThis as any)?.browser
  if (browserNs?.runtime?.id) {
    return browserNs.runtime.id
  }
  const chromeNs = (globalThis as any)?.chrome
  if (chromeNs?.runtime?.id) {
    return chromeNs.runtime.id
  }
  return undefined
}

// 运行在 content script 里面，作为 web 到 background 的中转
export class Web2BackgroundProxy extends Disposable {
  constructor() {
    super()
    WEB_TO_BACKGROUND.forEach(eventName => {
      const handler = (event: any) => {
        const request = { ...event.detail, type: eventName } as RpcRequest
        if (request.to !== 'background') return
        runtimeChannel.sendMessage(request).catch(error => {
          console.warn('Failed to forward RPC event from web to background', eventName, error)
        })
      }
      window.addEventListener(eventName, handler)

      this.disposeWithMe(() => {
        window.removeEventListener(eventName, handler)
      })
    })

    const handler = (msg: { type?: string } & (RpcRequest | RpcResponse)) => {
      if (!msg.type || !BACKGROUND_TO_WEB.includes(msg.type) || msg.from !== 'web') return
      const { type, ...detail } = msg
      window.dispatchEvent(new CustomEvent(type, { detail }))
    }
    const dispose = runtimeChannel.onMessage(handler)

    this.disposeWithMe(dispose)
  }
}

export class ContentRPCHost extends Disposable {
  private services: Record<string, RpcService> = {}

  private runtimeId = getRuntimeId()

  constructor(private log: boolean = false) {
    super()

    const handler = (msg: RpcRequest & { type?: string }, sender: chrome.runtime.MessageSender) => {
      if (msg.type === RPC_PING) {
        runtimeChannel
          .sendMessage({
            type: RPC_PONG,
            from: 'content',
          })
          .catch(() => { })
        return true
      }
      if (msg.type !== RPC_EVENT_NAME) return
      if (this.runtimeId && sender.id && sender.id !== this.runtimeId) return

      const { id, service, method, args, from } = msg
      const serviceInstance = this.services[service]

      const sendResponse = (response: Omit<RpcResponse, 'from'>) => {
        runtimeChannel
          .sendMessage({
            ...response,
            type: RPC_RESPONSE_EVENT_NAME,
            from,
          })
          .catch(error => {
            console.warn('Failed to send RPC response from content to background', response, error)
          })
      }

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
        )
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
          )
        }
        sendResponse({
          id,
          error: { message: `Unknown service: ${service}` },
          service,
          method,
        })
        return
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
          )
        }
        sendResponse({
          id,
          error: { message: `Unknown method: ${method}` },
          service,
          method,
        })
        return
      }

      Promise.resolve()
        .then(() => (serviceInstance as RpcService)[method](...args))
        .then(result => {
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
            )
          }
          sendResponse({
            id,
            result,
            service,
            method,
          })
        })
        .catch(err => {
          const rpcError = toRpcErrorLike(err)
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
                error: rpcError.message,
                timestamp: new Date().toISOString(),
              }
            )
          } else {
            console.error('RPC Error (tab):', service, method, err)
          }
          sendResponse({
            id,
            error: {
              message: rpcError.message,
              stack: rpcError.stack,
              name: rpcError.name,
            },
            service,
            method,
          })
        })
    }

    const dispose = runtimeChannel.onMessage(handler)
    this.disposeWithMe(dispose)
  }

  register<T>(service: Identifier<T>, serviceInstance: T) {
    this.services[service.key] = serviceInstance as unknown as RpcService
  }
}
