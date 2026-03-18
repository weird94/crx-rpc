// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceProxy } from '../src/client'
import { createIdentifier, type Identifier } from '../src/id'
import { useBackgroundRPCService } from '../src/hooks/use-background-rpc-service'
import { useContentRPCService } from '../src/hooks/use-content-rpc-service'

interface BackgroundService {
  ping(): Promise<string>
}

interface ContentService {
  read(): Promise<string>
}

interface BackgroundHookState {
  service: ServiceProxy<BackgroundService> | null
  isLoading: boolean
  error: Error | null
  refresh: () => void
  dispose: () => void
}

interface ContentHookState {
  service: ServiceProxy<ContentService> | null
  tabId: number | null
  isLoading: boolean
  error: Error | null
  refresh: () => void
  dispose: () => void
}

interface DeferredValue<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

const IBackgroundService = createIdentifier<BackgroundService>('background-service', 'background')
const IContentService = createIdentifier<ContentService>('content-service', 'content')

const runtimeCreateServiceMock = vi.fn()
const runtimeDisposeMock = vi.fn()
const tabCreateServiceMock = vi.fn()
const tabDisposeMock = vi.fn()

class MockRuntimeRPCClient {
  createRPCService<T>(identifier: Identifier<T>): ServiceProxy<T> {
    return runtimeCreateServiceMock(identifier) as ServiceProxy<T>
  }

  dispose(): void {
    runtimeDisposeMock()
  }
}

class MockTabRPCClient {
  constructor(private readonly tabId: number) {}

  createRPCService<T>(identifier: Identifier<T>): ServiceProxy<T> {
    return tabCreateServiceMock(this.tabId, identifier) as ServiceProxy<T>
  }

  dispose(): void {
    tabDisposeMock(this.tabId)
  }
}

vi.mock('../src/runtime-client', () => ({
  RuntimeRPCClient: MockRuntimeRPCClient,
}))

vi.mock('../src/tab-client', () => ({
  TabRPCClient: MockTabRPCClient,
}))

function createDeferredValue<T>(): DeferredValue<T> {
  let resolveValue: ((value: T) => void) | null = null

  const promise = new Promise<T>(resolve => {
    resolveValue = resolve
  })

  if (!resolveValue) {
    throw new Error('Deferred resolve was not initialized')
  }

  return {
    promise,
    resolve: resolveValue,
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, 0)
  })
}

function installChromeTabs(queryImpl: () => Promise<chrome.tabs.Tab[]>): void {
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      tabs: {
        query: vi.fn(queryImpl),
        onActivated: {
          addListener: vi.fn(() => {}),
          removeListener: vi.fn(() => {}),
        },
      },
    },
    configurable: true,
    writable: true,
  })
}

function BackgroundHarness({ onState }: { onState: (state: BackgroundHookState) => void }) {
  const state = useBackgroundRPCService(IBackgroundService)

  useEffect(() => {
    onState(state)
  }, [onState, state])

  return null
}

function ContentHarness({ onState }: { onState: (state: ContentHookState) => void }) {
  const state = useContentRPCService(IContentService)

  useEffect(() => {
    onState(state)
  }, [onState, state])

  return null
}

describe('RPC service hooks', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    Reflect.deleteProperty(globalThis, 'chrome')
  })

  it('recreates the background service with a fresh client on refresh', async () => {
    const firstService: ServiceProxy<BackgroundService> = {
      ping: vi.fn(async () => 'first'),
    }
    const secondService: ServiceProxy<BackgroundService> = {
      ping: vi.fn(async () => 'second'),
    }

    runtimeCreateServiceMock.mockReturnValueOnce(firstService).mockReturnValueOnce(secondService)

    let latestState: BackgroundHookState | null = null

    await act(async () => {
      root.render(<BackgroundHarness onState={state => (latestState = state)} />)
      await flushMicrotasks()
    })

    expect(latestState?.service).toBe(firstService)
    expect(latestState?.isLoading).toBe(false)

    await act(async () => {
      latestState?.refresh()
      await flushMicrotasks()
    })

    expect(latestState?.service).toBe(secondService)
    expect(runtimeDisposeMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest content service when refresh calls overlap', async () => {
    const firstQuery = createDeferredValue<chrome.tabs.Tab[]>()
    const secondQuery = createDeferredValue<chrome.tabs.Tab[]>()
    let queryCount = 0

    installChromeTabs(() => {
      queryCount += 1
      return queryCount === 1 ? firstQuery.promise : secondQuery.promise
    })

    const firstService: ServiceProxy<ContentService> = {
      read: vi.fn(async () => 'first'),
    }
    const secondService: ServiceProxy<ContentService> = {
      read: vi.fn(async () => 'second'),
    }

    tabCreateServiceMock.mockImplementation((tabId: number) => {
      return tabId === 1 ? firstService : secondService
    })

    let latestState: ContentHookState | null = null

    await act(async () => {
      root.render(<ContentHarness onState={state => (latestState = state)} />)
      await flushMicrotasks()
    })

    expect(latestState?.service).toBeNull()
    expect(latestState?.isLoading).toBe(true)

    await act(async () => {
      latestState?.refresh()
      await flushMicrotasks()
    })

    await act(async () => {
      secondQuery.resolve([{ id: 2 } as chrome.tabs.Tab])
      await flushMicrotasks()
    })

    expect(latestState?.service).toBe(secondService)
    expect(latestState?.tabId).toBe(2)

    await act(async () => {
      firstQuery.resolve([{ id: 1 } as chrome.tabs.Tab])
      await flushMicrotasks()
    })

    expect(latestState?.service).toBe(secondService)
    expect(latestState?.tabId).toBe(2)
    expect(tabDisposeMock).toHaveBeenCalledWith(1)
  })
})
