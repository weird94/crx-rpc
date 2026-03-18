import { useEffect, useState } from 'react'
import { normalizeTabLoadStatus, type TabLoadStatus } from './utils'

export function useTabStatus(tab: chrome.tabs.Tab | null): TabLoadStatus {
  const [status, setStatus] = useState<TabLoadStatus>(() => normalizeTabLoadStatus(tab?.status))

  useEffect(() => {
    const tabId = tab?.id
    if (typeof tabId !== 'number' || tab == null) {
      setStatus(null)
      return
    }

    setStatus(normalizeTabLoadStatus(tab.status))

    const handleTabUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      updatedTab: chrome.tabs.Tab
    ) => {
      if (updatedTabId !== tabId) {
        return
      }

      if (changeInfo.status != null) {
        setStatus(normalizeTabLoadStatus(changeInfo.status))
        return
      }

      setStatus(normalizeTabLoadStatus(updatedTab.status))
    }

    chrome.tabs.onUpdated.addListener(handleTabUpdated)

    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdated)
    }
  }, [tab?.id, tab?.status])

  return status
}

export default useTabStatus
