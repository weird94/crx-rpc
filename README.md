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

> **Note**: Messages from web pages to background services are automatically relayed through content scripts. Messages to content services are handled locally when called from the same web page.

## RpcContext

Service methods automatically receive an `RpcContext` object as the last parameter, providing information about the caller:

```typescript
import { RpcContext } from 'crx-rpc'

class MathService implements IMathService {
  async add(a: number, b: number, context: RpcContext) {
    console.log('Called from tab:', context.tabId)
    console.log('Sender:', context.sender)
    console.log('Is from runtime context:', context.isFromRuntime)
    return a + b
  }
}
```

The `RpcContext` includes:
- `tabId`: The tab ID of the caller (undefined for popup/sidepanel)
- `sender`: Full Chrome MessageSender object
- `isFromRuntime`: Boolean indicating if the call is from a runtime context (popup/sidepanel) rather than a content script

## API Reference

### Core Functions

- `createIdentifier<T>(name: string, target: 'background' | 'content')`: Creates a service identifier with type information
- `createHost(log?: boolean)`: Creates an RPC host for registering and exposing services
- `createClient()`: Creates an RPC client for calling remote services

### Classes

- `UnifiedRPCHost`: Host class with automatic environment detection and message forwarding
- `UnifiedRPCClient`: Client class with automatic environment detection and dynamic routing
