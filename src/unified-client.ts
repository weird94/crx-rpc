import { Disposable } from './disposable'
import { Identifier } from './id'
import { RuntimeRPCClient } from './runtime-client'
import { TabRPCClient } from './tab-client'
import type { RpcTo, RpcTransferable } from './types'

type ClientEnvironment = 'runtime'

type ServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never
}

export interface CreateServiceOptions {
  tabId?: number
}

function detectClientEnvironment(): ClientEnvironment {
  if (typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function') {
    return 'runtime'
  }

  throw new Error('Web page RPC support has been removed. Chrome runtime API is required.')
}

export class UnifiedRPCClient extends Disposable {
  private readonly environment: ClientEnvironment
  private readonly runtimeClient: RuntimeRPCClient
  private readonly tabClients: Map<number, TabRPCClient> = new Map()

  constructor() {
    super()
    this.environment = detectClientEnvironment()
    this.runtimeClient = new RuntimeRPCClient()
    this.disposeWithMe(() => this.runtimeClient.dispose())
  }

  private getOrCreateTabClient(tabId: number): TabRPCClient {
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

  async createRPCService<T>(
    serviceIdentifier: Identifier<T>,
    options?: CreateServiceOptions
  ): Promise<ServiceProxy<T>> {
    if (serviceIdentifier.to === 'content') {
      const tabId = options?.tabId
      if (tabId === undefined) {
        throw new Error(
          `TabId is required when calling content service "${serviceIdentifier.key}". ` +
            `Usage: client.createRPCService(identifier, { tabId: <number> })`
        )
      }

      return this.getOrCreateTabClient(tabId).createRPCService(serviceIdentifier)
    }

    return this.runtimeClient.createRPCService(serviceIdentifier)
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
      const tabId = options?.tabId
      if (tabId === undefined) {
        throw new Error('TabId is required when calling content service')
      }
      return this.getOrCreateTabClient(tabId).call<TResult>(service, method, to, args)
    }

    return this.runtimeClient.call<TResult>(service, method, to, args)
  }
}

export function createClient(): UnifiedRPCClient {
  return new UnifiedRPCClient()
}
