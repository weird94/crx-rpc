import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DependencyList,
} from 'react'
import type { ServiceProxy } from '../client'
import { type Identifier } from '../id'
import { TabRPCClient } from '../tab-client'

interface UseContentRPCServiceOptions {
  /** 是否在 tabId 变化时自动创建新的服务实例 */
  autoRecreate?: boolean
  tabId?: number
}

interface UseContentRPCServiceResult<T> {
  /** RPC 服务代理实例，可以直接调用服务方法 */
  service: ServiceProxy<T> | null
  /** 当前活动 tab 的 ID */
  tabId: number | null
  /** 是否正在加载/初始化 */
  isLoading: boolean
  /** 错误信息 */
  error: Error | null
  /** 手动刷新服务实例 */
  refresh: () => void
  /** 销毁服务实例 */
  dispose: () => void
}

interface AsyncMemoState<T> {
  error: Error | null
  loading: boolean
  value: T | null
}

const TAB_LOAD_STATUS = {
  Complete: 'complete',
  Loading: 'loading',
} as const

const NO_ACTIVE_TAB_FOUND_ERROR_MESSAGE = 'No active tab found'

type TabLoadStatus = (typeof TAB_LOAD_STATUS)[keyof typeof TAB_LOAD_STATUS] | null

const activeTabChangeStore = {
  listeners: new Set<() => void>(),
  version: 0,
}

const notifyActiveTabChanged = () => {
  activeTabChangeStore.version += 1
  activeTabChangeStore.listeners.forEach(listener => {
    listener()
  })
}

function subscribeActiveTabChange(listener: () => void): () => void {
  activeTabChangeStore.listeners.add(listener)

  if (activeTabChangeStore.listeners.size === 1) {
    chrome.tabs.onActivated.addListener(notifyActiveTabChanged)
  }

  return () => {
    activeTabChangeStore.listeners.delete(listener)

    if (activeTabChangeStore.listeners.size === 0) {
      chrome.tabs.onActivated.removeListener(notifyActiveTabChanged)
    }
  }
}

function getActiveTabChangeVersion(): number {
  return activeTabChangeStore.version
}

function normalizeTabLoadStatus(status: chrome.tabs.Tab['status'] | undefined): TabLoadStatus {
  if (status === TAB_LOAD_STATUS.Complete) {
    return TAB_LOAD_STATUS.Complete
  }

  if (status === TAB_LOAD_STATUS.Loading) {
    return TAB_LOAD_STATUS.Loading
  }

  return null
}

function toError(error: Error | object | string | null | undefined): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

function useAsyncMemo<T>(
  factory: () => Promise<T | null>,
  deps: DependencyList
): AsyncMemoState<T> {
  const [state, setState] = useState<AsyncMemoState<T>>({
    error: null,
    loading: true,
    value: null,
  })
  const requestIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    setState({
      error: null,
      loading: true,
      value: null,
    })

    const loadValue = async (): Promise<void> => {
      try {
        const value = await factory()
        if (cancelled || requestIdRef.current !== requestId) {
          return
        }

        setState({
          error: null,
          loading: false,
          value,
        })
      } catch (error) {
        if (cancelled || requestIdRef.current !== requestId) {
          return
        }

        const nextError =
          error instanceof Error ||
          typeof error === 'string' ||
          (typeof error === 'object' && error !== null)
            ? toError(error)
            : new Error(String(error))

        setState({
          error: nextError,
          loading: false,
          value: null,
        })
      }
    }

    void loadValue()

    return () => {
      cancelled = true
      requestIdRef.current += 1
    }
  }, deps)

  return state
}

function useActiveTabChangeVersion(enabled: boolean): number {
  return useSyncExternalStore(
    onStoreChange => {
      if (!enabled) {
        return () => {}
      }

      return subscribeActiveTabChange(onStoreChange)
    },
    getActiveTabChangeVersion,
    getActiveTabChangeVersion
  )
}

function useTabStatus(tab: chrome.tabs.Tab | null): TabLoadStatus {
  const [status, setStatus] = useState<TabLoadStatus>(() => normalizeTabLoadStatus(tab?.status))

  useEffect(() => {
    const tabId = tab?.id
    if (typeof tabId !== 'number' || tab == null) {
      setStatus(null)
      return
    }

    setStatus(normalizeTabLoadStatus(tab.status))

    const handleTabUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      updatedTab: chrome.tabs.Tab
    ) => {
      if (updatedTabId !== tabId) {
        return
      }

      if (changeInfo.status != null) {
        setStatus(normalizeTabLoadStatus(changeInfo.status))
        return
      }

      setStatus(normalizeTabLoadStatus(updatedTab.status))
    }

    chrome.tabs.onUpdated.addListener(handleTabUpdated)

    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdated)
    }
  }, [tab?.id, tab?.status])

  return status
}

/**
 * 用于创建和管理 RPC 服务实例的 React Hook
 *
 * @example
 * ```tsx
 * // 基础用法 - 使用统一的 TableService
 * const { service, isLoading, error } = useContentRPCService(ITableService)
 *
 * const handleDetect = async () => {
 *   if (!service) return
 *   const result = await service.detectTableLikeElements()
 *   console.log(result)
 * }
 *
 * // TableService 包含所有表格相关功能
 * const handleHighlight = useCallback(async (selector: string, itemSelector: string) => {
 *   await service?.highlightTable(selector, itemSelector)
 * }, [service])
 * ```
 */
export function useContentRPCService<T>(
  serviceIdentifier: Identifier<T>,
  options: UseContentRPCServiceOptions = {}
): UseContentRPCServiceResult<T> {
  const { autoRecreate = true, tabId: providedTabId } = options
  const [isDisposed, setIsDisposed] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const activeTabChangeVersion = useActiveTabChangeVersion(
    providedTabId == null && autoRecreate && !isDisposed
  )
  const tabState = useAsyncMemo(async (): Promise<chrome.tabs.Tab | null> => {
    if (isDisposed) {
      return null
    }

    if (providedTabId != null) {
      return chrome.tabs.get(providedTabId)
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      throw new Error(NO_ACTIVE_TAB_FOUND_ERROR_MESSAGE)
    }

    return chrome.tabs.get(tab.id)
  }, [activeTabChangeVersion, isDisposed, providedTabId, refreshVersion])

  const tabStatus = useTabStatus(tabState.value)
  const serviceState = useMemo((): { error: Error | null; service: ServiceProxy<T> | null } => {
    const resolvedTabId = tabState.value?.id
    if (typeof resolvedTabId !== 'number' || tabState.loading || tabState.value == null) {
      return {
        error: null,
        service: null,
      }
    }

    if (tabStatus !== TAB_LOAD_STATUS.Complete) {
      return {
        error: null,
        service: null,
      }
    }

    const client = new TabRPCClient(resolvedTabId)
    return {
      error: null,
      service: client.createRPCService(serviceIdentifier),
    }
  }, [serviceIdentifier, tabState.loading, tabState.value, tabStatus])

  const refresh = useCallback(() => {
    setIsDisposed(false)
    setRefreshVersion(currentVersion => currentVersion + 1)
  }, [])

  const dispose = useCallback(() => {
    setIsDisposed(true)
  }, [])

  const error = isDisposed ? null : tabState.error ?? serviceState.error
  const tabId = isDisposed ? null : providedTabId ?? tabState.value?.id ?? null
  const isLoading = !isDisposed && (tabState.loading || tabStatus === TAB_LOAD_STATUS.Loading)

  return {
    service: isDisposed ? null : serviceState.service,
    tabId,
    isLoading,
    error,
    refresh,
    dispose,
  }
}

export default useContentRPCService
