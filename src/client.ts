import { RPC_EVENT_NAME, RPC_PING, RPC_PONG, RPC_RESPONSE_EVENT_NAME } from './const'
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
  RpcResponse,
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

type PendingRequest = {
  resolve: (value: RpcTransferable | undefined) => void
  reject: (reason?: Error) => void
}

type PongMessage = {
  type?: string
}

const RPC_READY_TIMEOUT_MS = 300
const RPC_READY_PING_TIMEOUT_MS = 100
const RPC_READY_RETRY_INTERVAL_MS = 50

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
  private pending: Map<string, PendingRequest> = new Map()

  constructor(
    private readonly messageAdapter: IMessageAdapter,
    private readonly from: RpcFrom
  ) {
    super()

    if (messageAdapter.sendRequest) {
      return
    }

    this.disposeWithMe(
      messageAdapter.onMessage<RpcResponse>(RPC_RESPONSE_EVENT_NAME, (event: RpcResponse) => {
        const { id, result, error } = event
        const pendingRequest = this.pending.get(id)
        if (!pendingRequest) {
          return
        }

        this.pending.delete(id)

        if (error) {
          pendingRequest.reject(toNativeRpcError(error))
          return
        }

        pendingRequest.resolve(result)
      })
    )
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

    if (this.messageAdapter.sendRequest) {
      return this.messageAdapter
        .sendRequest<TResult>(request)
        .then(response => fromNativeResponse(response))
        .catch(error =>
          Promise.reject(fromTransportError(error instanceof Error ? error : String(error)))
        )
    }

    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => {
          resolve(value as TResult)
        },
        reject,
      })

      try {
        this.messageAdapter.sendMessage(RPC_EVENT_NAME, request)
      } catch (error) {
        this.pending.delete(id)
        reject(fromTransportError(error instanceof Error ? error : String(error)))
      }
    })
  }

  private async waitReady(timeout = RPC_READY_TIMEOUT_MS): Promise<void> {
    if (this.messageAdapter.sendRequest) {
      return
    }

    const startTime = Date.now()
    const check = async () => {
      return new Promise<boolean>(resolve => {
        let settled = false

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true
            resolve(false)
          }
        }, RPC_READY_PING_TIMEOUT_MS)

        const dispose = this.messageAdapter.onMessage<PongMessage>(RPC_PONG, (message: PongMessage) => {
          if (message.type !== RPC_PONG || settled) {
            return
          }
          settled = true
          clearTimeout(timer)
          dispose()
          resolve(true)
        })

        this.messageAdapter.sendMessage(RPC_PING, { type: RPC_PING })
      })
    }

    while (Date.now() - startTime < timeout) {
      const ready = await check()
      if (ready) {
        return
      }
      await new Promise(resolve => setTimeout(resolve, RPC_READY_RETRY_INTERVAL_MS))
    }

    throw new Error('RPC service not ready (timeout)')
  }

  async createRPCService<T>(serviceIdentifier: Identifier<T>): Promise<ServiceProxy<T>> {
    await this.waitReady()

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
