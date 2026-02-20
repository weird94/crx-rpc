import { expect, test } from '@playwright/test'
import { createIdentifier } from '../src/id'
import { createPlaywrightBridge } from '../src/playwright'

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

const IContentDomService = createIdentifier<IContentDomService>(
  'playwright-content-dom',
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

  const backgroundHost = bridge.createBackgroundHost()
  backgroundHost.register(IBackgroundMathService, {
    async add(a: number, b: number): Promise<number> {
      return a + b
    },
  })

  const contentHost = bridge.createContentHost(targetId)
  contentHost.register(IContentDomService, {
    async getText(selector: string): Promise<string | null> {
      return page.locator(selector).textContent()
    },
    async concatWithTitle(prefix: string): Promise<string> {
      const title = await page.locator('#title').textContent()
      return `${prefix}:${title ?? ''}`
    },
  })

  const backgroundClient = bridge.createClient({ from: 'background' })
  const contentService = await backgroundClient.createRPCService(IContentDomService, { targetId })
  const valueText = await contentService.getText('#value')
  const prefixedTitle = await contentService.concatWithTitle('prefix')

  expect(valueText).toBe('42')
  expect(prefixedTitle).toBe('prefix:hello-playwright')

  const contentClient = bridge.createClient({ from: 'content', defaultTargetId: targetId })
  const backgroundService = await contentClient.createRPCService(IBackgroundMathService)
  const sum = await backgroundService.add(7, 5)

  expect(sum).toBe(12)

  bridge.dispose()
})
