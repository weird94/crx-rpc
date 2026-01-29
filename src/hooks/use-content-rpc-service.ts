import { useState, useEffect, useCallback, useRef } from 'react'
import { TabRPCClient } from '../adapter/tab'
import { type Identifier } from '../id'

type FunctionArgs<T> = T extends (...args: infer A) => any ? A : never
type FunctionReturnType<T> = T extends (...args: any[]) => infer R ? R : never

type ServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? (...args: FunctionArgs<T[K]>) => Promise<Awaited<FunctionReturnType<T[K]>>>
    : never
}

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
  refresh: () => Promise<void>
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

  const [service, setService] = useState<ServiceProxy<T> | null>(null)
  const [tabId, setTabId] = useState<number | null>(providedTabId ?? null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const clientRef = useRef<TabRPCClient | null>(null)
  const currentTabIdRef = useRef<number | null>(null)

  const createService = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // 清理旧的 client
      if (clientRef.current) {
        clientRef.current.dispose()
        clientRef.current = null
      }

      // 获取当前活动 tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      if (!tab.id) {
        throw new Error('No active tab found')
      }

      setTabId(tab.id)
      currentTabIdRef.current = tab.id

      // 创建 RPC client 和服务
      const tabClient = new TabRPCClient(tab.id)
      clientRef.current = tabClient

      const rpcService = await tabClient.createRPCService(serviceIdentifier)
      setService(rpcService as ServiceProxy<T>)
    } catch (err) {
      console.error('[useContentRPCService] Failed to create service:', err)
      setError(err instanceof Error ? err : new Error(String(err)))
      setService(null)
    } finally {
      setIsLoading(false)
    }
  }, [serviceIdentifier])

  const dispose = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.dispose()
      clientRef.current = null
    }
    setService(null)
    setTabId(null)
  }, [])

  // 初始化创建服务
  useEffect(() => {
    createService()

    if (providedTabId) {
      return
    }
    // 监听 tab 变化
    const handleTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      if (autoRecreate && activeInfo.tabId !== currentTabIdRef.current) {
        createService()
      }
    }

    chrome.tabs.onActivated.addListener(handleTabActivated)

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabActivated)
      dispose()
    }
  }, [createService, autoRecreate, dispose, providedTabId])

  return {
    service,
    tabId,
    isLoading,
    error,
    refresh: createService,
    dispose,
  }
}

export default useContentRPCService
