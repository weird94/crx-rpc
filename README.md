# crx-rpc

[![npm version](https://img.shields.io/npm/v/crx-rpc.svg)](https://www.npmjs.com/package/crx-rpc)
[![npm downloads](https://img.shields.io/npm/dm/crx-rpc.svg)](https://www.npmjs.com/package/crx-rpc)
[![license](https://img.shields.io/npm/l/crx-rpc.svg)](https://github.com/weird94/crx-rpc/blob/main/LICENSE)

A type-safe RPC implementation for Chrome Extensions, supporting communication between Content Scripts, Background, Popup/Sidepanel, and Web Pages.

## Installation

```bash
npm install crx-rpc
```

Or using other package managers:

```bash
# pnpm
pnpm add crx-rpc

# yarn
yarn add crx-rpc
```

## Features

- **Type-safe**: Built with TypeScript for full type safety and IntelliSense support.
- **Flexible**: Supports various communication paths within a Chrome Extension.
- **Observable**: Supports RxJS-like observables for real-time updates.
- **Automatic Environment Detection**: Host and client APIs automatically detect the environment (background/content/web).
- **Smart Message Forwarding**: Content scripts automatically relay web-to-background messages.

## Quick Start

### 1. Define Service

```typescript
import { createIdentifier } from 'crx-rpc'

export interface IMathService {
  add(a: number, b: number): Promise<number>
}

export const IMathService = createIdentifier<IMathService>('math-service', 'background')
```

### 2. Host Service (Background or Content)

```typescript
import { createHost } from 'crx-rpc'
import { IMathService } from './api'

class MathService implements IMathService {
  async add(a: number, b: number) {
    return a + b
  }
}

// Automatically detects environment (background/content)
// In content script, automatically forwards web messages to background
const host = createHost()
host.register(IMathService, new MathService())
```

### 3. Call Service (From Anywhere)

```typescript
import { createClient } from 'crx-rpc'
import { IMathService } from './api'

// Automatically detects environment (runtime/web)
const client = createClient()

// Call background service
const mathService = await client.createRPCService(IMathService)
const result = await mathService.add(1, 2) // 3

// Call content service (provide tabId)
const contentService = await client.createRPCService(IContentService, { tabId: 123 })
await contentService.doSomething()
```

### Key Improvements

- **No manual environment detection**: `createHost()` and `createClient()` automatically detect the environment
- **No manual proxy setup**: Content scripts automatically forward web messages
- **Smart routing**: Web messages to content services are handled locally, only background-bound messages are forwarded
- **Single client API**: No need to choose between `RuntimeRPCClient`, `WebRPCClient`, or `TabRPCClient`

## Features

- **Type-safe**: Built with TypeScript.
- **Flexible**: Supports various communication paths within a Chrome Extension.
- **Observable**: Supports RxJS-like observables for real-time updates.

## Communication Architecture

The library facilitates communication between different parts of a Chrome Extension.

### Service Providers

Services can be hosted in two locations:

1.  **Background**: Hosted in the background service worker. Handles requests from Content Scripts, Popup/Sidepanel, and Web Pages.
2.  **Content Script**: Hosted in the content script. Handles requests from Background and Popup/Sidepanel.

### Supported Communication Flows

| Caller              | Target             | Usage                                           |
| :------------------ | :----------------- | :---------------------------------------------- |
| **Content Script**  | **Background**     | `client.createRPCService(IBackgroundService)`   |
| **Web Page**        | **Background**     | `client.createRPCService(IBackgroundService)`   |
| **Popup/Sidepanel** | **Background**     | `client.createRPCService(IBackgroundService)`   |
| **Background**      | **Content Script** | `client.createRPCService(IContentService, { tabId })` |
| **Popup/Sidepanel** | **Content Script** | `client.createRPCService(IContentService, { tabId })` |
| **Web Page**        | **Content Script** | `client.createRPCService(IContentService)` (local) |

> **Note**: Web-to-background communication is automatically relayed through the content script. Messages to content services are handled locally if the service is registered in the same content script.

## Playwright Runtime

For Node.js + Playwright scenarios, use the dedicated entry:

```typescript
import { createIdentifier } from 'crx-rpc'
import { createPlaywrightBridge } from 'crx-rpc/playwright'

interface IBackgroundService {
  add(a: number, b: number): Promise<number>
}

interface IContentService {
  getText(selector: string): Promise<string | null>
}

const IBackgroundService = createIdentifier<IBackgroundService>('bg-service', 'background')
const IContentService = createIdentifier<IContentService>('content-service', 'content')

const bridge = createPlaywrightBridge()

const backgroundHost = bridge.createBackgroundHost()
backgroundHost.register(IBackgroundService, {
  async add(a, b) {
    return a + b
  },
})

const contentHost = bridge.createContentHost('page-1')
contentHost.register(IContentService, {
  async getText(selector) {
    return selector
  },
})

const backgroundClient = bridge.createClient({ from: 'background' })
const contentService = await backgroundClient.createRPCService(IContentService, {
  targetId: 'page-1',
})
await contentService.getText('#title')
```

Notes:
- Content service calls require `targetId` (or `defaultTargetId` when creating client).
- `from: 'background'` and `from: 'content'` are both supported.
- Keep RPC args/results serializable across process boundaries.

## API Reference

- `createHost(log?: boolean)`: Creates a unified RPC host that auto-detects environment
- `UnifiedRPCHost`: Unified host class with automatic environment detection and smart web forwarding
- `createClient()`: Creates a unified RPC client that auto-detects environment
- `UnifiedRPCClient`: Unified client class with automatic environment detection and dynamic tabId support
- `createPlaywrightBridge()`: Creates a Playwright RPC bridge for background/content mutual calls
- `PlaywrightRPCBridge#createBackgroundHost(log?: boolean)`: Creates a background host in Node runtime
- `PlaywrightRPCBridge#createContentHost(targetId, log?: boolean)`: Creates a content host bound to a target
- `PlaywrightRPCBridge#createClient(options)`: Creates a client with `{ from, defaultTargetId? }`
