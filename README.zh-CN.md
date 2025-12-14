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

## 通信架构

本库促进了 Chrome 扩展不同部分之间的通信。

### 服务提供者 (Service Providers)

服务可以托管在两个位置：

1.  **Background**: 使用 `BackgroundRPCHost` 托管。处理来自 Content Scripts 和 Web Pages 的请求。
2.  **Content Script**: 使用 `ContentRPCHost` 托管。处理来自 Background 和 Popup/Sidepanel 的请求。

### 调用方 (Callers)

调用方可以是：

1.  **Runtime**: Content Scripts, Popup, Sidepanel。
2.  **Web**: 网页中注入的脚本。

### 支持的流程

| 调用方              | 目标               | 客户端             | 主机                | 说明                                               |
| :------------------ | :----------------- | :----------------- | :------------------ | :------------------------------------------------- |
| **Content Script**  | **Background**     | `RuntimeRPCClient` | `BackgroundRPCHost` | 标准的 Runtime -> Background 通信。                |
| **Web Page**        | **Background**     | `WebRPCClient`     | `BackgroundRPCHost` | 通过 Content Script 中继 (`Web2BackgroundProxy`)。 |
| **Background**      | **Content Script** | `TabRPCClient`     | `ContentRPCHost`    | 指向特定的标签页。                                 |
| **Popup/Sidepanel** | **Content Script** | `TabRPCClient`     | `ContentRPCHost`    | 指向特定的标签页。                                 |

> **注意**: 目前 `BackgroundRPCHost` 不支持从 Popup/Sidepanel 使用 `RuntimeRPCClient` 直接调用 Background，因为它需要发送者的 tab ID。

## 使用方法

### 1. 定义 API

定义你的服务接口并创建标识符。

```typescript
import { createIdentifier } from 'crx-rpc'

export interface IMathService {
  add(a: number, b: number): Promise<number>
}

export const IMathService = createIdentifier<IMathService>('math-service', 'background')
```

### 2. 实现并托管服务

#### 在 Background 中

```typescript
// background.ts
import { BackgroundRPCHost } from 'crx-rpc'
import { IMathService } from './api'

class MathService implements IMathService {
  async add(a: number, b: number) {
    return a + b
  }
}

const host = new BackgroundRPCHost()
host.register(IMathService, new MathService())
```

#### 在 Content Script 中

```typescript
// content.ts
import { ContentRPCHost, createIdentifier } from 'crx-rpc'

export interface IPageService {
  doSomething(): void
}
export const IPageService = createIdentifier<IPageService>('page-service', 'content')

const host = new ContentRPCHost()
host.register(IPageService, new PageService())
```

### 3. 调用服务

#### 从 Content Script (调用 Background)

```typescript
import { RuntimeRPCClient } from 'crx-rpc'
import { IMathService } from './api'

const client = new RuntimeRPCClient()
const mathService = await client.createRPCService(IMathService)

await mathService.add(1, 2)
```

#### 从 Web Page (调用 Background)

```typescript
import { WebRPCClient } from 'crx-rpc'
import { IMathService } from './api'

const client = new WebRPCClient()
const mathService = await client.createRPCService(IMathService)

await mathService.add(1, 2)
```

_注意: 需要在 Content Script 中激活 `Web2BackgroundProxy`。_

```typescript
// content.ts
import { Web2BackgroundProxy } from 'crx-rpc'
const proxy = new Web2BackgroundProxy()
```

#### 从 Background/Popup (调用 Content)

```typescript
import { TabRPCClient } from 'crx-rpc'
import { IPageService } from './api'

const tabId = 123 // 目标 Tab ID
const client = new TabRPCClient(tabId)
const pageService = await client.createRPCService(IPageService)

await pageService.doSomething()
```

## API 参考

### 主机 (Hosts)

- `BackgroundRPCHost`: 处理 background script 中的 RPC 请求。
- `ContentRPCHost`: 处理 content script 中的 RPC 请求。

### 客户端 (Clients)

- `RuntimeRPCClient`: 用于在 Content Scripts 中调用 Background 服务。
- `WebRPCClient`: 用于在 Web Pages 中调用 Background 服务（通过中继）。
- `TabRPCClient`: 用于在 Background/Popup 中调用特定标签页的 Content Script 服务。

### 代理 (Proxies)

- `Web2BackgroundProxy`: 将消息从 Web Page 中继到 Background。必须在 Content Script 中实例化。
