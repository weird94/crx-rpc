# crx-rpc

[![npm version](https://img.shields.io/npm/v/crx-rpc.svg)](https://www.npmjs.com/package/crx-rpc)
[![npm downloads](https://img.shields.io/npm/dm/crx-rpc.svg)](https://www.npmjs.com/package/crx-rpc)
[![license](https://img.shields.io/npm/l/crx-rpc.svg)](https://github.com/weird94/crx-rpc/blob/main/LICENSE)

A type-safe RPC implementation for Chrome Extensions, supporting communication between Background, Content Scripts, and extension runtime pages such as Popup and Sidepanel.

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
- **Native request-reply**: Uses Chrome's native `sendMessage` / `sendResponse` flow for RPC calls.
- **Automatic Environment Detection**: Host APIs automatically detect background vs content runtime.
- **Single client API**: One client entry point for background and content service calls.

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
const host = createHost()
host.register(IMathService, new MathService())
```

### 3. Call Service (From Anywhere)

```typescript
import { createClient } from 'crx-rpc'
import { IMathService } from './api'

// Requires Chrome extension runtime APIs
const client = createClient()

// Call background service
const mathService = client.createRPCService(IMathService)
const result = await mathService.add(1, 2) // 3

// Call content service (provide tabId)
const contentService = client.createRPCService(IContentService, { tabId: 123 })
await contentService.doSomething()
```

## Features

- **Type-safe**: Built with TypeScript.
- **Flexible**: Supports various communication paths within a Chrome Extension.
- **Request-reply**: Uses one native message round trip per RPC call.

## Communication Architecture

The library facilitates communication between different parts of a Chrome Extension.

### Service Providers

Services can be hosted in two locations:

1.  **Background**: Hosted in the background service worker. Handles requests from Content Scripts and Popup/Sidepanel.
2.  **Content Script**: Hosted in the content script. Handles requests from Background and Popup/Sidepanel.

### Supported Communication Flows

| Caller              | Target             | Usage                                                 |
| :------------------ | :----------------- | :---------------------------------------------------- |
| **Content Script**  | **Background**     | `client.createRPCService(IBackgroundService)`         |
| **Popup/Sidepanel** | **Background**     | `client.createRPCService(IBackgroundService)`         |
| **Background**      | **Content Script** | `client.createRPCService(IContentService, { tabId })` |
| **Popup/Sidepanel** | **Content Script** | `client.createRPCService(IContentService, { tabId })` |

> **Note**: Web page RPC support is intentionally removed. `createClient()` now requires Chrome extension runtime APIs.

## API Reference

- `createHost(log?: boolean)`: Creates a unified RPC host that auto-detects background vs content
- `UnifiedRPCHost`: Unified host class built on native Chrome request-reply messaging
- `createClient()`: Creates a unified RPC client for extension runtime contexts
- `UnifiedRPCClient`: Unified client class with dynamic `tabId` support for content services
- `createPlaywrightBridge()`: Creates a Playwright RPC bridge for background/content mutual calls
- `PlaywrightRPCBridge#createBackgroundHost(log?: boolean)`: Creates a background host in Node runtime
- `PlaywrightRPCBridge#createContentHost(page, targetId, log?: boolean)`: Creates a content host bound to a real Playwright page
- `PlaywrightPageContentHost#register(identifier, factory)`: Registers a content service factory that runs inside the browser page
- `PlaywrightRPCBridge#createClient(options)`: Creates a client with `{ from, defaultTargetId? }`
