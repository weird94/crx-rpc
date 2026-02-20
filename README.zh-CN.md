# crx-rpc

[![npm version](https://img.shields.io/npm/v/crx-rpc.svg)](https://www.npmjs.com/package/crx-rpc)
[![npm downloads](https://img.shields.io/npm/dm/crx-rpc.svg)](https://www.npmjs.com/package/crx-rpc)
[![license](https://img.shields.io/npm/l/crx-rpc.svg)](https://github.com/weird94/crx-rpc/blob/main/LICENSE)

一个用于 Chrome 扩展的类型安全 RPC 实现，支持 Content Scripts、Background、Popup/Sidepanel 和 Web Pages 之间的通信。

## 安装

```bash
npm install crx-rpc
```

或使用其他包管理器：

```bash
# pnpm
pnpm add crx-rpc

# yarn
yarn add crx-rpc
```

## 特性

- **类型安全**: 基于 TypeScript 构建。
- **灵活**: 支持 Chrome 扩展内的多种通信路径。
- **Observable**: 支持类似 RxJS 的 observable 以进行实时更新。
- **统一 API**: 简化的 host 和 client API，自动环境检测。
- **智能转发**: Content script 自动转发 web 消息到 background。

## 快速开始（统一 API）

### 1. 定义服务

```typescript
import { createIdentifier } from 'crx-rpc'

export interface IMathService {
  add(a: number, b: number): Promise<number>
}

export const IMathService = createIdentifier<IMathService>('math-service', 'background')
```

### 2. 托管服务（Background 或 Content）

```typescript
import { createHost } from 'crx-rpc'
import { IMathService } from './api'

class MathService implements IMathService {
  async add(a: number, b: number) {
    return a + b
  }
}

// 自动检测环境（background/content）
// 在 content script 中，自动转发 web 消息到 background
const host = createHost()
host.register(IMathService, new MathService())
```

### 3. 调用服务（任意位置）

```typescript
import { createClient } from 'crx-rpc'
import { IMathService } from './api'

// 自动检测环境（runtime/web）
const client = createClient()

// 调用 background service
const mathService = await client.createRPCService(IMathService)
const result = await mathService.add(1, 2) // 3

// 调用 content service（需提供 tabId）
const contentService = await client.createRPCService(IContentService, { tabId: 123 })
await contentService.doSomething()
```

### 主要改进

- **无需手动环境检测**: `createHost()` 和 `createClient()` 自动检测环境
- **无需手动设置代理**: Content script 自动转发 web 消息
- **智能路由**: 发往 content service 的 web 消息在本地处理，只有发往 background 的消息才转发
- **单一 client API**: 无需在 `RuntimeRPCClient`、`WebRPCClient` 或 `TabRPCClient` 之间选择

## 特性

- **类型安全**: 基于 TypeScript 构建。
- **灵活**: 支持 Chrome 扩展内的多种通信路径。
- **Observable**: 支持类似 RxJS 的 observable 以进行实时更新。

## 通信架构

本库促进了 Chrome 扩展不同部分之间的通信。

### 服务提供者 (Service Providers)

服务可以托管在两个位置：

1.  **Background**: 托管在 background service worker。处理来自 Content Scripts、Popup/Sidepanel 和 Web Pages 的请求。
2.  **Content Script**: 托管在 content script。处理来自 Background 和 Popup/Sidepanel 的请求。

### 支持的通信流程

使用统一 API，所有通信流程都自动处理：

| 调用方              | 目标               | 用法                                            |
| :------------------ | :----------------- | :---------------------------------------------- |
| **Content Script**  | **Background**     | `client.createRPCService(IBackgroundService)`   |
| **Web Page**        | **Background**     | `client.createRPCService(IBackgroundService)`   |
| **Popup/Sidepanel** | **Background**     | `client.createRPCService(IBackgroundService)`   |
| **Background**      | **Content Script** | `client.createRPCService(IContentService, { tabId })` |
| **Popup/Sidepanel** | **Content Script** | `client.createRPCService(IContentService, { tabId })` |
| **Web Page**        | **Content Script** | `client.createRPCService(IContentService)` (本地) |

> **注意**: Web 到 background 的通信会自动通过 content script 中继。发往 content service 的消息如果在同一个 content script 中注册了服务则本地处理。

## Playwright Runtime（新入口）

在 Node.js + Playwright 场景下，使用独立入口：

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

说明：
- 调用 content service 必须提供 `targetId`（或创建 client 时提供 `defaultTargetId`）。
- 同时支持 `from: 'background'` 和 `from: 'content'` 两种调用方。
- RPC 参数与返回值应保持可序列化。

## API 参考

- `createHost(log?: boolean)`: 创建自动检测环境的统一 RPC host
- `UnifiedRPCHost`: 统一 host 类，自动环境检测和智能 web 转发
- `createClient()`: 创建自动检测环境的统一 RPC client
- `UnifiedRPCClient`: 统一 client 类，自动环境检测和动态 tabId 支持
- `createPlaywrightBridge()`: 创建 Playwright RPC bridge，用于 background/content 互调
- `PlaywrightRPCBridge#createBackgroundHost(log?: boolean)`: 创建 Node 侧 background host
- `PlaywrightRPCBridge#createContentHost(targetId, log?: boolean)`: 创建绑定 target 的 content host
- `PlaywrightRPCBridge#createClient(options)`: 创建 client，参数为 `{ from, defaultTargetId? }`
