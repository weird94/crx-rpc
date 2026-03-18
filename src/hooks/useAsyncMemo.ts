import { useEffect, useRef, useState, type DependencyList } from 'react'
import { toError } from './utils'

export interface AsyncMemoState<T> {
  error: Error | null
  loading: boolean
  value: T | null
}

export function useAsyncMemo<T>(
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

        setState({
          error: toError(
            error instanceof Error ||
              typeof error === 'string' ||
              (typeof error === 'object' && error !== null)
              ? error
              : String(error)
          ),
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

export default useAsyncMemo
