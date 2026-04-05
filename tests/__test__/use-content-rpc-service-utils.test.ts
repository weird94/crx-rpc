import { describe, expect, it } from 'vitest'
import {
  NO_ACTIVE_TAB_FOUND_ERROR_MESSAGE,
  TAB_LOAD_STATUS,
  normalizeTabLoadStatus,
  toError,
} from '../../src/hooks/utils'

describe('useContentRPCService utils', () => {
  it('exports the expected shared constants', () => {
    expect(TAB_LOAD_STATUS.Complete).toBe('complete')
    expect(TAB_LOAD_STATUS.Loading).toBe('loading')
    expect(NO_ACTIVE_TAB_FOUND_ERROR_MESSAGE).toBe('No active tab found')
  })

  it('normalizes supported tab load states and ignores unsupported states', () => {
    expect(normalizeTabLoadStatus('complete')).toBe(TAB_LOAD_STATUS.Complete)
    expect(normalizeTabLoadStatus('loading')).toBe(TAB_LOAD_STATUS.Loading)
    expect(normalizeTabLoadStatus('unloaded')).toBeNull()
    expect(normalizeTabLoadStatus(undefined)).toBeNull()
  })

  it('returns the same Error instance when one is provided', () => {
    const error = new Error('boom')

    expect(toError(error)).toBe(error)
  })

  it('converts non-Error values into Error instances', () => {
    expect(toError('boom').message).toBe('boom')
    expect(toError({ code: 500 }).message).toBe('[object Object]')
    expect(toError(null).message).toBe('null')
    expect(toError(undefined).message).toBe('undefined')
  })
})
