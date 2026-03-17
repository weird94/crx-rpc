import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHost } from '../src/host'
import { createIdentifier } from '../src/id'
import { createClient } from '../src/unified-client'
import { RPC_EVENT_NAME } from '../src/const'
import type { RpcRequest, RpcTo } from '../src/types'

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
}

function installChrome(chromeLike: ChromeLike): void {
  const globalWithChrome: GlobalWithChrome = globalThis
  globalWithChrome.chrome = chromeLike
}

function clearChrome(): void {
  const globalWithChrome: GlobalWithChrome = globalThis
  delete globalWithChrome.chrome
  delete globalWithChrome.window
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

describe('native request-reply transport', () => {
  beforeEach(() => {
    clearChrome()
  })

  afterEach(() => {
    clearChrome()
    vi.restoreAllMocks()
  })

  it('resolves a background rpc call from the native runtime response', async () => {
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
    const service = await client.createRPCService(IMathService)

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

  it('rejects a content rpc call from the native tab response error payload', async () => {
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
    const service = await client.createRPCService(IReaderService, { tabId: 9 })

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
    const globalWithChrome: GlobalWithChrome = globalThis
    globalWithChrome.window = globalThis

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
})
