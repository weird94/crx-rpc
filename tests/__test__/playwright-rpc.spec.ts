import { expect, test } from '@playwright/test'
import { createIdentifier } from '../../src/id'
import { createPlaywrightBridge, PlaywrightPageService } from '../../src/playwright'

interface IBackgroundMathService {
  add(a: number, b: number): Promise<number>
}

const IBackgroundMathService = createIdentifier<IBackgroundMathService>(
  'playwright-background-math',
  'background'
)

interface IContentDomService {
  getText(selector: string): Promise<string | null>
  concatWithTitle(prefix: string): Promise<string>
}

const IContentDomService = createIdentifier<IContentDomService>('playwright-content-dom', 'content')

interface IContentWorkflowService {
  readTitle(prefix: string): Promise<string>
  addThroughBackground(a: number, b: number): Promise<number>
}

const IContentWorkflowService = createIdentifier<IContentWorkflowService>(
  'playwright-content-workflow',
  'content'
)

test('background and content can call each other through playwright bridge', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1 id="title">hello-playwright</h1>
      <div id="value">42</div>
    </main>
  `)

  const bridge = createPlaywrightBridge()
  const targetId = 'page-1'

  // background host — no change
  const backgroundHost = bridge.createBackgroundHost()
  backgroundHost.register(IBackgroundMathService, {
    async add(a: number, b: number): Promise<number> {
      return a + b
    },
  })

  // content host — service now runs inside the browser page with real DOM access
  const contentHost = await bridge.createContentHost(page, targetId)
  await contentHost.register(IContentDomService, () => ({
    getText(selector: string): string | null {
      return document.querySelector(selector)?.textContent ?? null
    },
    concatWithTitle(prefix: string): string {
      const title = document.querySelector('#title')?.textContent ?? ''
      return `${prefix}:${title}`
    },
  }))

  const backgroundClient = bridge.createClient({ from: 'background' })
  const contentService = backgroundClient.createRPCService(IContentDomService, { targetId })
  const valueText = await contentService.getText('#value')
  const prefixedTitle = await contentService.concatWithTitle('prefix')

  expect(valueText).toBe('42')
  expect(prefixedTitle).toBe('prefix:hello-playwright')

  const contentClient = bridge.createClient({ from: 'content', defaultTargetId: targetId })
  const backgroundService = contentClient.createRPCService(IBackgroundMathService)
  const sum = await backgroundService.add(7, 5)

  expect(sum).toBe(12)

  bridge.dispose()
})

test('content host survives page reloads because services are evaluated on demand', async ({ page }) => {
  const bridge = createPlaywrightBridge()
  const targetId = 'page-reload'

  await page.setContent(`
    <main>
      <h1 id="title">first-page</h1>
    </main>
  `)

  const contentHost = await bridge.createContentHost(page, targetId)
  await contentHost.register(IContentDomService, () => ({
    getText(selector: string): string | null {
      return document.querySelector(selector)?.textContent ?? null
    },
    concatWithTitle(prefix: string): string {
      const title = document.querySelector('#title')?.textContent ?? ''
      return `${prefix}:${title}`
    },
  }))

  const backgroundClient = bridge.createClient({ from: 'background' })
  const contentService = backgroundClient.createRPCService(IContentDomService, { targetId })

  await expect(contentService.concatWithTitle('before')).resolves.toBe('before:first-page')

  await page.setContent(`
    <main>
      <h1 id="title">second-page</h1>
    </main>
  `)

  await expect(contentService.concatWithTitle('after')).resolves.toBe('after:second-page')

  bridge.dispose()
})

class PlaywrightWorkflowService extends PlaywrightPageService implements IContentWorkflowService {
  async readTitle(prefix: string): Promise<string> {
    return this.evaluate(({ prefix: inputPrefix }) => {
      const title = document.querySelector('#title')?.textContent ?? ''
      return `${inputPrefix}:${title}`
    }, { prefix })
  }

  async addThroughBackground(a: number, b: number): Promise<number> {
    const backgroundMath = this.getService(IBackgroundMathService)
    return backgroundMath.add(a, b)
  }
}

test('playwright page service can use shared getService without choosing a different client', async ({ page }) => {
  await page.setContent(`
    <main>
      <h1 id="title">service-instance</h1>
    </main>
  `)

  const bridge = createPlaywrightBridge()
  const targetId = 'page-service-instance'

  const backgroundHost = bridge.createBackgroundHost()
  backgroundHost.register(IBackgroundMathService, {
    async add(a: number, b: number): Promise<number> {
      return a + b
    },
  })

  const contentHost = await bridge.createContentHost(page, targetId)
  await contentHost.register(IContentWorkflowService, new PlaywrightWorkflowService())

  const backgroundClient = bridge.createClient({ from: 'background' })
  const workflowService = backgroundClient.createRPCService(IContentWorkflowService, { targetId })

  await expect(workflowService.readTitle('prefix')).resolves.toBe('prefix:service-instance')
  await expect(workflowService.addThroughBackground(8, 9)).resolves.toBe(17)

  bridge.dispose()
})
