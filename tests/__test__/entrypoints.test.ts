import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CURRENT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(CURRENT_DIRECTORY, '../..')

function readPackageFile(path: string): string {
  return readFileSync(resolve(PACKAGE_ROOT, path), 'utf8')
}

describe('crx-rpc entrypoints', () => {
  it('keeps the root entry free of React hook bindings', () => {
    const sourceIndex = readPackageFile('src/index.ts')
    const distIndex = readPackageFile('dist/index.js')
    const distTypes = readPackageFile('dist/index.d.ts')

    for (const indexFile of [sourceIndex, distIndex, distTypes]) {
      expect(indexFile).not.toContain('hooks/use-content-rpc-service')
      expect(indexFile).not.toContain('hooks/use-background-rpc-service')
      expect(indexFile).not.toContain('useContentRPCService')
      expect(indexFile).not.toContain('useBackgroundRPCService')
    }
  })

  it('exposes React hooks from the react subpath', () => {
    expect(readPackageFile('package.json')).toContain('"./react"')
    expect(readPackageFile('src/react.ts')).toContain('hooks/use-background-rpc-service')
    expect(readPackageFile('dist/react.js')).toContain('hooks/use-background-rpc-service')
    expect(readPackageFile('dist/react.d.ts')).toContain('hooks/use-background-rpc-service')
  })
})
