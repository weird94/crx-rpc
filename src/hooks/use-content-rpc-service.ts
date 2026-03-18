import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import type { ServiceProxy } from '../client'
import { type Identifier } from '../id'
import { TabRPCClient } from '../tab-client'
import { useActiveTabChangeVersion } from './useActiveTabChangeVersion'
import { useAsyncMemo } from './useAsyncMemo'
import { useTabStatus } from './useTabStatus'
import { NO_ACTIVE_TAB_FOUND_ERROR_MESSAGE, TAB_LOAD_STATUS } from './utils'

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
