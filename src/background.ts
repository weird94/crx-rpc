import type { Identifier } from './id'
import {
  OBSERVABLE_EVENT,
  RPC_EVENT_NAME,
  RPC_RESPONSE_EVENT_NAME,
  SUBSCRIBABLE_OBSERVABLE,
  UNSUBSCRIBE_OBSERVABLE,
} from './const'
import type {
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
    const handler = (msg: RpcRequest & { type?: string }, sender: chrome.runtime.MessageSender) => {
      if (msg.type !== RPC_EVENT_NAME) return
      const senderId = sender.tab?.id
      if (!senderId) {
        console.warn('Received RPC request from unknown sender, ignoring.', msg)
        return
      }
      const sendResponse = (response: Omit<RpcResponse, 'from'>) => {
        chrome.tabs.sendMessage(senderId, {
          ...response,
          type: RPC_RESPONSE_EVENT_NAME,
          from: msg.from,
        })
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
            senderId,
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
              senderId,
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
              senderId,
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

      Promise.resolve()
        .then(() => serviceInstance[method](...args))
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
  }

  next(value: T): void {
    if (this.completed) return
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
  private pendingSubscriptions = new Map<string, Set<number>>() // key -> senderIds
  private activeSenders = new Map<string, Set<number>>() // key -> senderIds

  constructor() {
    super()

    const handleMessage = (
      msg: RpcObservableSubscribeMessage,
      sender: chrome.runtime.MessageSender
    ) => {
      if (msg.type === SUBSCRIBABLE_OBSERVABLE) {
        const senderId = sender.tab?.id
        if (!senderId) {
          console.warn('Received RPC request from unknown sender, ignoring.', msg)
          return
        }
        const { key } = msg
        this.handleSubscription(key, senderId)
      }

      if (msg.type === UNSUBSCRIBE_OBSERVABLE) {
        const senderId = sender.tab?.id
        if (!senderId) {
          console.warn('Received RPC request from unknown sender, ignoring.', msg)
          return
        }
        const { key } = msg
        this.handleUnsubscription(key, senderId)
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    this.disposeWithMe(() => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    })

    const handleTabRemove = (tabId: number) => {
      // 清理该 tab 的所有订阅
      this.activeSenders.forEach(senders => {
        senders.delete(tabId)
      })
      this.pendingSubscriptions.forEach(senders => {
        senders.delete(tabId)
      })
    }

    chrome.tabs.onRemoved.addListener(handleTabRemove)
    this.disposeWithMe(() => {
      chrome.tabs.onRemoved.removeListener(handleTabRemove)
    })
  }

  private handleSubscription(key: string, senderId: number) {
    const subject = this.subjects.get(key)

    if (subject) {
      // Subject 已存在，直接处理订阅
      if (!this.activeSenders.has(key)) {
        this.activeSenders.set(key, new Set())
      }
      this.activeSenders.get(key)!.add(senderId)

      // 发送初始值
      chrome.tabs.sendMessage(senderId, {
        operation: 'next',
        key,
        value: subject.getInitialValue(),
      })
    } else {
      // Subject 尚未创建，缓存到待处理队列
      if (!this.pendingSubscriptions.has(key)) {
        this.pendingSubscriptions.set(key, new Set())
      }
      this.pendingSubscriptions.get(key)!.add(senderId)
    }
  }

  private handleUnsubscription(key: string, senderId: number) {
    // 从活跃订阅中移除
    const activeSenders = this.activeSenders.get(key)
    if (activeSenders) {
      activeSenders.delete(senderId)
      if (activeSenders.size === 0) {
        this.activeSenders.delete(key)
      }
    }

    // 从待处理队列中移除
    const pendingSenders = this.pendingSubscriptions.get(key)
    if (pendingSenders) {
      pendingSenders.delete(senderId)
      if (pendingSenders.size === 0) {
        this.pendingSubscriptions.delete(key)
      }
    }
  }

  sendMessage(message: RpcObservableUpdateMessage<any>) {
    const { key } = message

    // 发送到所有订阅的 tabs
    const senders = this.activeSenders.get(key)
    if (senders) {
      senders.forEach(senderId => {
        chrome.tabs.sendMessage(senderId, message)
      })
    }
  }

  createSubject<T>(id: Identifier<T>, key: string, initialValue: T): RemoteSubject<T> {
    const subject = new RemoteSubject<T>(id, key, initialValue, this)
    this.subjects.set(key, subject)

    // 处理待处理的订阅
    const pendingSenders = this.pendingSubscriptions.get(key)
    if (pendingSenders && pendingSenders.size > 0) {
      if (!this.activeSenders.has(key)) {
        this.activeSenders.set(key, new Set())
      }
      const activeSenders = this.activeSenders.get(key)!

      // 将待处理的订阅转移到活跃订阅
      pendingSenders.forEach(senderId => {
        activeSenders.add(senderId)
        // 发送初始值
        chrome.tabs.sendMessage(senderId, {
          operation: 'next',
          key,
          value: initialValue,
        })
      })

      // 清空待处理队列
      this.pendingSubscriptions.delete(key)
    }

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

      // 清理相关的订阅信息
      this.activeSenders.delete(key)
      this.pendingSubscriptions.delete(key)
    }
  }
}
