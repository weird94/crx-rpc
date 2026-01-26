const globalScope =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
      ? self
      : typeof window !== 'undefined'
        ? window
        : ({} as any)

function getBrowserNamespace() {
  return globalScope && typeof globalScope === 'object' ? (globalScope as any).browser : undefined
}

function getChromeNamespace() {
  return globalScope && typeof globalScope === 'object' ? (globalScope as any).chrome : undefined
}

interface RuntimeInfo {
  api: typeof chrome.runtime | undefined
  isBrowser: boolean
}

interface TabsInfo {
  api: typeof chrome.tabs | undefined
  isBrowser: boolean
}

function getRuntime(): RuntimeInfo {
  const browserNs = getBrowserNamespace()
  if (browserNs && browserNs.runtime) {
    return { api: browserNs.runtime, isBrowser: true }
  }
  const chromeNs = getChromeNamespace()
  if (chromeNs && chromeNs.runtime) {
    return { api: chromeNs.runtime, isBrowser: false }
  }
  return { api: undefined, isBrowser: false }
}

function getTabs(): TabsInfo {
  const browserNs = getBrowserNamespace()
  if (browserNs && browserNs.tabs) {
    return { api: browserNs.tabs, isBrowser: true }
  }
  const chromeNs = getChromeNamespace()
  if (chromeNs && chromeNs.tabs) {
    return { api: chromeNs.tabs, isBrowser: false }
  }
  return { api: undefined, isBrowser: false }
}

function getLastError() {
  const chromeNs = getChromeNamespace()
  if (chromeNs && chromeNs.runtime && chromeNs.runtime.lastError) {
    return chromeNs.runtime.lastError
  }
  const browserNs = getBrowserNamespace()
  if (browserNs && browserNs.runtime && browserNs.runtime.lastError) {
    return browserNs.runtime.lastError
  }
  return undefined
}

function isPromise(value: any): value is Promise<any> {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof value.then === 'function'
  )
}

function sendRuntimeMessage(
  runtime: typeof chrome.runtime | undefined,
  isBrowser: boolean,
  message: any
): Promise<void> {
  if (!runtime || !runtime.sendMessage) {
    return Promise.reject(new Error('WebExtension runtime API is not available.'))
  }

  if (isBrowser) {
    try {
      const result = runtime.sendMessage(message)
      if (isPromise(result)) {
        return result.then(() => undefined)
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  return new Promise((resolve, reject) => {
    try {
      runtime.sendMessage(message, () => {
        const lastError = getLastError()
        if (lastError) {
          reject(new Error(lastError.message))
        } else {
          resolve()
        }
      })
    } catch (error) {
      reject(error)
    }
  })
}

function sendTabMessage(
  tabs: typeof chrome.tabs | undefined,
  isBrowser: boolean,
  tabId: number,
  message: any
): Promise<void> {
  if (!tabs || !tabs.sendMessage) {
    return Promise.reject(new Error('WebExtension tabs API is not available.'))
  }

  if (isBrowser) {
    try {
      const result = tabs.sendMessage(tabId, message)
      if (isPromise(result)) {
        return result.then(() => undefined)
      }
    } catch (error) {
      return Promise.reject(error)
    }
  }

  return new Promise((resolve, reject) => {
    try {
      tabs.sendMessage(tabId, message, () => {
        const lastError = getLastError()
        if (lastError) {
          reject(new Error(lastError.message))
        } else {
          resolve()
        }
      })
    } catch (error) {
      reject(error)
    }
  })
}

export interface RuntimeMessageChannel<TMessage = any> {
  sendMessage(message: TMessage): Promise<void>
  onMessage(
    handler: (
      message: TMessage,
      sender: chrome.runtime.MessageSender
    ) => boolean | void | Promise<void>
  ): () => void
}

export interface TabMessageChannel<TMessage = any> {
  sendMessage(message: TMessage): Promise<void>
}

export type TabRemovedHandler = (tabId: number, removeInfo?: chrome.tabs.TabRemoveInfo) => void

export function createRuntimeMessageChannel<TMessage = any>(): RuntimeMessageChannel<TMessage> {
  const runtimeInfo = getRuntime()
  const runtime = runtimeInfo.api

  return {
    sendMessage(message: TMessage) {
      return sendRuntimeMessage(runtime, runtimeInfo.isBrowser, message)
    },
    onMessage(
      handler: (message: TMessage, sender: chrome.runtime.MessageSender) => void | Promise<void>
    ) {
      if (!runtime || !runtime.onMessage || !runtime.onMessage.addListener) {
        return () => {}
      }
      const listener = (message: TMessage, sender: chrome.runtime.MessageSender) => {
        try {
          const result = handler(message, sender)
          if (isPromise(result)) {
            result.catch(error => {
              console.error('[webext-core/messaging] listener rejected', error)
            })
          }
        } catch (error) {
          console.error('[webext-core/messaging] listener threw', error)
        }
      }
      runtime.onMessage.addListener(listener)
      return () => {
        runtime.onMessage.removeListener(listener)
      }
    },
  }
}

export function createTabMessageChannel<TMessage = any>(
  tabId: number
): TabMessageChannel<TMessage> {
  const tabsInfo = getTabs()
  const tabs = tabsInfo.api

  return {
    sendMessage(message: TMessage) {
      return sendTabMessage(tabs, tabsInfo.isBrowser, tabId, message)
    },
  }
}

export function onTabRemoved(handler: TabRemovedHandler): () => void {
  const tabsInfo = getTabs()
  const tabs = tabsInfo.api

  if (!tabs || !tabs.onRemoved || !tabs.onRemoved.addListener) {
    return () => {}
  }

  const listener = (tabId: number, ...rest: any[]) => {
    try {
      handler(tabId, ...rest)
    } catch (error) {
      console.error('[webext-core/messaging] tab removed handler error', error)
    }
  }

  tabs.onRemoved.addListener(listener)
  return () => {
    tabs.onRemoved.removeListener(listener)
  }
}
