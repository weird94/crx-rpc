import { useState, useEffect, useCallback, useRef } from 'react'
import { RuntimeRPCClient } from '../adapter/runtime'
import { type Identifier } from '../id'

type FunctionArgs<T> = T extends (...args: infer A) => any ? A : never
type FunctionReturnType<T> = T extends (...args: any[]) => infer R ? R : never

type ServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? (...args: FunctionArgs<T[K]>) => Promise<Awaited<FunctionReturnType<T[K]>>>
    : never
}

interface UseBackgroundRPCServiceResult<T> {
  /** RPC 服务代理实例，可以直接调用服务方法 */
  service: ServiceProxy<T> | null
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
 * 用于创建和管理 Background RPC 服务实例的 React Hook
 * 适用于在 content-script/popup/sidepanel 中调用 background script 中注册的服务
 *
 * @example
 * ```tsx
 * // 基础用法 - 调用 background 中的服务
 * const { service, isLoading, error } = useBackgroundRPCService(IBackgroundService)
 *
 * const handleFetch = async () => {
 *   if (!service) return
 *   const result = await service.fetchData()
 *   console.log(result)
 * }
 * ```
 */
export function useBackgroundRPCService<T>(
  serviceIdentifier: Identifier<T>
): UseBackgroundRPCServiceResult<T> {
  const [service, setService] = useState<ServiceProxy<T> | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const clientRef = useRef<RuntimeRPCClient | null>(null)

  const createService = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // 清理旧的 client
      if (clientRef.current) {
        clientRef.current.dispose()
        clientRef.current = null
      }

      // 创建 RPC client 和服务
      const runtimeClient = new RuntimeRPCClient()
      clientRef.current = runtimeClient

      const rpcService = await runtimeClient.createRPCService(serviceIdentifier)
      setService(rpcService as ServiceProxy<T>)
    } catch (err) {
      console.error('[useBackgroundRPCService] Failed to create service:', err)
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
  }, [])

  // 初始化创建服务
  useEffect(() => {
    createService()

    return () => {
      dispose()
    }
  }, [createService, dispose])

  return {
    service,
    isLoading,
    error,
    refresh: createService,
    dispose,
  }
}

export default useBackgroundRPCService
