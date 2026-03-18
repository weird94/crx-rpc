import { RPCClient } from '../client'
import { Disposable } from '../disposable'
import { toRpcErrorLike } from '../error'
import type { Identifier } from '../id'
import { randomId } from '../tool'
import type {
  IMessageAdapter,
  RpcFrom,
  RpcNativeResponse,
  RpcRequest,
  RpcService,
  RpcTo,
  RpcTransferable,
} from '../types'

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

type HostListener = (
  message: RpcRequest,
  sender: SenderContext
) => Promise<RpcNativeResponse<RpcTransferable> | undefined>

function createSuccessResponse<TResult extends RpcTransferable>(
  result: TResult
): RpcNativeResponse<TResult> {
  return {
    ok: true,
    result,
  }
}

function createErrorResponse(error: { message: string; name?: string; stack?: string }): RpcNativeResponse {
  return {
    ok: false,
    error,
  }
}

class PlaywrightBus {
  private backgroundListeners = new Set<HostListener>()
  private contentListeners = new Map<string, Set<HostListener>>()

  private targetKey(targetId: PlaywrightTargetId): string {
    return String(targetId)
  }

  private async safeInvoke(
    listener: HostListener,
    message: RpcRequest,
    sender: SenderContext
  ): Promise<RpcNativeResponse<RpcTransferable> | undefined> {
    try {
      return await listener(message, sender)
    } catch (error) {
      console.error('[crx-rpc/playwright] listener error', error)
      const rpcError = toRpcErrorLike(error instanceof Error ? error : String(error))
      return createErrorResponse({
        message: rpcError.message,
        name: rpcError.name,
        stack: rpcError.stack,
      })
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

  private async dispatchRequest(
    listeners: Iterable<HostListener>,
    message: RpcRequest,
    sender: SenderContext,
    missingHostMessage: string
  ): Promise<RpcNativeResponse<RpcTransferable>> {
    for (const listener of listeners) {
      const response = await this.safeInvoke(listener, message, sender)
      if (response !== undefined) {
        return response
      }
    }

    return createErrorResponse({ message: missingHostMessage })
  }

  sendToBackground(
    message: RpcRequest,
    sender: SenderContext
  ): Promise<RpcNativeResponse<RpcTransferable>> {
    return this.dispatchRequest(
      this.backgroundListeners,
      message,
      sender,
      'No background RPC host handled request'
    )
  }

  sendToContent(
    targetId: PlaywrightTargetId,
    message: RpcRequest,
    sender: SenderContext
  ): Promise<RpcNativeResponse<RpcTransferable>> {
    const listeners = this.contentListeners.get(this.targetKey(targetId))
    if (!listeners) {
      return Promise.resolve(
        createErrorResponse({
          message: `No content RPC host handled request for target "${String(targetId)}"`,
        })
      )
    }

    return this.dispatchRequest(
      listeners,
      message,
      sender,
      `No content RPC host handled request for target "${String(targetId)}"`
    )
  }
}

type AdapterRoute =
  | { to: 'background' }
  | {
      to: 'content'
      targetId: PlaywrightTargetId
    }

class PlaywrightRequestSender implements IMessageAdapter {
  constructor(
    private bus: PlaywrightBus,
    private sender: SenderContext,
    private route: AdapterRoute
  ) {}

  sendRequest<TResult extends RpcTransferable>(
    request: RpcRequest
  ): Promise<RpcNativeResponse<TResult>> {
    if (this.route.to === 'background') {
      return this.bus.sendToBackground(request, this.sender) as Promise<RpcNativeResponse<TResult>>
    }

    return this.bus.sendToContent(this.route.targetId, request, this.sender) as Promise<
      RpcNativeResponse<TResult>
    >
  }
}

abstract class BasePlaywrightHost extends Disposable {
  protected services: Record<string, RpcService> = {}

  constructor(
    private hostSide: PlaywrightSide,
    protected bus: PlaywrightBus,
    protected log = false
  ) {
    super()
  }

  register<T>(serviceIdentifier: Identifier<T>, serviceInstance: T): void {
    this.services[serviceIdentifier.key] = serviceInstance as RpcService
    if (this.log) {
      console.log(
        `[crx-rpc/playwright] ${this.hostSide} host registered service "${serviceIdentifier.key}"`
      )
    }
  }

  protected async handleIncomingRequest(
    expectedTo: RpcTo,
    rawMessage: RpcRequest,
    sender: SenderContext
  ): Promise<RpcNativeResponse<RpcTransferable> | undefined> {
    if (rawMessage.to !== expectedTo) {
      return undefined
    }

    const { id, service, method, args } = rawMessage
    const serviceInstance = this.services[service]
    const serviceMethod = serviceInstance?.[method]

    if (!serviceInstance) {
      return createErrorResponse({
        message: `Unknown service: ${service}`,
      })
    }

    if (typeof serviceMethod !== 'function') {
      return createErrorResponse({
        message: `Unknown method: ${method}`,
      })
    }

    void id
    void sender

    try {
      const result = await serviceMethod.apply(serviceInstance, args)
      return createSuccessResponse(result)
    } catch (error) {
      const rpcError = toRpcErrorLike(error instanceof Error ? error : String(error))
      return createErrorResponse({
        message: rpcError.message,
        stack: rpcError.stack,
        name: rpcError.name,
      })
    }
  }
}

export class PlaywrightBackgroundHost extends BasePlaywrightHost {
  constructor(bus: PlaywrightBus, log = false) {
    super('background', bus, log)
    const dispose = bus.onBackgroundMessage((message, sender) => {
      return this.handleIncomingRequest('background', message, sender)
    })
    this.disposeWithMe(dispose)
  }
}

/**
 * Playwright Page interface — only the subset we need, so we don't require
 * the full `@playwright/test` package as a hard dependency.
 */
export interface PlaywrightPage {
  evaluate<R>(fn: string | ((...args: any[]) => R), arg?: any): Promise<R>
  addInitScript(script: string | { content: string }): Promise<void>
}

/** The runtime injected into the browser page via page.evaluate / page.addInitScript */
const BROWSER_RUNTIME_SCRIPT = /* js */ `
if (!window.__crxRpc) {
  window.__crxRpc = {
    _services: {},
    register: function(key, impl) {
      this._services[key] = impl;
    },
    call: async function(service, method, args) {
      var svc = this._services[service];
      if (!svc) return { error: { message: 'Unknown service: ' + service } };
      if (!(method in svc)) return { error: { message: 'Unknown method: ' + method } };
      try {
        var result = await svc[method].apply(svc, args);
        return { result: result };
      } catch (e) {
        return { error: { message: e.message, name: e.name, stack: e.stack } };
      }
    }
  };
}
`

/**
 * Converts a service interface so that methods may return either a plain value
 * or a Promise — useful when writing sync browser implementations of
 * Promise-typed interfaces.
 */
type SyncImpl<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => R | Promise<R>
    : T[K]
}

type BrowserRuntimeOutcome = {
  result?: RpcTransferable
  error?: {
    message: string
    name?: string
    stack?: string
  }
}

type BrowserRuntimeWindow = Window & {
  __crxRpc?: {
    call(
      service: string,
      method: string,
      args: RpcTransferable[]
    ): Promise<BrowserRuntimeOutcome>
    register(key: string, impl: object): void
  }
}

/**
 * A content host that runs registered services **inside the browser page**.
 * Service implementations have full access to `document`, `window`, etc.
 *
 * Usage:
 * ```ts
 * const contentHost = await bridge.createContentHost(page, 'tab-1')
 *
 * await contentHost.register(IMyService, () => ({
 *   getText(selector: string) {
 *     return document.querySelector(selector)?.textContent ?? null
 *   }
 * }))
 * ```
 *
 * ⚠️  The factory passed to `register` is serialised with `.toString()`
 * and executed inside the browser — it cannot close over Node.js variables.
 */
export class PlaywrightPageContentHost extends Disposable {
  constructor(
    private readonly bus: PlaywrightBus,
    private readonly page: PlaywrightPage,
    readonly targetId: PlaywrightTargetId,
    private readonly log = false
  ) {
    super()

    const dispose = bus.onContentMessage(
      targetId,
      (rawMessage: RpcRequest, sender: SenderContext) => {
        return this.handleIncomingRequest(rawMessage, sender)
      }
    )
    this.disposeWithMe(dispose)
  }

  private async handleIncomingRequest(
    rawMessage: RpcRequest,
    sender: SenderContext
  ): Promise<RpcNativeResponse<RpcTransferable> | undefined> {
    if (rawMessage.to !== 'content') {
      return undefined
    }

    const { service, method, args } = rawMessage

    if (this.log) {
      console.log(`[crx-rpc/playwright] content host dispatching ${service}.${method} to page`)
    }

    void sender

    try {
      const outcome = await this.page.evaluate(
        ({
          service,
          method,
          args,
        }: {
          service: string
          method: string
          args: RpcTransferable[]
        }) => {
          const browserWindow = window as BrowserRuntimeWindow
          return (
            browserWindow.__crxRpc?.call(service, method, args) ??
            Promise.resolve<BrowserRuntimeOutcome>({
              error: {
                message: 'Playwright RPC runtime not initialized',
              },
            })
          )
        },
        { service, method, args }
      )

      if (outcome.error) {
        return createErrorResponse(outcome.error)
      }

      return createSuccessResponse(outcome.result)
    } catch (error) {
      const rpcError = toRpcErrorLike(error instanceof Error ? error : String(error))
      return createErrorResponse({
        message: rpcError.message,
        name: rpcError.name,
        stack: rpcError.stack,
      })
    }
  }

  /**
   * Register a service implementation **inside the browser page**.
   *
   * The `factory` function is serialised via `.toString()` and evaluated in
   * the page context.  It must be self-contained — no closures over Node.js
   * variables are allowed.
   *
   * @example
   * await contentHost.register(IContentService, () => ({
   *   getText(selector: string) {
   *     return document.querySelector(selector)?.textContent ?? null
   *   }
   * }))
   */
  async register<T>(serviceIdentifier: Identifier<T>, factory: () => SyncImpl<T>): Promise<void> {
    const key = serviceIdentifier.key
    const factoryStr = factory.toString()

    await this.page.evaluate(
      ({ key, factoryStr }: { key: string; factoryStr: string }) => {
        const impl = new Function(`return (${factoryStr})`)()()
        const browserWindow = window as BrowserRuntimeWindow
        if (!browserWindow.__crxRpc) {
          throw new Error('Playwright RPC runtime not initialized')
        }
        browserWindow.__crxRpc.register(key, impl as object)
      },
      { key, factoryStr }
    )

    if (this.log) {
      console.log(`[crx-rpc/playwright] content host registered service "${key}" in browser page`)
    }
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
    const requestSender = new PlaywrightRequestSender(this.bus, sender, route)
    return new RPCClient(requestSender, mapClientFrom(this.options.from))
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

  async call<T extends RpcTransferable = RpcTransferable>(
    service: string,
    method: string,
    to: RpcTo,
    args: RpcTransferable[],
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

  /**
   * Create a content host backed by a real Playwright browser page.
   * Services registered via `register()` run inside the page with
   * full access to `document`, `window`, etc.
   *
   * This method is async because it injects the `window.__crxRpc` runtime
   * into the current document before returning. If the page navigates or
   * reloads, call `createContentHost()` again and re-register page services.
   */
  async createContentHost(
    page: PlaywrightPage,
    targetId: PlaywrightTargetId,
    log = false
  ): Promise<PlaywrightPageContentHost> {
    // Inject the browser-side RPC runtime
    await page.evaluate(BROWSER_RUNTIME_SCRIPT)

    const host = new PlaywrightPageContentHost(this.bus, page, targetId, log)
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
