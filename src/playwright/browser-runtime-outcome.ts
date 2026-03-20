import type { RpcErrorPayload, RpcTransferable } from '../types'

export const BROWSER_RUNTIME_OUTCOME_KIND_RESULT = 'result'
export const BROWSER_RUNTIME_OUTCOME_KIND_ERROR = 'error'
export const INVALID_BROWSER_RUNTIME_OUTCOME_MESSAGE =
  'Browser runtime returned an invalid outcome'

const BROWSER_RUNTIME_OUTCOME_RESULT_FIELD = 'result'

export type BrowserRuntimeOutcomeCandidate = {
  kind?: RpcTransferable
  result?: RpcTransferable
  error?: RpcTransferable
}

export type BrowserRuntimeSuccessOutcome = {
  kind: typeof BROWSER_RUNTIME_OUTCOME_KIND_RESULT
  result: RpcTransferable
}

export type BrowserRuntimeErrorOutcome = {
  kind: typeof BROWSER_RUNTIME_OUTCOME_KIND_ERROR
  error: RpcErrorPayload
}

export type BrowserRuntimeOutcome = BrowserRuntimeSuccessOutcome | BrowserRuntimeErrorOutcome

function isTransferableRecord(
  value: RpcTransferable | undefined
): value is Record<string, RpcTransferable | undefined> {
  return typeof value === 'object' && value !== null
}

function isRpcErrorPayload(value: RpcTransferable | undefined): value is RpcErrorPayload {
  if (!isTransferableRecord(value)) {
    return false
  }

  if (typeof value.message !== 'string') {
    return false
  }

  if (value.name !== undefined && typeof value.name !== 'string') {
    return false
  }

  if (value.stack !== undefined && typeof value.stack !== 'string') {
    return false
  }

  return true
}

function hasResultField(
  candidate: BrowserRuntimeOutcomeCandidate
): candidate is BrowserRuntimeOutcomeCandidate & { result: RpcTransferable } {
  return Object.hasOwn(candidate, BROWSER_RUNTIME_OUTCOME_RESULT_FIELD)
}

export function toBrowserRuntimeOutcome(
  candidate: BrowserRuntimeOutcomeCandidate
): BrowserRuntimeOutcome {
  if (candidate.kind === BROWSER_RUNTIME_OUTCOME_KIND_RESULT && hasResultField(candidate)) {
    return {
      kind: BROWSER_RUNTIME_OUTCOME_KIND_RESULT,
      result: candidate.result,
    }
  }

  if (candidate.kind === BROWSER_RUNTIME_OUTCOME_KIND_ERROR && isRpcErrorPayload(candidate.error)) {
    return {
      kind: BROWSER_RUNTIME_OUTCOME_KIND_ERROR,
      error: candidate.error,
    }
  }

  return {
    kind: BROWSER_RUNTIME_OUTCOME_KIND_ERROR,
    error: {
      message: INVALID_BROWSER_RUNTIME_OUTCOME_MESSAGE,
    },
  }
}
