import { RPC_EVENT_NAME, RPC_PING, RPC_PONG, RPC_RESPONSE_EVENT_NAME } from '../const'
import { RPCClient } from '../client'
import { Disposable } from '../disposable'
import { toRpcErrorLike } from '../error'
import type { Identifier } from '../id'
import { randomId } from '../tool'
import type { IMessageAdapter, RpcFrom, RpcRequest, RpcResponse, RpcService, RpcTo } from '../types'

type FunctionArgs<T> = T extends (...args: infer A) => any ? A : never
type FunctionReturnType<T> = T extends (...args: any[]) => infer R ? R : never

type ServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? (...args: FunctionArgs<T[K]>) => Promise<Awaited<FunctionReturnType<T[K]>>>
    : never
}

export type PlaywrightTargetId = string | number
export type PlaywrightSide = 'background' | 'content'

export interface PlaywrightCreateClientOptions {
  from: PlaywrightSide
  defaultTargetId?: PlaywrightTargetId
}

export interface PlaywrightCreateServiceOptions {
  targetId?: PlaywrightTargetId
}

type SenderContext = {
  clientId: string
  side: PlaywrightSide
  targetId?: PlaywrightTargetId
}

type HostListener = (message: any, sender: SenderContext) => void
type ClientListener = (message: any) => void

class PlaywrightBus {
  private backgroundListeners = new Set<HostListener>()
  private contentListeners = new Map<string, Set<HostListener>>()
  private clientListeners = new Map<string, Set<ClientListener>>()

  private targetKey(targetId: PlaywrightTargetId): string {
    return String(targetId)
  }

  private safeInvoke(listener: (...args: any[]) => void, ...args: any[]) {
    try {
      listener(...args)
    } catch (error) {
      console.error('[crx-rpc/playwright] listener error', error)
    }
  }

  onBackgroundMessage(listener: HostListener): () => void {
    this.backgroundListeners.add(listener)
    return () => {
      this.backgroundListeners.delete(listener)
    }
  }

  onContentMessage(targetId: PlaywrightTargetId, listener: HostListener): () => void {
    const key = this.targetKey(targetId)
    const listeners = this.contentListeners.get(key) || new Set<HostListener>()
    listeners.add(listener)
    this.contentListeners.set(key, listeners)
    return () => {
      const current = this.contentListeners.get(key)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) {
        this.contentListeners.delete(key)
      }
    }
  }

  onClientMessage(clientId: string, listener: ClientListener): () => void {
    const listeners = this.clientListeners.get(clientId) || new Set<ClientListener>()
    listeners.add(listener)
    this.clientListeners.set(clientId, listeners)
    return () => {
      const current = this.clientListeners.get(clientId)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) {
        this.clientListeners.delete(clientId)
      }
    }
  }

  sendToBackground(message: any, sender: SenderContext): void {
    this.backgroundListeners.forEach(listener => this.safeInvoke(listener, message, sender))
  }

  sendToContent(targetId: PlaywrightTargetId, message: any, sender: SenderContext): void {
    const listeners = this.contentListeners.get(this.targetKey(targetId))
    if (!listeners) return
    listeners.forEach(listener => this.safeInvoke(listener, message, sender))
  }

  sendToClient(clientId: string, message: any): void {
    const listeners = this.clientListeners.get(clientId)
    if (!listeners) return
    listeners.forEach(listener => this.safeInvoke(listener, message))
  }
}

type AdapterRoute =
  | { to: 'background' }
  | {
      to: 'content'
      targetId: PlaywrightTargetId
    }

class PlaywrightMessageAdapter implements IMessageAdapter {
  constructor(
    private bus: PlaywrightBus,
    private sender: SenderContext,
    private route: AdapterRoute
  ) {}

  onMessage<T>(type: string, callback: (message: T) => void): () => void {
    return this.bus.onClientMessage(this.sender.clientId, (message: { type?: string } & T) => {
      if (message.type !== type) return
      callback(message)
    })
  }

  sendMessage<T>(type: string, message: T): void {
    const payload = { ...(message as Record<string, unknown>), type }
    if (this.route.to === 'background') {
      this.bus.sendToBackground(payload, this.sender)
      return
    }
    this.bus.sendToContent(this.route.targetId, payload, this.sender)
  }
}

abstract class BasePlaywrightHost extends Disposable {
  protected services: Record<string, RpcService> = {}

  constructor(private hostSide: PlaywrightSide, protected bus: PlaywrightBus, protected log = false) {
    super()
  }

  register<T>(serviceIdentifier: Identifier<T>, serviceInstance: T): void {
    this.services[serviceIdentifier.key] = serviceInstance as unknown as RpcService
    if (this.log) {
      console.log(
        `[crx-rpc/playwright] ${this.hostSide} host registered service "${serviceIdentifier.key}"`
      )
    }
  }

  protected handleIncomingMessage(
    expectedTo: RpcTo,
    hostName: string,
    rawMessage: RpcRequest & { type?: string },
    sender: SenderContext
  ): void {
    if (rawMessage.type === RPC_PING) {
      this.bus.sendToClient(sender.clientId, {
        type: RPC_PONG,
        from: hostName,
      })
      return
    }

    if (rawMessage.type !== RPC_EVENT_NAME) return
    if (rawMessage.to !== expectedTo) return

    const { id, service, method, args } = rawMessage
    const serviceInstance = this.services[service]

    const sendResponse = (response: Omit<RpcResponse, 'from'>) => {
      this.bus.sendToClient(sender.clientId, {
        ...response,
        type: RPC_RESPONSE_EVENT_NAME,
        from: rawMessage.from,
      })
    }

    if (!serviceInstance) {
      sendResponse({
        id,
        error: { message: `Unknown service: ${service}` },
        service,
        method,
      })
      return
    }

    if (!(method in serviceInstance)) {
      sendResponse({
        id,
        error: { message: `Unknown method: ${method}` },
        service,
        method,
      })
      return
    }

    Promise.resolve()
      .then(() => serviceInstance[method](...args))
      .then(result => {
        sendResponse({
          id,
          result,
          service,
          method,
        })
      })
      .catch(error => {
        const rpcError = toRpcErrorLike(error)
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
}

export class PlaywrightBackgroundHost extends BasePlaywrightHost {
  constructor(bus: PlaywrightBus, log = false) {
    super('background', bus, log)
    const dispose = bus.onBackgroundMessage((message, sender) => {
      this.handleIncomingMessage('background', 'background', message, sender)
    })
    this.disposeWithMe(dispose)
  }
}

export class PlaywrightContentHost extends BasePlaywrightHost {
  constructor(
    bus: PlaywrightBus,
    readonly targetId: PlaywrightTargetId,
    log = false
  ) {
    super('content', bus, log)
    const dispose = bus.onContentMessage(targetId, (message, sender) => {
      this.handleIncomingMessage('content', 'content', message, sender)
    })
    this.disposeWithMe(dispose)
  }
}

function mapClientFrom(side: PlaywrightSide): RpcFrom {
  return side === 'background' ? 'wxt-page' : 'runtime'
}

export class PlaywrightRPCClient extends Disposable {
  private readonly backgroundClient: RPCClient
  private readonly contentClients = new Map<string, RPCClient>()

  constructor(
    private readonly bus: PlaywrightBus,
    private readonly options: PlaywrightCreateClientOptions
  ) {
    super()
    this.backgroundClient = this.createLowLevelClient({ to: 'background' })
    this.disposeWithMe(() => this.backgroundClient.dispose())
  }

  private createLowLevelClient(route: AdapterRoute): RPCClient {
    const sender: SenderContext = {
      clientId: randomId(),
      side: this.options.from,
      targetId: route.to === 'content' ? route.targetId : undefined,
    }
    const adapter = new PlaywrightMessageAdapter(this.bus, sender, route)
    return new RPCClient(adapter, mapClientFrom(this.options.from))
  }

  private getOrCreateContentClient(targetId: PlaywrightTargetId): RPCClient {
    const key = String(targetId)
    const cached = this.contentClients.get(key)
    if (cached) return cached

    const client = this.createLowLevelClient({ to: 'content', targetId })
    this.contentClients.set(key, client)
    this.disposeWithMe(() => {
      client.dispose()
      this.contentClients.delete(key)
    })

    return client
  }

  private resolveTargetId(targetId?: PlaywrightTargetId): PlaywrightTargetId {
    const resolved = targetId ?? this.options.defaultTargetId
    if (resolved === undefined || resolved === null || String(resolved).length === 0) {
      throw new Error(
        'targetId is required for content services. ' +
          'Provide createRPCService(identifier, { targetId }) or set defaultTargetId.'
      )
    }
    return resolved
  }

  async createRPCService<T>(
    serviceIdentifier: Identifier<T>,
    options?: PlaywrightCreateServiceOptions
  ): Promise<ServiceProxy<T>> {
    if (serviceIdentifier.to === 'background') {
      return this.backgroundClient.createRPCService(serviceIdentifier)
    }

    const targetId = this.resolveTargetId(options?.targetId)
    const contentClient = this.getOrCreateContentClient(targetId)
    return contentClient.createRPCService(serviceIdentifier)
  }

  async call<T = any>(
    service: string,
    method: string,
    to: RpcTo,
    args: any[],
    options?: PlaywrightCreateServiceOptions
  ): Promise<T> {
    if (to === 'background') {
      return this.backgroundClient.call<T>(service, method, to, args)
    }

    const targetId = this.resolveTargetId(options?.targetId)
    const contentClient = this.getOrCreateContentClient(targetId)
    return contentClient.call<T>(service, method, to, args)
  }
}

export class PlaywrightRPCBridge extends Disposable {
  private readonly bus = new PlaywrightBus()

  createBackgroundHost(log = false): PlaywrightBackgroundHost {
    const host = new PlaywrightBackgroundHost(this.bus, log)
    this.disposeWithMe(() => host.dispose())
    return host
  }

  createContentHost(targetId: PlaywrightTargetId, log = false): PlaywrightContentHost {
    const host = new PlaywrightContentHost(this.bus, targetId, log)
    this.disposeWithMe(() => host.dispose())
    return host
  }

  createClient(options: PlaywrightCreateClientOptions): PlaywrightRPCClient {
    const client = new PlaywrightRPCClient(this.bus, options)
    this.disposeWithMe(() => client.dispose())
    return client
  }
}

export function createPlaywrightBridge(): PlaywrightRPCBridge {
  return new PlaywrightRPCBridge()
}
