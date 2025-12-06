import type { Identifier } from './id'
import {
  OBSERVABLE_EVENT,
  RPC_EVENT_NAME,
  RPC_RESPONSE_EVENT_NAME,
  SUBSCRIBABLE_OBSERVABLE,
  UNSUBSCRIBE_OBSERVABLE,
} from './const'
import type {
  RpcContext,
  RpcRequest,
  RpcResponse,
  RpcService,
  SubjectLike,
  RpcObservableUpdateMessage,
  RpcObservableSubscribeMessage,
} from './types'
import { Disposable } from './disposable'

export class BackgroundRPCHost extends Disposable {
  private services: Record<string, RpcService> = {}

  constructor(private log: boolean = false) {
    super()
    const handler = (
      msg: RpcRequest & { type?: string },
      sender: chrome.runtime.MessageSender,
      sendResponseCallback: (response?: any) => void
    ) => {
      if (msg.type !== RPC_EVENT_NAME) return false

      const tabId = sender.tab?.id
      const isFromRuntime = !tabId // sidepanel/popup 没有 tab id

      // 根据来源选择不同的响应方式
      const sendResponse = (response: Omit<RpcResponse, 'from'>) => {
        const fullResponse = {
          ...response,
          type: RPC_RESPONSE_EVENT_NAME,
          from: msg.from,
        }

        if (isFromRuntime) {
          // 来自 sidepanel/popup，使用 runtime.sendMessage 广播响应
          // 这样 RuntimeRPCClient 的 onMessage 可以收到
          chrome.runtime.sendMessage(fullResponse).catch(() => {
            // 忽略错误，可能没有监听者
          })
        } else {
          // 来自 content script，使用 tabs.sendMessage
          chrome.tabs.sendMessage(tabId, fullResponse)
        }
      }

      const { id, method, args, service } = msg
      const serviceInstance = this.services[service]

      if (this.log) {
        console.log(
          `%c RPC %c Call: %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
          'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;', // [RPC] 紫色背景
          'color: #6b7280; font-weight: 500;', // Call: 灰色
          'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // service 绿色背景
          'color: #6b7280; font-weight: 500;', // .
          'background: #dc2626; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // method 红色背景
          'color: #6b7280; font-weight: 500;', // [
          'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // id 蓝色背景
          'color: #6b7280; font-weight: 500;', // ]
          {
            args,
            from: isFromRuntime ? 'runtime' : `tab:${tabId}`,
            timestamp: new Date().toISOString(),
          }
        )
      }

      if (!serviceInstance) {
        if (this.log) {
          console.warn(
            `%c RPC %c Unknown service: %c ${service} %c [%c ${id} %c]`,
            'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;', // [RPC] 紫色背景
            'color: #d97706; font-weight: bold;', // Unknown service: 橙色
            'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // service 绿色背景
            'color: #6b7280; font-weight: 500;', // [
            'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // id 蓝色背景
            'color: #6b7280; font-weight: 500;', // ]
            {
              from: isFromRuntime ? 'runtime' : `tab:${tabId}`,
              timestamp: new Date().toISOString(),
            }
          )
        }
        const resp = {
          id,
          error: { message: `Unknown service: ${service}` },
          service,
          method,
        }
        sendResponse(resp)
        return true
      }

      if (!(method in serviceInstance)) {
        if (this.log) {
          console.warn(
            `%c RPC %c Unknown method: %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
            'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;', // [RPC] 紫色背景
            'color: #d97706; font-weight: bold;', // Unknown method: 橙色
            'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // service 绿色背景
            'color: #6b7280; font-weight: 500;', // .
            'background: #dc2626; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // method 红色背景
            'color: #6b7280; font-weight: 500;', // [
            'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // id 蓝色背景
            'color: #6b7280; font-weight: 500;', // ]
            {
              from: isFromRuntime ? 'runtime' : `tab:${tabId}`,
              timestamp: new Date().toISOString(),
            }
          )
        }
        const resp = {
          id,
          error: { message: `Unknown method: ${method}` },
          service,
          method,
        }
        sendResponse(resp)
        return true
      }

      // 构建 RPC 上下文，自动注入到 service 方法的最后一个参数
      const rpcContext: RpcContext = {
        tabId,
        sender,
        isFromRuntime,
      }

      Promise.resolve()
        .then(() => serviceInstance[method](...args, rpcContext))
        .then(result => {
          if (this.log) {
            console.log(
              `%c RPC %c Success: %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
              'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;', // [RPC] 紫色背景
              'color: #16a34a; font-weight: bold;', // Success: 绿色
              'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // service 绿色背景
              'color: #6b7280; font-weight: 500;', // .
              'background: #dc2626; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // method 红色背景
              'color: #6b7280; font-weight: 500;', // [
              'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // id 蓝色背景
              'color: #6b7280; font-weight: 500;', // ]
              {
                result,
                timestamp: new Date().toISOString(),
              }
            )
          }
          sendResponse({
            id,
            result,
            service,
            method,
          })
        })
        .catch(err => {
          if (this.log) {
            console.error(
              `%c RPC %c Error: %c ${service} %c.%c ${method} %c [%c ${id} %c]`,
              'background: #6b46c1; color: white; font-weight: bold; padding: 2px 4px; border-radius: 3px;', // [RPC] 紫色背景
              'color: #dc2626; font-weight: bold;', // Error: 红色
              'background: #059669; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // service 绿色背景
              'color: #6b7280; font-weight: 500;', // .
              'background: #dc2626; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // method 红色背景
              'color: #6b7280; font-weight: 500;', // [
              'background: #2563eb; color: white; font-weight: bold; padding: 1px 4px; border-radius: 2px;', // id 蓝色背景
              'color: #6b7280; font-weight: 500;', // ]
              {
                error: err.message,
                timestamp: new Date().toISOString(),
              }
            )
          } else {
            console.error('RPC Error:', service, method, err)
          }
          sendResponse({
            id,
            error: {
              message: err.message,
              stack: err.stack,
              name: err.name,
            },
            service,
            method,
          })
        })

      return true // 异步 sendResponse
    }

    chrome.runtime.onMessage.addListener(handler)
    this.disposeWithMe(() => {
      chrome.runtime.onMessage.removeListener(handler)
    })
  }

  register<T>(service: Identifier<T>, serviceInstance: T) {
    this.services[service.key] = serviceInstance as unknown as RpcService
  }
}

export class RemoteSubject<T> extends Disposable implements SubjectLike<T> {
  private completed = false

  private _value: T

  get finalKey() {
    return `${this.identifier.key}-${this._key}`
  }

  constructor(
    private identifier: Identifier<T>,
    private _key: string,
    private initialValue: T,
    private manager: RemoteSubjectManager
  ) {
    super()
    this._value = initialValue
  }

  get value(): T {
    return this._value
  }

  next(value: T): void {
    if (this.completed) return
    this._value = value
    this.manager.sendMessage({
      operation: 'next',
      key: this.finalKey,
      value,
      type: OBSERVABLE_EVENT,
    })
  }

  complete(): void {
    if (this.completed) return
    this.completed = true
    this.manager.sendMessage({
      operation: 'complete',
      key: this.finalKey,
      type: OBSERVABLE_EVENT,
    })
  }

  subscribe(): () => void {
    throw new Error('RemoteSubject should not be subscribed locally.')
  }

  getInitialValue(): T {
    return this.initialValue
  }
}

export class RemoteSubjectManager extends Disposable {
  private subjects = new Map<string, RemoteSubject<any>>()

  constructor() {
    super()

    const handleMessage = (
      msg: RpcObservableSubscribeMessage,
      sender: chrome.runtime.MessageSender
    ) => {
      if (msg.type === SUBSCRIBABLE_OBSERVABLE) {
        const { key } = msg
        this.handleSubscription(key)
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    this.disposeWithMe(() => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    })
  }

  private handleSubscription(key: string) {
    const subject = this.subjects.get(key)
    console.log(
      '===handleSubscription key:',
      key,
      'subject exists:',
      !!subject,
      'all keys:',
      Array.from(this.subjects.keys())
    )

    if (subject) {
      // 发送初始值 - 使用广播方式，这样订阅者的 onMessage 才能收到
      console.log('===sending initial value for key:', key, 'value:', subject.getInitialValue())
      chrome.runtime
        .sendMessage({
          operation: 'next',
          key,
          value: subject.getInitialValue(),
          type: OBSERVABLE_EVENT,
        })
        .catch(() => {
          // 忽略错误，可能没有监听者
        })
    }
  }

  sendMessage(message: RpcObservableUpdateMessage<any>) {
    console.log('===RemoteSubjectManager sendMessage:', message)
    chrome.runtime.sendMessage(message)
  }

  createSubject<T>(id: Identifier<T>, key: string, initialValue: T): RemoteSubject<T> {
    const subject = new RemoteSubject<T>(id, key, initialValue, this)
    // 使用 finalKey 作为存储 key，与客户端订阅时发送的 key 保持一致
    this.subjects.set(subject.finalKey, subject)

    chrome.runtime.sendMessage({
      operation: 'next',
      key: subject.finalKey,
      value: initialValue,
      type: OBSERVABLE_EVENT,
    })
    return subject
  }

  getSubject<T>(key: string): RemoteSubject<T> | undefined {
    return this.subjects.get(key) as RemoteSubject<T> | undefined
  }

  removeSubject(key: string): void {
    const subject = this.subjects.get(key)
    if (subject) {
      subject.dispose()
      this.subjects.delete(key)
    }
  }
}
