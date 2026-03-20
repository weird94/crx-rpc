# crx-rpc

[![npm version](https://img.shields.io/npm/v/crx-rpc.svg)](https://www.npmjs.com/package/crx-rpc)
[![npm downloads](https://img.shields.io/npm/dm/crx-rpc.svg)](https://www.npmjs.com/package/crx-rpc)
[![license](https://img.shields.io/npm/l/crx-rpc.svg)](https://github.com/weird94/crx-rpc/blob/main/LICENSE)

一个用于 Chrome 扩展的类型安全 RPC 实现，支持 Background、Content Scripts、Web 页面，以及 Popup/Sidepanel 这类扩展运行时页面之间的通信。

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

- **类型安全**: 基于 TypeScript 构建，提供完整的类型安全和 IntelliSense 支持。
- **灵活**: 支持 Chrome 扩展内的多种通信路径。
- **原生 request-reply**: 使用 Chrome 原生 `sendMessage` / `sendResponse` 完成 RPC 往返。
- **自动环境检测**: Host 自动检测 background 或 content 环境。
- **单一 client API**: 用一个 client 入口处理 background、content 和 web 发起的调用。
- **Web request relay**: Web 页面通过 custom event 调用 content，并通过 content 中继调用 background。

## 快速开始

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
const host = createHost()
host.register(IMathService, new MathService())
```

### 3. 调用服务（任意位置）

```typescript
import { createClient } from 'crx-rpc'
import { IMathService } from './api'

// 可运行在扩展环境或注入的 web 页面中
const client = createClient()

// 调用 background service
const mathService = client.createRPCService(IMathService)
const result = await mathService.add(1, 2) // 3

// 调用 content service（需提供 tabId）
const contentService = client.createRPCService(IContentService, { tabId: 123 })
await contentService.doSomething()
```

## 特性

- **类型安全**: 基于 TypeScript 构建。
- **灵活**: 支持 Chrome 扩展内的多种通信路径。
- **请求-响应**: 每次 RPC 调用只走一次原生消息往返。

## 通信架构

本库促进了 Chrome 扩展不同部分之间的通信。

### 服务提供者 (Service Providers)

服务可以托管在两个位置：

1.  **Background**: 托管在 background service worker。处理来自 Content Scripts 和 Popup/Sidepanel 的请求。
2.  **Content Script**: 托管在 content script。处理来自 Background 和 Popup/Sidepanel 的请求。

### 支持的通信流程

| 调用方              | 目标               | 用法                                                  |
| :------------------ | :----------------- | :---------------------------------------------------- |
| **Content Script**  | **Background**     | `client.createRPCService(IBackgroundService)`         |
| **Popup/Sidepanel** | **Background**     | `client.createRPCService(IBackgroundService)`         |
| **Background**      | **Content Script** | `client.createRPCService(IContentService, { tabId })` |
| **Popup/Sidepanel** | **Content Script** | `client.createRPCService(IContentService, { tabId })` |
| **Web Page**        | **Content Script** | `client.createRPCService(IContentService)`            |
| **Web Page**        | **Background**     | 通过 content 中继 `client.createRPCService(IBackgroundService)` |

> **注意**: 当 `createClient()` 运行在 web 页面时，会使用 `CustomEvent` 做 request/response relay；调用 background 时由 content script 负责转发。

## API 参考

- `createHost(log?: boolean)`: 创建自动识别 background 或 content 的统一 RPC host
- `UnifiedRPCHost`: 基于 Chrome 原生 request-reply 的统一 host 类
- `createClient()`: 创建统一 RPC client，可运行在扩展上下文和注入的 web 页面中
- `UnifiedRPCClient`: 统一 client，扩展上下文支持动态 `tabId`，web 页面支持 request-relay
- `BaseService`: service 实现可继承的基类，内置统一的 `getService()` 能力
- `createPlaywrightBridge()`: 创建 Playwright RPC bridge，用于 background/content 互调
- `PlaywrightRPCBridge#createBackgroundHost(log?: boolean)`: 创建 Node 侧 background host
- `PlaywrightRPCBridge#createContentHost(page, targetId, log?: boolean)`: 创建绑定到真实 Playwright page 的 content host
- `PlaywrightPageContentHost#register(identifier, serviceOrFactory)`: 可注册 page.evaluate factory，或注册带统一 `getService()` 能力的 `PlaywrightPageService` 实例
- `PlaywrightRPCBridge#createClient(options)`: 创建 client，参数为 `{ from, defaultTargetId? }`
