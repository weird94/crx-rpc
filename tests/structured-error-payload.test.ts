/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RPC_EVENT_NAME } from '../src/const'
import { createHost } from '../src/host'
import { createIdentifier } from '../src/id'
import type { RpcRequest } from '../src/types'

interface FailingService {
  fail(): Promise<void>
}

type RuntimeListener = (
  message: RpcRequest & { type?: string },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: object) => void
) => boolean | void

interface ChromeLike {
  runtime: {
    sendMessage: (message: object) => Promise<object>
    onMessage: {
      addListener: (listener: RuntimeListener) => void
      removeListener: (listener: RuntimeListener) => void
    }
  }
  tabs: {
    sendMessage: (tabId: number, message: object) => Promise<object>
  }
}

type GlobalWithChrome = typeof globalThis & {
  chrome?: ChromeLike
}

const IFailingService = createIdentifier<FailingService>('failing-service', 'background')

function installChrome(chromeLike: ChromeLike): void {
  const globalWithChrome: GlobalWithChrome = globalThis
  globalWithChrome.chrome = chromeLike
}

function clearChrome(): void {
  const globalWithChrome: GlobalWithChrome = globalThis
  delete globalWithChrome.chrome
}

describe('structured rpc error payloads', () => {
  beforeEach(() => {
    clearChrome()
  })

  afterEach(() => {
    clearChrome()
    vi.restoreAllMocks()
  })

  it('preserves object error payloads across background host and unified client', async () => {
    let runtimeListener: RuntimeListener | null = null

    installChrome({
      runtime: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
        onMessage: {
          addListener(listener) {
            runtimeListener = listener
          },
          removeListener(listener) {
            if (runtimeListener === listener) {
              runtimeListener = null
            }
          },
        },
      },
      tabs: {
        sendMessage: vi.fn(async () => {
          return { ok: true, result: null }
        }),
      },
    })

    const host = createHost()
    host.register(IFailingService, {
      async fail(): Promise<void> {
        throw {
          error: 'Missing required fields: simpleTree',
        }
      },
    })

    expect(runtimeListener).not.toBeNull()

    const sendResponse = vi.fn<(response: object) => void>()
    const handled = runtimeListener?.(
      {
        id: 'manual-check',
        service: 'failing-service',
        method: 'fail',
        args: [],
        to: 'background',
        from: 'runtime',
        type: RPC_EVENT_NAME,
      } as RpcRequest & { type?: string },
      {},
      sendResponse
    )

    expect(handled).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({
        message: 'Missing required fields: simpleTree',
      }),
    })
  })
})
