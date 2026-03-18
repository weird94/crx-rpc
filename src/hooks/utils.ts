export const TAB_LOAD_STATUS = {
  Complete: 'complete',
  Loading: 'loading',
} as const

export const NO_ACTIVE_TAB_FOUND_ERROR_MESSAGE = 'No active tab found'

export type TabLoadStatus = (typeof TAB_LOAD_STATUS)[keyof typeof TAB_LOAD_STATUS] | null

export function normalizeTabLoadStatus(
  status: chrome.tabs.Tab['status'] | undefined
): TabLoadStatus {
  if (status === TAB_LOAD_STATUS.Complete) {
    return TAB_LOAD_STATUS.Complete
  }

  if (status === TAB_LOAD_STATUS.Loading) {
    return TAB_LOAD_STATUS.Loading
  }

  return null
}

export function toError(error: Error | object | string | null | undefined): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
