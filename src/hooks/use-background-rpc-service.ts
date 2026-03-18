import { useEffect, useMemo } from 'react'
import type { ServiceProxy } from '../client'
import type { Identifier } from '../id'
import { RuntimeRPCClient } from '../runtime-client'

interface BackgroundRPCServiceHandle<T> {
  runtimeClient: RuntimeRPCClient
  service: ServiceProxy<T>
}

/**
 * 同步创建并返回 Background RPC 服务代理。
 * 适用于在 content-script/popup/sidepanel 中调用 background script 中注册的服务。
 *
 * @example
 * ```tsx
 * const backgroundService = useBackgroundRPCService(IBackgroundService)
 *
 * const handleFetch = async () => {
 *   const result = await backgroundService.fetchData()
 *   console.log(result)
 * }
 * ```
 */
export function useBackgroundRPCService<T>(serviceIdentifier: Identifier<T>): ServiceProxy<T> {
  const backgroundServiceHandle = useMemo<BackgroundRPCServiceHandle<T>>(() => {
    const runtimeClient = new RuntimeRPCClient()
    return {
      runtimeClient,
      service: runtimeClient.createRPCService(serviceIdentifier),
    }
  }, [serviceIdentifier])

  useEffect(() => {
    return () => {
      backgroundServiceHandle.runtimeClient.dispose()
    }
  }, [backgroundServiceHandle])

  return backgroundServiceHandle.service
}

export default useBackgroundRPCService
