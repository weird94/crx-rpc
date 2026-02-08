type RpcErrorLike = {
  message: string
  stack?: string
  name?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function toRpcErrorLike(error: unknown): RpcErrorLike {
  if (error instanceof Error) {
    return {
      message: error.message || 'Unknown error',
      stack: error.stack,
      name: error.name,
    }
  }

  if (isRecord(error)) {
    const recordError = error.error
    if (typeof recordError === 'string' && recordError.trim()) {
      return {
        message: recordError,
        name: 'ErrorPayload',
      }
    }

    const recordMessage = error.message
    if (typeof recordMessage === 'string' && recordMessage.trim()) {
      return {
        message: recordMessage,
        name: typeof error.name === 'string' ? error.name : 'RPCError',
      }
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return {
      message: error,
      name: 'RPCError',
    }
  }

  return {
    message: 'Unknown error',
    name: 'RPCError',
  }
}
