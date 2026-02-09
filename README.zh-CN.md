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

- **类型安全**: 基于 TypeScript 构建，提供完整的类型安全和 IntelliSense 支持。
- **灵活**: 支持 Chrome 扩展内的多种通信路径。
- **Observable**: 支持类似 RxJS 的 observable 以进行实时更新。
- **自动环境检测**: Host 和 client API 自动检测环境（background/content/web）。
- **智能消息转发**: Content script 自动转发 web 到 background 的消息。

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

## 通信架构

本库促进了 Chrome 扩展不同部分之间的通信。

### 服务提供者 (Service Providers)

服务可以托管在两个位置：

1.  **Background**: 托管在 background service worker。处理来自 Content Scripts、Popup/Sidepanel 和 Web Pages 的请求。
2.  **Content Script**: 托管在 content script。处理来自 Background 和 Popup/Sidepanel 的请求。

### 支持的通信流程

| 调用方              | 目标               | 用法                                            |
| :------------------ | :----------------- | :---------------------------------------------- |
| **Content Script**  | **Background**     | `client.createRPCService(IBackgroundService)`   |
| **Web Page**        | **Background**     | `client.createRPCService(IBackgroundService)`   |
| **Popup/Sidepanel** | **Background**     | `client.createRPCService(IBackgroundService)`   |
| **Background**      | **Content Script** | `client.createRPCService(IContentService, { tabId })` |
| **Popup/Sidepanel** | **Content Script** | `client.createRPCService(IContentService, { tabId })` |
| **Web Page**        | **Content Script** | `client.createRPCService(IContentService)` (本地) |

> **注意**: 从 web 页面到 background 服务的消息会自动通过 content script 转发。从 web 页面到 content 服务的消息在同一页面上下文中本地处理。

## API 参考

### 核心函数

- `createIdentifier<T>(name: string, target: 'background' | 'content')`: 创建带有类型信息的服务标识符
- `createHost(log?: boolean)`: 创建用于注册和暴露服务的 RPC host
- `createClient()`: 创建用于调用远程服务的 RPC client

### 类

- `UnifiedRPCHost`: 自动环境检测和消息转发的 host 类
- `UnifiedRPCClient`: 自动环境检测和动态路由的 client 类
