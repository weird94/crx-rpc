import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHost } from '../../src/host'
import { createIdentifier } from '../../src/id'
import { createClient } from '../../src/unified-client'
import {
  RPC_EVENT_NAME,
  RPC_REQUEST_RELAY_EVENT_NAME,
  RPC_RESPONSE_EVENT_NAME,
} from '../../src/const'
import type { RpcNativeResponse, RpcRequest, RpcTo } from '../../src/types'

interface MathService {
  add(left: number, right: number): Promise<number>
}

interface ReaderService {
  read(selector: string): Promise<string>
}

class PrototypeMathService implements MathService {
  async add(left: number, right: number): Promise<number> {
    return left + right
  }
}

class StatefulMathService implements MathService {
  private readonly offset: number

  constructor(offset: number) {
    this.offset = offset
  }

  async add(left: number, right: number): Promise<number> {
    return left + right + this.offset
  }
}

const IMathService = createIdentifier<MathService>('math-service', 'background')
const IReaderService = createIdentifier<ReaderService>('reader-service', 'content')

type RuntimeListener = (
  message: RpcRequest & { type?: string },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: object) => void
) => boolean | void

interface ChromeLike {
  runtime: {
    id?: string
    lastError?: { message: string }
    sendMessage: (message: object) => Promise<object>
    onMessage: {
      addListener: (listener: RuntimeListener) => void
      removeListener: (listener: RuntimeListener) => void
    }
  }
  tabs?: {
    sendMessage: (tabId: number, message: object) => Promise<object>
  }
}

type GlobalWithChrome = typeof globalThis & {
  chrome?: ChromeLike
  window?: typeof globalThis
  location?: { href: string }
  addEventListener?: typeof globalThis.addEventListener
  removeEventListener?: typeof globalThis.removeEventListener
  dispatchEvent?: typeof globalThis.dispatchEvent
}

interface RelayResponseDetail {
  type?: string
  id?: string
  response?: RpcNativeResponse
}

function installChrome(chromeLike: ChromeLike): void {
  const globalWithChrome: GlobalWithChrome = globalThis
  globalWithChrome.chrome = chromeLike
}

function clearChrome(): void {
  const globalWithChrome: GlobalWithChrome = globalThis
  delete globalWithChrome.chrome
  delete globalWithChrome.window
  delete globalWithChrome.location
  delete globalWithChrome.addEventListener
  delete globalWithChrome.removeEventListener
  delete globalWithChrome.dispatchEvent
}

function removeChromeOnly(): void {
  const globalWithChrome: GlobalWithChrome = globalThis
  delete globalWithChrome.chrome
}

function installWindowContext(url: string = 'https://example.com/'): void {
  const globalWithChrome: GlobalWithChrome = globalThis
  const eventTarget = new EventTarget()
  globalWithChrome.window = globalThis
  globalWithChrome.location = { href: url }
  globalWithChrome.addEventListener = eventTarget.addEventListener.bind(eventTarget)
  globalWithChrome.removeEventListener = eventTarget.removeEventListener.bind(eventTarget)
  globalWithChrome.dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget)
}

function createRequest(service: string, method: string, to: RpcTo, args: number[] | string[]): RpcRequest {
  return {
    id: 'request-1',
    service,
    method,
    args,
    to,
    from: 'runtime',
  }
}

function flushPromises(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

function createDeferred<TResult>(): {
  promise: Promise<TResult>
  resolve: (value: TResult) => void
} {
  let resolvePromise: ((value: TResult) => void) | undefined
  const promise = new Promise<TResult>(resolve => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve(value: TResult) {
      if (!resolvePromise) {
        throw new Error('Deferred promise was not initialized.')
      }
      resolvePromise(value)
    },
  }
}

describe('native request-reply transport', () => {
  beforeEach(() => {
    clearChrome()
  })

  afterEach(() => {
    clearChrome()
    vi.restoreAllMocks()
  })

  it('returns a background service proxy synchronously and resolves native runtime responses', async () => {
    const runtimeSendMessage = vi.fn(async () => {
      return { ok: true, result: 3 }
    })

    installChrome({
      runtime: {
        sendMessage: runtimeSendMessage,
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
    })

    const client = createClient()
    const service = client.createRPCService(IMathService)

    await expect(service.add(1, 2)).resolves.toBe(3)
    expect(runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RPC_EVENT_NAME,
        service: 'math-service',
        method: 'add',
        to: 'background',
      })
    )
  })

  it('returns a content service proxy synchronously and rejects native tab error payloads', async () => {
    const runtimeSendMessage = vi.fn(async () => {
      return { ok: true, result: null }
    })
    const tabSendMessage = vi.fn(async () => {
      return {
        ok: false,
        error: {
          message: 'selector missing',
          name: 'RPCError',
        },
      }
    })

    installChrome({
      runtime: {
        sendMessage: runtimeSendMessage,
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
      tabs: {
        sendMessage: tabSendMessage,
      },
    })

    const client = createClient()
    const service = client.createRPCService(IReaderService, { tabId: 9 })

    await expect(service.read('#value')).rejects.toThrow('selector missing')
    expect(tabSendMessage).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        type: RPC_EVENT_NAME,
        service: 'reader-service',
        method: 'read',
        to: 'content',
      })
    )
  })

  it('throws synchronously when creating a content service without tabId', () => {
    installChrome({
      runtime: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    const client = createClient()

    expect(() => client.createRPCService(IReaderService)).toThrow(
      'TabId is required when calling content service "reader-service"'
    )
  })

  it('background host replies through sendResponse for async service methods', async () => {
    let listener: RuntimeListener | null = null

    installChrome({
      runtime: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
        onMessage: {
          addListener(nextListener) {
            listener = nextListener
          },
          removeListener() {
            listener = null
          },
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    const host = createHost()
    host.register(IMathService, {
      async add(left: number, right: number): Promise<number> {
        return left + right
      },
    })

    expect(listener).not.toBeNull()

    const sendResponse = vi.fn<(response: object) => void>()
    const handled = listener?.(
      { ...createRequest('math-service', 'add', 'background', [1, 2]), type: RPC_EVENT_NAME },
      {},
      sendResponse
    )

    expect(handled).toBe(true)
    await flushPromises()
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      result: 3,
    })
  })

  it('background host supports class instance methods defined on the prototype', async () => {
    let listener: RuntimeListener | null = null

    installChrome({
      runtime: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
        onMessage: {
          addListener(nextListener) {
            listener = nextListener
          },
          removeListener() {
            listener = null
          },
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    const host = createHost()
    host.register(IMathService, new PrototypeMathService())

    expect(listener).not.toBeNull()

    const sendResponse = vi.fn<(response: object) => void>()
    const handled = listener?.(
      { ...createRequest('math-service', 'add', 'background', [4, 5]), type: RPC_EVENT_NAME },
      {},
      sendResponse
    )

    expect(handled).toBe(true)
    await flushPromises()
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      result: 9,
    })
  })

  it('background host preserves instance context when invoking class methods', async () => {
    let listener: RuntimeListener | null = null

    installChrome({
      runtime: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
        onMessage: {
          addListener(nextListener) {
            listener = nextListener
          },
          removeListener() {
            listener = null
          },
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    const host = createHost()
    host.register(IMathService, new StatefulMathService(10))

    expect(listener).not.toBeNull()

    const sendResponse = vi.fn<(response: object) => void>()
    const handled = listener?.(
      { ...createRequest('math-service', 'add', 'background', [4, 5]), type: RPC_EVENT_NAME },
      {},
      sendResponse
    )

    expect(handled).toBe(true)
    await flushPromises()
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      result: 19,
    })
  })

  it('content host replies through sendResponse for async service methods', async () => {
    let listener: RuntimeListener | null = null
    installWindowContext()

    installChrome({
      runtime: {
        id: 'runtime-id',
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
        onMessage: {
          addListener(nextListener) {
            listener = nextListener
          },
          removeListener() {
            listener = null
          },
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    const host = createHost()
    host.register(IReaderService, {
      async read(selector: string): Promise<string> {
        return `value:${selector}`
      },
    })

    expect(listener).not.toBeNull()

    const sendResponse = vi.fn<(response: object) => void>()
    const handled = listener?.(
      { ...createRequest('reader-service', 'read', 'content', ['#value']), type: RPC_EVENT_NAME },
      { id: 'runtime-id' },
      sendResponse
    )

    expect(handled).toBe(true)
    await flushPromises()
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      result: 'value:#value',
    })
  })

  it('web client calls content service through request relay custom events', async () => {
    let listener: RuntimeListener | null = null
    installWindowContext()

    installChrome({
      runtime: {
        id: 'runtime-id',
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
        onMessage: {
          addListener(nextListener) {
            listener = nextListener
          },
          removeListener() {
            listener = null
          },
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    const host = createHost()
    host.register(IReaderService, {
      async read(selector: string): Promise<string> {
        return `content:${selector}`
      },
    })

    const chromeRef = globalThis.chrome
    removeChromeOnly()

    const client = createClient()
    const service = client.createRPCService(IReaderService)

    installChrome(chromeRef!)
    void listener

    await expect(service.read('#app')).resolves.toBe('content:#app')
  })

  it('web client relays background service calls through content runtime messaging', async () => {
    installWindowContext()

    const runtimeSendMessage = vi.fn(async (message: RpcRequest & { type?: string }) => {
      expect(message.to).toBe('background')
      expect(message.from).toBe('web')
      return { ok: true, result: 42 }
    })

    installChrome({
      runtime: {
        id: 'runtime-id',
        sendMessage: runtimeSendMessage,
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    createHost()

    const chromeRef = globalThis.chrome
    removeChromeOnly()

    const requestSpy = vi.fn()
    window.addEventListener(RPC_REQUEST_RELAY_EVENT_NAME, requestSpy as EventListener)

    const client = createClient()
    const service = client.createRPCService(IMathService)

    installChrome(chromeRef!)

    await expect(service.add(20, 22)).resolves.toBe(42)
    expect(requestSpy).toHaveBeenCalledTimes(1)
    expect(runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: RPC_EVENT_NAME,
        service: 'math-service',
        method: 'add',
        to: 'background',
        from: 'web',
      })
    )
  })

  it('content host ignores runtime messages targeted to background services', async () => {
    let listener: RuntimeListener | null = null
    installWindowContext()

    installChrome({
      runtime: {
        id: 'runtime-id',
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
        onMessage: {
          addListener(nextListener) {
            listener = nextListener
          },
          removeListener() {
            listener = null
          },
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    createHost()

    expect(listener).not.toBeNull()

    const sendResponse = vi.fn<(response: object) => void>()
    const handled = listener?.(
      { ...createRequest('math-service', 'add', 'background', [1, 2]), type: RPC_EVENT_NAME },
      { id: 'runtime-id' },
      sendResponse
    )

    expect(handled).toBe(false)
    await flushPromises()
    expect(sendResponse).not.toHaveBeenCalled()
  })

  it('content web relay forwards background-target requests without local service handling', async () => {
    installWindowContext()
    const backgroundResponse = createDeferred<RpcNativeResponse<number>>()

    const runtimeSendMessage = vi.fn((message: RpcRequest & { type?: string }) => {
      expect(message.to).toBe('background')
      expect(message.from).toBe('web')
      return backgroundResponse.promise
    })

    installChrome({
      runtime: {
        id: 'runtime-id',
        sendMessage: runtimeSendMessage,
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    const host = createHost()
    const localAdd = vi.fn(async (left: number, right: number) => {
      return left + right
    })
    host.register(IMathService, {
      add: localAdd,
    })

    const responseSpy = vi.fn((event: Event) => {
      const customEvent = event as CustomEvent<RelayResponseDetail>
      return customEvent.detail
    })

    window.addEventListener(RPC_RESPONSE_EVENT_NAME, responseSpy as EventListener)

    window.dispatchEvent(
      new CustomEvent(RPC_REQUEST_RELAY_EVENT_NAME, {
        detail: {
          ...createRequest('math-service', 'add', 'background', [20, 22]),
          from: 'web',
          type: RPC_EVENT_NAME,
        },
      })
    )

    await flushPromises()
    expect(runtimeSendMessage).toHaveBeenCalledTimes(1)
    expect(localAdd).not.toHaveBeenCalled()
    expect(responseSpy).not.toHaveBeenCalled()

    backgroundResponse.resolve({
      ok: true,
      result: 42,
    })
    await flushPromises()

    expect(responseSpy).toHaveBeenCalledTimes(1)
    expect(responseSpy).toHaveReturnedWith({
      type: RPC_EVENT_NAME,
      id: 'request-1',
      response: {
        ok: true,
        result: 42,
      },
    })

    window.removeEventListener(RPC_RESPONSE_EVENT_NAME, responseSpy as EventListener)
  })

  it('content web relay handles content-target requests locally', async () => {
    installWindowContext()

    installChrome({
      runtime: {
        id: 'runtime-id',
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    const host = createHost()
    host.register(IReaderService, {
      async read(selector: string): Promise<string> {
        return `content:${selector}`
      },
    })

    const responseSpy = vi.fn((event: Event) => {
      const customEvent = event as CustomEvent<RelayResponseDetail>
      return customEvent.detail
    })

    window.addEventListener(RPC_RESPONSE_EVENT_NAME, responseSpy as EventListener)

    window.dispatchEvent(
      new CustomEvent(RPC_REQUEST_RELAY_EVENT_NAME, {
        detail: {
          ...createRequest('reader-service', 'read', 'content', ['#app']),
          from: 'web',
          type: RPC_EVENT_NAME,
        },
      })
    )

    await flushPromises()

    expect(responseSpy).toHaveBeenCalledTimes(1)
    expect(responseSpy).toHaveReturnedWith({
      type: RPC_EVENT_NAME,
      id: 'request-1',
      response: {
        ok: true,
        result: 'content:#app',
      },
    })

    window.removeEventListener(RPC_RESPONSE_EVENT_NAME, responseSpy as EventListener)
  })

  it('background host ignores runtime messages targeted to content services', async () => {
    let listener: RuntimeListener | null = null

    installChrome({
      runtime: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
        onMessage: {
          addListener(nextListener) {
            listener = nextListener
          },
          removeListener() {
            listener = null
          },
        },
      },
    })

    createHost()

    expect(listener).not.toBeNull()

    const sendResponse = vi.fn<(response: object) => void>()
    const handled = listener?.(
      { ...createRequest('reader-service', 'read', 'content', ['#app']), type: RPC_EVENT_NAME },
      {},
      sendResponse
    )

    expect(handled).toBe(false)
    await flushPromises()
    expect(sendResponse).not.toHaveBeenCalled()
  })
})
