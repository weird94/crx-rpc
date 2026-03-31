import type { RpcErrorPayload } from './types'

type RpcErrorLike = {
  message: string
  stack?: string
  name?: string
}

function createRpcErrorLike(message: string, name?: string, stack?: string): RpcErrorLike {
  const rpcError: RpcErrorLike = { message }

  if (typeof name === 'string') {
    rpcError.name = name
  }

  if (typeof stack === 'string') {
    rpcError.stack = stack
  }

  return rpcError
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function toRpcErrorLike(error: unknown): RpcErrorLike {
  if (error instanceof Error) {
    return createRpcErrorLike(error.message || 'Unknown error', error.name, error.stack)
  }

  if (isRecord(error)) {
    const recordError = error.error
    if (typeof recordError === 'string' && recordError.trim()) {
      return createRpcErrorLike(recordError, 'ErrorPayload')
    }

    const recordMessage = error.message
    if (typeof recordMessage === 'string' && recordMessage.trim()) {
      return createRpcErrorLike(
        recordMessage,
        typeof error.name === 'string' ? error.name : 'RPCError'
      )
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return createRpcErrorLike(error, 'RPCError')
  }

  return createRpcErrorLike('Unknown error', 'RPCError')
}

export function toRpcErrorPayload(error: unknown): RpcErrorPayload {
  const rpcError = toRpcErrorLike(error)
  const payload: RpcErrorPayload = { message: rpcError.message }

  if (typeof rpcError.name === 'string') {
    payload.name = rpcError.name
  }

  if (typeof rpcError.stack === 'string') {
    payload.stack = rpcError.stack
  }

  return payload
}
