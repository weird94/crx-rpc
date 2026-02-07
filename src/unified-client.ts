import { Disposable } from './disposable'
import { Identifier } from './id'
import { RuntimeRPCClient } from './adapter/runtime'
import { WebRPCClient } from './adapter/web'
import { TabRPCClient } from './adapter/tab'
import { RPCClient } from './client'

type ClientEnvironment = 'runtime' | 'web'

/**
 * 检测当前客户端运行环境
 */
function detectClientEnvironment(): ClientEnvironment {
    const chromeNs = (globalThis as any)?.chrome
    const browserNs = (globalThis as any)?.browser

    // 如果有 chrome.runtime 或 browser.runtime API，说明在扩展环境（content/popup/sidepanel）
    if (chromeNs?.runtime || browserNs?.runtime) {
        return 'runtime'
    }

    // 否则在普通 web 环境
    return 'web'
}

type ServiceProxy<T> = {
    [K in keyof T]: T[K] extends (...args: any[]) => any
    ? (...args: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>>
    : never
}

export interface CreateServiceOptions {
    /**
     * 目标 tab ID（仅当调用 content service 时需要）
     */
    tabId?: number
}

/**
 * 统一的 RPC Client，自动检测运行环境并智能选择底层实现
 * - 在扩展环境（content/popup/sidepanel）使用 RuntimeRPCClient
 * - 在 web 环境使用 WebRPCClient
 * - 调用 content service 时需要提供 tabId，会自动使用 TabRPCClient
 */
export class UnifiedRPCClient extends Disposable {
    private environment: ClientEnvironment
    private runtimeClient?: RuntimeRPCClient
    private webClient?: WebRPCClient
    private tabClients: Map<number, TabRPCClient> = new Map()

    constructor() {
        super()
        this.environment = detectClientEnvironment()

        if (this.environment === 'runtime') {
            this.runtimeClient = new RuntimeRPCClient()
            this.disposeWithMe(() => this.runtimeClient?.dispose())
        } else {
            this.webClient = new WebRPCClient()
            this.disposeWithMe(() => this.webClient?.dispose())
        }
    }

    /**
     * 创建 RPC 服务代理
     * 
     * @param serviceIdentifier 服务标识符（包含目标位置 'background' 或 'content'）
     * @param options 选项
     * @param options.tabId 当调用 content service 时必需，指定目标 tab ID
     * 
     * @example
     * // 调用 background service
     * const bgService = await client.createRPCService(IBackgroundService)
     * await bgService.someMethod()
     * 
     * @example
     * // 调用 content service（需要提供 tabId）
     * const contentService = await client.createRPCService(IContentService, { tabId: 123 })
     * await contentService.someMethod()
     */
    async createRPCService<T>(
        serviceIdentifier: Identifier<T>,
        options?: CreateServiceOptions
    ): Promise<ServiceProxy<T>> {
        const { to } = serviceIdentifier
        const { tabId } = options || {}

        // 如果目标是 content service，需要使用 TabRPCClient
        if (to === 'content') {
            if (tabId === undefined) {
                throw new Error(
                    `TabId is required when calling content service "${serviceIdentifier.key}". ` +
                    `Usage: client.createRPCService(identifier, { tabId: <number> })`
                )
            }

            // 复用或创建 TabRPCClient
            let tabClient = this.tabClients.get(tabId)
            if (!tabClient) {
                tabClient = new TabRPCClient(tabId)
                this.tabClients.set(tabId, tabClient)
                this.disposeWithMe(() => {
                    tabClient?.dispose()
                    this.tabClients.delete(tabId)
                })
            }

            return tabClient.createRPCService(serviceIdentifier)
        }

        // 目标是 background service，使用默认 client
        if (this.environment === 'runtime') {
            if (!this.runtimeClient) {
                throw new Error('RuntimeRPCClient not initialized')
            }
            return this.runtimeClient.createRPCService(serviceIdentifier)
        } else {
            if (!this.webClient) {
                throw new Error('WebRPCClient not initialized')
            }
            return this.webClient.createRPCService(serviceIdentifier)
        }
    }

    /**
     * 获取当前客户端环境
     */
    getEnvironment(): ClientEnvironment {
        return this.environment
    }

    /**
     * 直接调用 RPC 方法（底层 API）
     */
    async call<T = any>(
        service: string,
        method: string,
        to: 'content' | 'background',
        args: any[],
        options?: CreateServiceOptions
    ): Promise<T> {
        const { tabId } = options || {}

        if (to === 'content') {
            if (tabId === undefined) {
                throw new Error('TabId is required when calling content service')
            }

            let tabClient = this.tabClients.get(tabId)
            if (!tabClient) {
                tabClient = new TabRPCClient(tabId)
                this.tabClients.set(tabId, tabClient)
                this.disposeWithMe(() => {
                    tabClient?.dispose()
                    this.tabClients.delete(tabId)
                })
            }

            return tabClient.call<T>(service, method, to, args)
        }

        if (this.environment === 'runtime') {
            if (!this.runtimeClient) {
                throw new Error('RuntimeRPCClient not initialized')
            }
            return this.runtimeClient.call<T>(service, method, to, args)
        } else {
            if (!this.webClient) {
                throw new Error('WebRPCClient not initialized')
            }
            return this.webClient.call<T>(service, method, to, args)
        }
    }
}

/**
 * 工厂函数：创建统一的 RPC Client
 */
export function createClient(): UnifiedRPCClient {
    return new UnifiedRPCClient()
}
