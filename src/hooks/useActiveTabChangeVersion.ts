import { useSyncExternalStore } from 'react'

const activeTabChangeStore = {
  listeners: new Set<() => void>(),
  version: 0,
}

const notifyActiveTabChanged = () => {
  activeTabChangeStore.version += 1
  activeTabChangeStore.listeners.forEach(listener => {
    listener()
  })
}

function subscribeActiveTabChange(listener: () => void): () => void {
  activeTabChangeStore.listeners.add(listener)

  if (activeTabChangeStore.listeners.size === 1) {
    chrome.tabs.onActivated.addListener(notifyActiveTabChanged)
  }

  return () => {
    activeTabChangeStore.listeners.delete(listener)

    if (activeTabChangeStore.listeners.size === 0) {
      chrome.tabs.onActivated.removeListener(notifyActiveTabChanged)
    }
  }
}

function getActiveTabChangeVersion(): number {
  return activeTabChangeStore.version
}

export function useActiveTabChangeVersion(enabled: boolean): number {
  return useSyncExternalStore(
    onStoreChange => {
      if (!enabled) {
        return () => {}
      }

      return subscribeActiveTabChange(onStoreChange)
    },
    getActiveTabChangeVersion,
    getActiveTabChangeVersion
  )
}

export default useActiveTabChangeVersion
