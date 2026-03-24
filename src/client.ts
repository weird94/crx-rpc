import { Disposable } from './disposable'
import { toRpcErrorLike } from './error'
import type { Identifier } from './id'
import { randomId } from './tool'
import type {
  IMessageAdapter,
  RpcErrorPayload,
  RpcFrom,
  RpcNativeResponse,
  RpcRequest,
  RpcTo,
  RpcTransferable,
} from './types'

type FunctionArgs<T> = T extends (...args: infer A) => infer _R ? A : never
type FunctionReturnType<T> = T extends (...args: infer _A) => infer R ? R : never

export type ServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never
}

function toNativeRpcError(error: RpcErrorPayload): Error {
  const nativeError = new Error(error.message)
  nativeError.name = error.name || 'RPCError'
  if (error.stack) {
    nativeError.stack = error.stack
  }
  return nativeError
}

function fromNativeResponse<TResult extends RpcTransferable>(
  response: RpcNativeResponse<TResult>
): Promise<TResult> {
  if (response.ok) {
    return Promise.resolve(response.result)
  }
  return Promise.reject(toNativeRpcError(response.error))
}

function fromTransportError(error: Error | object | string): Error {
  const rpcError = toRpcErrorLike(error)
  return toNativeRpcError({
    message: rpcError.message,
    name: rpcError.name,
    stack: rpcError.stack,
  })
}

export class RPCClient extends Disposable {
  constructor(
    private readonly messageAdapter: IMessageAdapter,
    private readonly from: RpcFrom
  ) {
    super()
  }

  call<TResult extends RpcTransferable = RpcTransferable>(
    service: string,
    method: string,
    to: RpcTo,
    args: RpcTransferable[]
  ): Promise<TResult> {
    const id = randomId()
    const request: RpcRequest = {
      method,
      args,
      id,
      service,
      to,
      from: this.from,
    }

    return this.messageAdapter
      .sendRequest<TResult>(request)
      .then(response => fromNativeResponse(response))
      .catch(error => Promise.reject(fromTransportError(error)))
  }

  createRPCService<T>(serviceIdentifier: Identifier<T>): ServiceProxy<T> {
    const serviceKey = serviceIdentifier.key

    return new Proxy(Object.create(null) as ServiceProxy<T>, {
      get: (_target, prop: string | symbol) => {
        if (prop === 'then') {
          return undefined
        }
        if (typeof prop !== 'string') {
          return undefined
        }

        return (...args: FunctionArgs<T[keyof T]>) => {
          return this.call(
            serviceKey,
            prop,
            serviceIdentifier.to,
            args as RpcTransferable[]
          ) as Promise<Awaited<FunctionReturnType<T[keyof T]>>>
        }
      },
    })
  }
}
