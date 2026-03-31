import { Disposable } from './disposable'
import type { ServiceProxy } from './client'
import type { Identifier } from './id'
import { RuntimeRPCClient } from './runtime-client'
import { TabRPCClient } from './tab-client'
import { WebPageRPCClient } from './web-client'
import type { RpcTo, RpcTransferable } from './types'

type ClientEnvironment = 'runtime' | 'web'

export interface CreateServiceOptions {
  tabId?: number
}

function detectClientEnvironment(): ClientEnvironment {
  if (typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function') {
    return 'runtime'
  }

  if (typeof window !== 'undefined') {
    return 'web'
  }

  throw new Error('Chrome runtime API or window context is required.')
}

export class UnifiedRPCClient extends Disposable {
  private readonly environment: ClientEnvironment
  private readonly runtimeClient?: RuntimeRPCClient
  private readonly webClient?: WebPageRPCClient
  private readonly tabClients: Map<number, TabRPCClient> = new Map()

  constructor() {
    super()
    this.environment = detectClientEnvironment()
    if (this.environment === 'runtime') {
      this.runtimeClient = new RuntimeRPCClient()
      this.disposeWithMe(() => this.runtimeClient?.dispose())
    } else {
      this.webClient = new WebPageRPCClient()
      this.disposeWithMe(() => this.webClient?.dispose())
    }
  }

  private getOrCreateTabClient(tabId: number): TabRPCClient {
    if (this.environment !== 'runtime') {
      throw new Error('TabId-based content service calls are only available in extension runtime contexts.')
    }

    const existingClient = this.tabClients.get(tabId)
    if (existingClient) {
      return existingClient
    }

    const tabClient = new TabRPCClient(tabId)
    this.tabClients.set(tabId, tabClient)
    this.disposeWithMe(() => {
      tabClient.dispose()
      this.tabClients.delete(tabId)
    })
    return tabClient
  }

  createRPCService<T>(
    serviceIdentifier: Identifier<T>,
    options?: CreateServiceOptions
  ): ServiceProxy<T> {
    if (serviceIdentifier.to === 'content') {
      if (this.environment === 'web') {
        return this.webClient!.createRPCService(serviceIdentifier)
      }

      const tabId = options?.tabId
      if (tabId === undefined) {
        throw new Error(
          `TabId is required when calling content service "${serviceIdentifier.key}". ` +
            `Usage: client.createRPCService(identifier, { tabId: <number> })`
        )
      }

      return this.getOrCreateTabClient(tabId).createRPCService(serviceIdentifier)
    }

    return this.environment === 'runtime'
      ? this.runtimeClient!.createRPCService(serviceIdentifier)
      : this.webClient!.createRPCService(serviceIdentifier)
  }

  getEnvironment(): ClientEnvironment {
    return this.environment
  }

  async call<TResult extends RpcTransferable = RpcTransferable>(
    service: string,
    method: string,
    to: RpcTo,
    args: RpcTransferable[],
    options?: CreateServiceOptions
  ): Promise<TResult> {
    if (to === 'content') {
      if (this.environment === 'web') {
        return this.webClient!.call<TResult>(service, method, to, args)
      }

      const tabId = options?.tabId
      if (tabId === undefined) {
        throw new Error('TabId is required when calling content service')
      }
      return this.getOrCreateTabClient(tabId).call<TResult>(service, method, to, args)
    }

    return this.environment === 'runtime'
      ? this.runtimeClient!.call<TResult>(service, method, to, args)
      : this.webClient!.call<TResult>(service, method, to, args)
  }
}

export function createClient(): UnifiedRPCClient {
  return new UnifiedRPCClient()
}
