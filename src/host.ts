import { attachServiceAccessor } from './base-service'
import { RPC_EVENT_NAME, RPC_REQUEST_RELAY_EVENT_NAME, RPC_RESPONSE_EVENT_NAME } from './const'
import { Disposable } from './disposable'
import { toRpcErrorPayload } from './error'
import type { Identifier } from './id'
import type {
  RpcErrorPayload,
  RpcNativeResponse,
  RpcRequest,
  RpcService,
  RpcTo,
  RpcTransferable,
} from './types'
import { UnifiedRPCClient } from './unified-client'

type Environment = 'background' | 'content'

type RuntimeListener = (
  message: Partial<RpcRequest> & { type?: string },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: RpcNativeResponse<RpcTransferable>) => void
) => boolean

function getRuntimeId(): string | undefined {
  return typeof chrome !== 'undefined' ? chrome.runtime.id : undefined
}

function hasChromeTabsApi(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.tabs?.sendMessage === 'function'
}

function isWindowContext(): boolean {
  return typeof window !== 'undefined' && window === globalThis
}

function isRpcTo(value: string | undefined): value is RpcTo {
  return value === 'background' || value === 'content'
}

function isRpcFrom(value: string | undefined): value is RpcRequest['from'] {
  return value === 'runtime' || value === 'wxt-page' || value === 'web'
}

function isRpcRequestMessage(
  message: Partial<RpcRequest> & { type?: string }
): message is RpcRequest & { type: typeof RPC_EVENT_NAME } {
  return (
    message.type === RPC_EVENT_NAME &&
    typeof message.id === 'string' &&
    typeof message.method === 'string' &&
    typeof message.service === 'string' &&
    Array.isArray(message.args) &&
    isRpcTo(message.to) &&
    isRpcFrom(message.from)
  )
}

function createSuccessResponse<TResult extends RpcTransferable>(
  result: TResult
): RpcNativeResponse<TResult> {
  return {
    ok: true,
    result,
  }
}

function createErrorResponse(error: RpcErrorPayload): RpcNativeResponse {
  return {
    ok: false,
    error,
  }
}

function detectEnvironment(): Environment {
  if (hasChromeTabsApi() && !isWindowContext()) {
    return 'background'
  }

  if (isWindowContext()) {
    return 'content'
  }

  return 'background'
}

export class UnifiedRPCHost extends Disposable {
  private readonly services: Record<string, RpcService> = {}
  private readonly environment: Environment
  private readonly runtimeId: string | undefined
  private readonly serviceClient: UnifiedRPCClient

  constructor(private readonly log: boolean = false) {
    super()
    this.environment = detectEnvironment()
    this.runtimeId = this.environment === 'content' ? getRuntimeId() : undefined
    this.serviceClient = new UnifiedRPCClient()
    this.disposeWithMe(() => this.serviceClient.dispose())
    this.setupListener()

    if (this.log) {
      console.log(
        `%c RPC Host %c Initialized in %c ${this.environment} %c environment`,
        'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
        'color: #6b7280; font-weight: 500;',
        'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
        'color: #6b7280; font-weight: 500;'
      )
    }
  }

  private setupListener(): void {
    const handler: RuntimeListener = (message, sender, sendResponse) => {
      if (!isRpcRequestMessage(message)) {
        return false
      }

      if (message.to !== this.environment) {
        return false
      }

      if (
        this.environment === 'content' &&
        this.runtimeId &&
        sender.id &&
        sender.id !== this.runtimeId
      ) {
        return false
      }

      void this.handleRequest(message, sender).then(sendResponse)
      return true
    }

    chrome.runtime.onMessage.addListener(handler)
    this.disposeWithMe(() => {
      chrome.runtime.onMessage.removeListener(handler)
    })

    if (this.environment === 'content' && typeof window !== 'undefined') {
      const webRelayHandler = ((event: Event) => {
        const customEvent = event as CustomEvent<Partial<RpcRequest> & { type?: string }>
        const message = customEvent.detail
        if (!isRpcRequestMessage(message) || message.from !== 'web') {
          return
        }

        if (message.to === 'background') {
          void chrome.runtime
            .sendMessage({
              ...message,
              type: RPC_EVENT_NAME,
            })
            .then(response => {
              window.dispatchEvent(
                new CustomEvent(RPC_RESPONSE_EVENT_NAME, {
                  detail: {
                    type: RPC_EVENT_NAME,
                    id: message.id,
                    response,
                  },
                })
              )
            })
            .catch(error => {
              window.dispatchEvent(
                new CustomEvent(RPC_RESPONSE_EVENT_NAME, {
                  detail: {
                    type: RPC_EVENT_NAME,
                    id: message.id,
                    response: createErrorResponse(toRpcErrorPayload(error)),
                  },
                })
              )
            })
          return
        }

        void this.handleRequest(message, {
          id: this.runtimeId,
          url: window.location.href,
        } as chrome.runtime.MessageSender).then(response => {
          window.dispatchEvent(
            new CustomEvent(RPC_RESPONSE_EVENT_NAME, {
              detail: {
                type: RPC_EVENT_NAME,
                id: message.id,
                response,
              },
            })
          )
        })
      }) as EventListener

      window.addEventListener(RPC_REQUEST_RELAY_EVENT_NAME, webRelayHandler)
      this.disposeWithMe(() => {
        window.removeEventListener(RPC_REQUEST_RELAY_EVENT_NAME, webRelayHandler)
      })
    }
  }

  private async handleRequest(
    request: RpcRequest,
    sender: chrome.runtime.MessageSender
  ): Promise<RpcNativeResponse<RpcTransferable>> {
    const serviceInstance = this.services[request.service]
    const serviceMethod = serviceInstance?.[request.method]
    const senderLabel = sender.tab?.id ? `tab:${String(sender.tab.id)}` : sender.id || 'runtime'

    if (this.log) {
      console.log(
        `[crx-rpc] ${this.environment} received ${request.service}.${request.method} from ${senderLabel}`,
        {
          args: request.args,
          timestamp: new Date().toISOString(),
        }
      )
    }

    if (!serviceInstance) {
      return createErrorResponse({ message: `Unknown service: ${request.service}` })
    }

    if (typeof serviceMethod !== 'function') {
      return createErrorResponse({ message: `Unknown method: ${request.method}` })
    }

    try {
      const result = await serviceMethod.apply(serviceInstance, request.args)
      return createSuccessResponse(result)
    } catch (error) {
      const rpcError = toRpcErrorPayload(error)

      if (this.log) {
        console.error(
          `[crx-rpc] ${this.environment} failed ${request.service}.${request.method}`,
          rpcError
        )
      }

      return createErrorResponse(rpcError)
    }
  }

  register<T>(serviceIdentifier: Identifier<T>, serviceInstance: T): void {
    attachServiceAccessor(serviceInstance, this.serviceClient)
    this.services[serviceIdentifier.key] = serviceInstance as RpcService

    if (this.log) {
      console.log(
        `%c RPC Host %c Registered service: %c ${serviceIdentifier.key} %c (${this.environment})`,
        'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
        'color: #6b7280; font-weight: 500;',
        'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
        'color: #6b7280; font-weight: 500;'
      )
    }
  }

  getEnvironment(): Environment {
    return this.environment
  }
}

export function createHost(log: boolean = false): UnifiedRPCHost {
  return new UnifiedRPCHost(log)
}
