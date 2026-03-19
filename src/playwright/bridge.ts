import { attachServiceAccessor, BaseService } from '../base-service'
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

import type { ServiceProxy } from '../client'

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

/**
 * Playwright Page interface — only the subset we need, so we don't require
 * the full `@playwright/test` package as a hard dependency.
 */
export interface PlaywrightPage {
  evaluate<R>(fn: string | ((...args: any[]) => R), arg?: any): Promise<R>
}

export class PlaywrightPageService extends BaseService {
  private page?: PlaywrightPage

  setPage(page: PlaywrightPage): void {
    this.page = page
  }

  protected evaluate<TResult, TArg = undefined>(
    pageFunction: (arg: TArg) => TResult | Promise<TResult>,
    arg?: TArg
  ): Promise<Awaited<TResult>> {
    if (!this.page) {
      return Promise.reject(new Error('Playwright page is not available. Register the service first.'))
    }

    return this.page.evaluate(pageFunction, arg) as Promise<Awaited<TResult>>
  }
}

function attachPlaywrightPage(service: unknown, page: PlaywrightPage): void {
  if (service instanceof PlaywrightPageService) {
    service.setPage(page)
  }
}

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
type BrowserFactoryRegistration = {
  type: 'factory'
  factoryStr: string
}

type InstanceRegistration = {
  type: 'instance'
  service: RpcService
}

type PlaywrightContentServiceRegistration = BrowserFactoryRegistration | InstanceRegistration

export class PlaywrightPageContentHost extends Disposable {
  private readonly services = new Map<string, PlaywrightContentServiceRegistration>()
  private readonly serviceClient: PlaywrightRPCClient

  constructor(
    private readonly bus: PlaywrightBus,
    private readonly page: PlaywrightPage,
    readonly targetId: PlaywrightTargetId,
    private readonly log = false
  ) {
    super()
    this.serviceClient = new PlaywrightRPCClient(this.bus, {
      from: 'content',
      defaultTargetId: targetId,
    })
    this.disposeWithMe(() => this.serviceClient.dispose())

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
    const registration = this.services.get(service)

    if (!registration) {
      return createErrorResponse({
        message: `Unknown service: ${service}`,
      })
    }

    if (this.log) {
      console.log(`[crx-rpc/playwright] content host dispatching ${service}.${method}`)
    }

    void sender

    if (registration.type === 'instance') {
      const serviceMethod = registration.service[method]

      if (typeof serviceMethod !== 'function') {
        return createErrorResponse({
          message: `Unknown method: ${method}`,
        })
      }

      try {
        const result = await serviceMethod.apply(registration.service, args)
        return createSuccessResponse(result)
      } catch (error) {
        const rpcError = toRpcErrorLike(error instanceof Error ? error : String(error))
        return createErrorResponse({
          message: rpcError.message,
          name: rpcError.name,
          stack: rpcError.stack,
        })
      }
    }

    try {
      const outcome = await this.page.evaluate(
        ({
          factoryStr,
          method,
          args,
        }: {
          factoryStr: string
          method: string
          args: RpcTransferable[]
        }) => {
          const createService = new Function(`return (${factoryStr})`) as () => () => Record<string, unknown>
          const service = createService()()
          const serviceMethod = service[method]

          if (typeof serviceMethod !== 'function') {
            return Promise.resolve<BrowserRuntimeOutcome>({
              error: {
                message: `Unknown method: ${method}`,
              },
            })
          }

          return Promise.resolve()
            .then(() =>
              (serviceMethod as (...serviceArgs: RpcTransferable[]) => unknown).apply(service, args)
            )
            .then(result => ({ result }))
            .catch((error: unknown) => {
              const browserError = error as { message?: string; name?: string; stack?: string }
              return {
                error: {
                  message: browserError?.message ?? String(error),
                  name: browserError?.name,
                  stack: browserError?.stack,
                },
              }
            })
        },
        { factoryStr: registration.factoryStr, method, args }
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
   * Register a content service.
   *
   * Pass a self-contained factory to execute the service inside `page.evaluate()`,
   * or pass a `PlaywrightPageService`/`BaseService`-style instance to share the
   * same `getService()` composition model used by extension-side services.
   *
   * @example
   * await contentHost.register(IContentService, () => ({
   *   getText(selector: string) {
   *     return document.querySelector(selector)?.textContent ?? null
   *   }
   * }))
   */
  async register<T>(
    serviceIdentifier: Identifier<T>,
    serviceOrFactory: T | (() => SyncImpl<T>)
  ): Promise<void> {
    const key = serviceIdentifier.key

    if (typeof serviceOrFactory === 'function') {
      this.services.set(key, {
        type: 'factory',
        factoryStr: serviceOrFactory.toString(),
      })

      if (this.log) {
        console.log(
          `[crx-rpc/playwright] content host registered factory service "${key}" for page.evaluate dispatch`
        )
      }

      return
    }

    attachServiceAccessor(serviceOrFactory, this.serviceClient)
    attachPlaywrightPage(serviceOrFactory, this.page)
    this.services.set(key, {
      type: 'instance',
      service: serviceOrFactory as RpcService,
    })

    if (this.log) {
      console.log(`[crx-rpc/playwright] content host registered service instance "${key}"`)
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

  createRPCService<T>(
    serviceIdentifier: Identifier<T>,
    options?: PlaywrightCreateServiceOptions
  ): ServiceProxy<T> {
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

export class PlaywrightBackgroundHost extends BasePlaywrightHost {
  private readonly serviceClient: PlaywrightRPCClient

  constructor(bus: PlaywrightBus, log = false) {
    super('background', bus, log)
    this.serviceClient = new PlaywrightRPCClient(bus, { from: 'background' })
    this.disposeWithMe(() => this.serviceClient.dispose())
    const dispose = bus.onBackgroundMessage((message, sender) => {
      return this.handleIncomingRequest('background', message, sender)
    })
    this.disposeWithMe(dispose)
  }

  override register<T>(serviceIdentifier: Identifier<T>, serviceInstance: T): void {
    attachServiceAccessor(serviceInstance, this.serviceClient)
    super.register(serviceIdentifier, serviceInstance)
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
   * This method is async to preserve API compatibility with earlier versions.
   * No browser-side runtime is injected; content service calls execute through
   * `page.evaluate()` on demand. After navigation or reload, existing hosts can
   * continue to work as long as the registered factories remain valid.
   */
  async createContentHost(
    page: PlaywrightPage,
    targetId: PlaywrightTargetId,
    log = false
  ): Promise<PlaywrightPageContentHost> {
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
