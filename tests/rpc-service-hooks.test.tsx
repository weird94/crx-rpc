// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import React, { useEffect } from 'react'
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

interface ChromeTabsTestHarness {
  emitActivated: (activeInfo: chrome.tabs.TabActiveInfo) => void
  emitUpdated: (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab
  ) => Promise<void>
  getMock: (tabId: number) => Promise<chrome.tabs.Tab>
  queryMock: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>
}

const IBackgroundService = createIdentifier<BackgroundService>('background-service', 'background')
const IContentService = createIdentifier<ContentService>('content-service', 'content')

const runtimeCreateServiceMock = vi.fn()
const runtimeDisposeMock = vi.fn()
const tabCreateServiceMock = vi.fn()
const tabDisposeMock = vi.fn()

vi.mock('../src/runtime-client', () => ({
  RuntimeRPCClient: class {
    createRPCService<T>(identifier: Identifier<T>): ServiceProxy<T> {
      return runtimeCreateServiceMock(identifier) as ServiceProxy<T>
    }

    dispose(): void {
      runtimeDisposeMock()
    }
  },
}))

vi.mock('../src/tab-client', () => ({
  TabRPCClient: class {
    private readonly tabId: number

    constructor(tabId: number) {
      this.tabId = tabId
    }

    createRPCService<T>(identifier: Identifier<T>): ServiceProxy<T> {
      return tabCreateServiceMock(this.tabId, identifier) as ServiceProxy<T>
    }

    dispose(): void {
      tabDisposeMock(this.tabId)
    }
  },
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

function createChromeTab(
  tabId: number,
  status: chrome.tabs.Tab['status'],
  url: string
): chrome.tabs.Tab {
  return {
    active: true,
    autoDiscardable: true,
    discarded: false,
    groupId: -1,
    highlighted: true,
    id: tabId,
    incognito: false,
    index: 0,
    pinned: false,
    selected: true,
    status,
    title: url,
    url,
    windowId: 1,
  }
}

function installChromeTabs(
  queryImpl: () => Promise<chrome.tabs.Tab[]>,
  getImpl: (tabId: number) => Promise<chrome.tabs.Tab>
): ChromeTabsTestHarness {
  const activatedListeners = new Set<(activeInfo: chrome.tabs.TabActiveInfo) => void>()
  const updatedListeners = new Set<
    (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void
  >()
  const queryMock = vi.fn((queryInfo: chrome.tabs.QueryInfo) => queryImpl())
  const getMock = vi.fn((tabId: number) => getImpl(tabId))

  Object.defineProperty(globalThis, 'chrome', {
    value: {
      tabs: {
        get: getMock,
        query: queryMock,
        onActivated: {
          addListener: vi.fn((listener: (activeInfo: chrome.tabs.TabActiveInfo) => void) => {
            activatedListeners.add(listener)
          }),
          removeListener: vi.fn((listener: (activeInfo: chrome.tabs.TabActiveInfo) => void) => {
            activatedListeners.delete(listener)
          }),
        },
        onUpdated: {
          addListener: vi.fn(
            (
              listener: (
                tabId: number,
                changeInfo: chrome.tabs.TabChangeInfo,
                tab: chrome.tabs.Tab
              ) => void
            ) => {
              updatedListeners.add(listener)
            }
          ),
          removeListener: vi.fn(
            (
              listener: (
                tabId: number,
                changeInfo: chrome.tabs.TabChangeInfo,
                tab: chrome.tabs.Tab
              ) => void
            ) => {
              updatedListeners.delete(listener)
            }
          ),
        },
      },
    },
    configurable: true,
    writable: true,
  })

  return {
    emitActivated(activeInfo) {
      for (const listener of activatedListeners) {
        listener(activeInfo)
      }
    },
    async emitUpdated(tabId, changeInfo, tab) {
      for (const listener of updatedListeners) {
        listener(tabId, changeInfo, tab)
      }
      await flushMicrotasks()
    },
    getMock,
    queryMock,
  }
}

function BackgroundHarness({
  onService,
}: {
  onService: (service: ServiceProxy<BackgroundService>) => void
}) {
  const service = useBackgroundRPCService(IBackgroundService)

  useEffect(() => {
    onService(service)
  }, [onService, service])

  return null
}

function ContentHarness({ onState }: { onState: (state: ContentHookState) => void }) {
  const state = useContentRPCService(IContentService)

  useEffect(() => {
    onState(state)
  }, [onState, state])

  return null
}

function ContentHarnessWithTabId({
  onState,
  tabId,
}: {
  onState: (state: ContentHookState) => void
  tabId: number
}) {
  const state = useContentRPCService(IContentService, { tabId })

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

  it('creates the background service and disposes the runtime client on unmount', async () => {
    const backgroundService: ServiceProxy<BackgroundService> = {
      ping: vi.fn(async () => 'ready'),
    }

    runtimeCreateServiceMock.mockReturnValue(backgroundService)

    let latestService: ServiceProxy<BackgroundService> | null = null

    await act(async () => {
      root.render(<BackgroundHarness onService={service => (latestService = service)} />)
      await flushMicrotasks()
    })

    expect(latestService).toBe(backgroundService)

    await act(async () => {
      root.unmount()
      await flushMicrotasks()
    })

    expect(runtimeDisposeMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest content service when refresh calls overlap', async () => {
    const firstQuery = createDeferredValue<chrome.tabs.Tab[]>()
    const secondQuery = createDeferredValue<chrome.tabs.Tab[]>()
    let queryCount = 0

    const chromeTabs = installChromeTabs(
      () => {
        queryCount += 1
        return queryCount === 1 ? firstQuery.promise : secondQuery.promise
      },
      async (tabId: number) => createChromeTab(tabId, 'complete', `https://example.com/${tabId}`)
    )

    tabCreateServiceMock.mockImplementation((tabId: number) => {
      return {
        read: vi.fn(async () => `service-${tabId}`),
      }
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

    expect(latestState?.service).not.toBeNull()
    expect(latestState?.tabId).toBe(2)
    const resolvedService = latestState?.service ?? null

    await act(async () => {
      firstQuery.resolve([{ id: 1 } as chrome.tabs.Tab])
      await flushMicrotasks()
    })

    expect(latestState?.service).toBe(resolvedService)
    expect(latestState?.tabId).toBe(2)
    expect(chromeTabs.queryMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the content service null until the initial page load completes', async () => {
    const initialTab = createChromeTab(5, 'loading', 'https://example.com/loading')
    const completedTab = createChromeTab(5, 'complete', 'https://example.com/loading')
    const chromeTabs = installChromeTabs(
      async () => [initialTab],
      async () => initialTab
    )

    tabCreateServiceMock.mockImplementation(() => {
      return {
        read: vi.fn(async () => 'content'),
      }
    })

    let latestState: ContentHookState | null = null

    await act(async () => {
      root.render(<ContentHarnessWithTabId tabId={5} onState={state => (latestState = state)} />)
      await flushMicrotasks()
    })

    expect(latestState?.tabId).toBe(5)
    expect(latestState?.service).toBeNull()
    expect(latestState?.isLoading).toBe(true)

    await act(async () => {
      await chromeTabs.emitUpdated(
        5,
        { status: 'complete', url: completedTab.url },
        completedTab
      )
    })

    expect(latestState?.service).not.toBeNull()
    expect(latestState?.isLoading).toBe(false)
  })

  it('clears the active-tab content service while the current page is loading again', async () => {
    const initialTab = createChromeTab(7, 'complete', 'https://example.com/one')
    const loadingTab = createChromeTab(7, 'loading', 'https://example.com/two')
    const completedTab = createChromeTab(7, 'complete', 'https://example.com/two')
    const chromeTabs = installChromeTabs(
      async () => [initialTab],
      async () => initialTab
    )

    tabCreateServiceMock.mockImplementation(() => {
      return {
        read: vi.fn(async () => 'content'),
      }
    })

    let latestState: ContentHookState | null = null

    await act(async () => {
      root.render(<ContentHarness onState={state => (latestState = state)} />)
      await flushMicrotasks()
    })

    expect(latestState?.service).not.toBeNull()
    expect(latestState?.isLoading).toBe(false)
    const initialService = latestState?.service ?? null

    await act(async () => {
      await chromeTabs.emitUpdated(7, { status: 'loading', url: loadingTab.url }, loadingTab)
    })

    expect(latestState?.tabId).toBe(7)
    expect(latestState?.service).toBeNull()
    expect(latestState?.isLoading).toBe(true)

    await act(async () => {
      await chromeTabs.emitUpdated(
        7,
        { status: 'complete', url: completedTab.url },
        completedTab
      )
    })

    expect(latestState?.service).not.toBeNull()
    expect(latestState?.service).not.toBe(initialService)
    expect(latestState?.isLoading).toBe(false)
  })

  it('clears the provided-tab content service while the observed page is loading again', async () => {
    const initialTab = createChromeTab(9, 'complete', 'https://example.com/start')
    const loadingTab = createChromeTab(9, 'loading', 'https://example.com/next')
    const completedTab = createChromeTab(9, 'complete', 'https://example.com/next')
    const chromeTabs = installChromeTabs(
      async () => [initialTab],
      async (tabId: number) => {
        if (tabId !== 9) {
          throw new Error(`Unexpected tab id: ${tabId}`)
        }
        return initialTab
      }
    )

    tabCreateServiceMock.mockImplementation(() => {
      return {
        read: vi.fn(async () => 'content'),
      }
    })

    let latestState: ContentHookState | null = null

    await act(async () => {
      root.render(<ContentHarnessWithTabId tabId={9} onState={state => (latestState = state)} />)
      await flushMicrotasks()
    })

    expect(latestState?.service).not.toBeNull()
    expect(latestState?.isLoading).toBe(false)
    const initialService = latestState?.service ?? null

    await act(async () => {
      await chromeTabs.emitUpdated(9, { status: 'loading', url: loadingTab.url }, loadingTab)
    })

    expect(latestState?.tabId).toBe(9)
    expect(latestState?.service).toBeNull()
    expect(latestState?.isLoading).toBe(true)

    await act(async () => {
      await chromeTabs.emitUpdated(
        9,
        { status: 'complete', url: completedTab.url },
        completedTab
      )
    })

    expect(latestState?.service).not.toBeNull()
    expect(latestState?.service).not.toBe(initialService)
    expect(latestState?.isLoading).toBe(false)
  })
})
