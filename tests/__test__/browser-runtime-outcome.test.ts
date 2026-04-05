import { describe, expect, it } from 'vitest'
import {
  BROWSER_RUNTIME_OUTCOME_KIND_ERROR,
  BROWSER_RUNTIME_OUTCOME_KIND_RESULT,
  INVALID_BROWSER_RUNTIME_OUTCOME_MESSAGE,
  toBrowserRuntimeOutcome,
} from '../../src/playwright/browser-runtime-outcome'

describe('toBrowserRuntimeOutcome', () => {
  it('returns a result outcome when the browser returns a value', () => {
    expect(
      toBrowserRuntimeOutcome({
        kind: BROWSER_RUNTIME_OUTCOME_KIND_RESULT,
        result: 'value',
      })
    ).toEqual({
      kind: BROWSER_RUNTIME_OUTCOME_KIND_RESULT,
      result: 'value',
    })
  })

  it('preserves explicit undefined results from the browser runtime', () => {
    expect(
      toBrowserRuntimeOutcome({
        kind: BROWSER_RUNTIME_OUTCOME_KIND_RESULT,
        result: undefined,
      })
    ).toEqual({
      kind: BROWSER_RUNTIME_OUTCOME_KIND_RESULT,
      result: undefined,
    })
  })

  it('returns an error outcome when the browser runtime throws', () => {
    expect(
      toBrowserRuntimeOutcome({
        kind: BROWSER_RUNTIME_OUTCOME_KIND_ERROR,
        error: {
          message: 'boom',
          name: 'Error',
          stack: 'stack',
        },
      })
    ).toEqual({
      kind: BROWSER_RUNTIME_OUTCOME_KIND_ERROR,
      error: {
        message: 'boom',
        name: 'Error',
        stack: 'stack',
      },
    })
  })

  it('converts malformed browser outcomes into a structured error payload', () => {
    expect(
      toBrowserRuntimeOutcome({
        kind: BROWSER_RUNTIME_OUTCOME_KIND_ERROR,
        error: 'bad-error-payload',
      })
    ).toEqual({
      kind: BROWSER_RUNTIME_OUTCOME_KIND_ERROR,
      error: {
        message: INVALID_BROWSER_RUNTIME_OUTCOME_MESSAGE,
      },
    })
  })
})
