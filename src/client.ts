import {
  OBSERVABLE_EVENT,
  RPC_EVENT_NAME,
  RPC_PING,
  RPC_PONG,
  RPC_RESPONSE_EVENT_NAME,
  SUBSCRIBABLE_OBSERVABLE,
  UNSUBSCRIBE_OBSERVABLE,
} from './const'
import type {
  RpcRequest,
  RpcResponse,
  RpcObservableUpdateMessage,
  IMessageAdapter,
  RpcTo,
  RpcFrom,
} from './types'
import type { Identifier } from './id'
import { Disposable } from './disposable'
import { randomId } from './tool'

// 类型工具：提取函数类型的参数和返回值类型
type FunctionArgs<T> = T extends (...args: infer A) => any ? A : never
type FunctionReturnType<T> = T extends (...args: any[]) => infer R ? R : never

// 类型工具：将服务接口转换为客户端代理类型
type ServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? (...args: FunctionArgs<T[K]>) => Promise<Awaited<FunctionReturnType<T[K]>>>
    : never
}

export class RPCClient extends Disposable {
  private pending: Map<
    string,
    {
      resolve: (value: any) => void
      reject: (reason?: any) => void
    }
  > = new Map()

  constructor(
    private messageAdapter: IMessageAdapter,
    private from: RpcFrom
  ) {
    super()
    this.disposeWithMe(
      messageAdapter.onMessage<RpcResponse>(RPC_RESPONSE_EVENT_NAME, (event: RpcResponse) => {
        const { id, result, error } = event as RpcResponse
        const promise = this.pending.get(id)
        if (!promise) return

        this.pending.delete(id)

        if (error) {
          const err = new Error(error.message)
          err.name = error.name || 'RPCError'
          err.stack = error.stack
          promise.reject(err)
        } else {
          promise.resolve(result)
        }
      })
    )
  }

  call<T = any>(service: string, method: string, to: RpcTo, args: any[]): Promise<T> {
    const id = randomId()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const requestParam: RpcRequest = {
        method,
        args,
        id,
        service,
        to,
        from: this.from,
      }
      this.messageAdapter.sendMessage(RPC_EVENT_NAME, requestParam)
    })
  }

  private async waitReady(timeout = 10000): Promise<void> {
    const startTime = Date.now()
    const check = async () => {
      return new Promise<boolean>(resolve => {
        let resolved = false
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true
            resolve(false)
          }
        }, 1000)

        const handler = (msg: any) => {
          if (msg.type === RPC_PONG) {
            if (!resolved) {
              resolved = true
              resolve(true)
            }
            dispose()
          }
        }

        const dispose = this.messageAdapter.onMessage(RPC_PONG, handler)
        this.messageAdapter.sendMessage(RPC_PING, { type: RPC_PING })
      })
    }

    while (Date.now() - startTime < timeout) {
      const ready = await check()
      if (ready) return
      await new Promise(r => setTimeout(r, 500))
    }

    throw new Error('RPC service not ready (timeout)')
  }

  async createRPCService<T>(serviceIdentifier: Identifier<T>): Promise<ServiceProxy<T>> {
    const serviceKey = serviceIdentifier.key

    await this.waitReady()

    // 创建代理对象，拦截方法调用
    return new Proxy({} as ServiceProxy<T>, {
      get: (target, prop: string | symbol) => {
        if (prop === 'then') {
          return undefined
        }
        if (typeof prop === 'string') {
          // 返回一个代理函数
          return (...args: any[]) => {
            return this.call(serviceKey, prop, serviceIdentifier.to, args)
          }
        }
        return (target as any)[prop]
      },
    })
  }
}

export class BaseObservable<T> extends Disposable {
  private listeners = new Set<(value: T) => void>()
  private completed = false

  private get _finalKey() {
    return `${this.identifier.key}-${this.key}`
  }

  constructor(
    private identifier: Identifier<T>,
    private key: string,
    private _callback: (value: T) => void,
    private _adapter: IMessageAdapter
  ) {
    super()
    this.disposeWithMe(
      this._adapter.onMessage(OBSERVABLE_EVENT, (event: any) => {
        // 支持两种格式：直接消息对象（runtime adapter）或 CustomEvent detail（web adapter）
        const msg = (event.detail ?? event) as RpcObservableUpdateMessage<T>
        if (msg.key !== this._finalKey) return

        if (msg.operation === 'next' && !this.completed && msg.value) {
          this._callback(msg.value)
        }

        if (msg.operation === 'complete') {
          this.completed = true
          this.listeners.clear()
        }
      })
    )

    this._adapter.sendMessage(SUBSCRIBABLE_OBSERVABLE, { key: this._finalKey })
  }

  unsubscribe(): void {
    this._adapter.sendMessage(UNSUBSCRIBE_OBSERVABLE, { key: this._finalKey })
  }
}
