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

type Environment = 'background' | 'content'

function detectEnvironment(): Environment {
    // 检测是否在 background script 环境
    // background 环境通常有 chrome.tabs API
    const chromeNs = (globalThis as any)?.chrome
    const browserNs = (globalThis as any)?.browser

    // 如果有 tabs API，且没有 window 对象或 window 不是当前全局对象，则为 background
    const hasTabs = chromeNs?.tabs || browserNs?.tabs
    const hasWindow = typeof window !== 'undefined' && window === globalThis

    if (hasTabs && !hasWindow) {
        return 'background'
    }

    // 如果有 window 对象且有 runtime API，则为 content script
    if (hasWindow && (chromeNs?.runtime || browserNs?.runtime)) {
        return 'content'
    }

    // 默认为 background（service worker）
    return 'background'
}

/**
 * 统一的 RPC Host，自动检测运行环境（background/content）
 * - 在 background 环境中处理来自 content script 和 runtime contexts（popup/sidepanel）的请求
 * - 在 content 环境中处理来自 background 的请求，并自动转发 web 消息到 background
 */
export class UnifiedRPCHost extends Disposable {
    private services: Record<string, RpcService> = {}
    private environment: Environment
    private runtimeId?: string

    constructor(private log: boolean = false) {
        super()

        this.environment = detectEnvironment()

        if (this.environment === 'background') {
            this.setupBackgroundHost()
        } else {
            this.setupContentHost()
            this.setupWebForwarding()
        }

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

    private setupBackgroundHost() {
        const handler = (
            msg: RpcRequest & { type?: string },
            sender: chrome.runtime.MessageSender,
            sendResponseCallback: (response?: any) => void
        ) => {
            if (msg.type !== RPC_EVENT_NAME && msg.type !== RPC_PING) return false

            const tabId = sender.tab?.id
            const isFromRuntime = !tabId // sidepanel/popup 没有 tab id

            if (msg.type === RPC_PING) {
                const pong = {
                    type: RPC_PONG,
                    from: 'background',
                }
                if (isFromRuntime) {
                    chrome.runtime.sendMessage(pong).catch(() => { })
                } else {
                    chrome.tabs.sendMessage(tabId, pong)
                }
                return true
            }

            // 根据来源选择不同的响应方式
            const sendResponse = (response: Omit<RpcResponse, 'from'>) => {
                const fullResponse = {
                    ...response,
                    type: RPC_RESPONSE_EVENT_NAME,
                    from: msg.from,
                }

                if (isFromRuntime) {
                    chrome.runtime.sendMessage(fullResponse).catch(() => { })
                } else {
                    chrome.tabs.sendMessage(tabId, fullResponse)
                }
            }

            this.handleRequest(msg, sendResponse, isFromRuntime, tabId)
            return true
        }

        chrome.runtime.onMessage.addListener(handler)
        this.disposeWithMe(() => {
            chrome.runtime.onMessage.removeListener(handler)
        })
    }

    private setupContentHost() {
        this.runtimeId = getRuntimeId()

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

            const sendResponse = (response: Omit<RpcResponse, 'from'>) => {
                runtimeChannel
                    .sendMessage({
                        ...response,
                        type: RPC_RESPONSE_EVENT_NAME,
                        from: msg.from,
                    })
                    .catch(error => {
                        console.warn('Failed to send RPC response from content to background', response, error)
                    })
            }

            const tabId = sender.tab?.id
            const isFromRuntime = !tabId
            this.handleRequest(msg, sendResponse, isFromRuntime, tabId)
        }

        const dispose = runtimeChannel.onMessage(handler)
        this.disposeWithMe(dispose)
    }

    private setupWebForwarding() {
        // 自动设置 Web 到 Background 的转发
        // 监听来自 web 的消息
        WEB_TO_BACKGROUND.forEach(eventName => {
            const handler = (event: any) => {
                const request = { ...event.detail, type: eventName } as RpcRequest

                // 智能转发：只有目标是 background 的消息才转发
                if (request.to === 'background') {
                    runtimeChannel.sendMessage(request).catch(error => {
                        console.warn('Failed to forward RPC event from web to background', eventName, error)
                    })
                } else if (request.to === 'content') {
                    // 如果目标是 content，检查本地是否有对应的服务
                    const serviceInstance = this.services[request.service]
                    if (!serviceInstance) {
                        // 本地没有服务，返回友好错误
                        const errorResponse = {
                            id: request.id,
                            error: {
                                message: `Service "${request.service}" not found in content script. Make sure the service is registered.`
                            },
                            service: request.service,
                            method: request.method,
                            type: RPC_RESPONSE_EVENT_NAME,
                            from: request.from,
                        }
                        window.dispatchEvent(new CustomEvent(RPC_RESPONSE_EVENT_NAME, { detail: errorResponse }))
                    }
                    // 如果有服务，handleRequest 会处理（通过 setupContentHost 的 handler）
                }
            }
            window.addEventListener(eventName, handler)

            this.disposeWithMe(() => {
                window.removeEventListener(eventName, handler)
            })
        })

        // 转发来自 background 的响应到 web
        const handler = (msg: { type?: string } & (RpcRequest | RpcResponse)) => {
            if (!msg.type || !BACKGROUND_TO_WEB.includes(msg.type) || msg.from !== 'web') return
            const { type, ...detail } = msg
            window.dispatchEvent(new CustomEvent(type, { detail }))
        }
        const dispose = runtimeChannel.onMessage(handler)
        this.disposeWithMe(dispose)
    }

    private handleRequest(
        msg: RpcRequest & { type?: string },
        sendResponse: (response: Omit<RpcResponse, 'from'>) => void,
        isFromRuntime: boolean,
        tabId?: number
    ) {
        const { id, method, args, service } = msg
        const serviceInstance = this.services[service]

        const envLabel = this.environment === 'background' ? '' : ' (content)'

        if (this.log) {
            console.log(
                `%c RPC %c Call${envLabel}: %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
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
                    from: isFromRuntime ? 'runtime' : `tab:${tabId}`,
                    timestamp: new Date().toISOString(),
                }
            )
        }

        if (!serviceInstance) {
            if (this.log) {
                console.warn(
                    `%c RPC %c Unknown service${envLabel}: %c ${service} %c [%c ${id} %c]`,
                    'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
                    'color: #d97706; font-weight: bold;',
                    'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                    'color: #6b7280; font-weight: 500;',
                    'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                    'color: #6b7280; font-weight: 500;',
                    {
                        from: isFromRuntime ? 'runtime' : `tab:${tabId}`,
                        timestamp: new Date().toISOString(),
                    }
                )
            }
            const resp = {
                id,
                error: { message: `Unknown service: ${service}` },
                service,
                method,
            }
            sendResponse(resp)
            return
        }

        if (!(method in serviceInstance)) {
            if (this.log) {
                console.warn(
                    `%c RPC %c Unknown method${envLabel}: %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
                    'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
                    'color: #d97706; font-weight: bold;',
                    'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                    'color: #6b7280; font-weight: 500;',
                    'background: #dc2626; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                    'color: #6b7280; font-weight: 500;',
                    'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;',
                    'color: #6b7280; font-weight: 500;',
                    {
                        from: isFromRuntime ? 'runtime' : `tab:${tabId}`,
                        timestamp: new Date().toISOString(),
                    }
                )
            }
            const resp = {
                id,
                error: { message: `Unknown method: ${method}` },
                service,
                method,
            }
            sendResponse(resp)
            return
        }

        Promise.resolve()
            .then(() => serviceInstance[method](...args))
            .then(result => {
                if (this.log) {
                    console.log(
                        `%c RPC %c Success${envLabel}: %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
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
                        `%c RPC %c Error${envLabel}: %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
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
                    console.error('RPC Error:', service, method, err)
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

    /**
     * 注册一个 RPC 服务
     */
    register<T>(serviceIdentifier: Identifier<T>, serviceInstance: T): void {
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

    /**
     * 获取当前环境
     */
    getEnvironment(): Environment {
        return this.environment
    }
}

/**
 * 工厂函数：创建统一的 RPC Host
 */
export function createHost(log: boolean = false): UnifiedRPCHost {
    return new UnifiedRPCHost(log)
}
