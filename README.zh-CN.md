# Chrome 扩展 RPC 框架 (crx-rpc)

一个轻量级、类型安全的Chrome扩展RPC框架，支持网页、内容脚本和背景脚本之间的通信。基于TypeScript构建，提供最大的类型安全性和开发体验。

## 特性

- 🔒 **类型安全**: 完整的TypeScript类型支持，自动代理类型生成
- 🚀 **易于使用**: 基于接口自动生成客户端代理
- 🔄 **双向通信**: 支持网页 ↔ 内容脚本 ↔ 背景脚本通信
- 📦 **零配置**: 无需手动方法绑定
- 🎯 **Observable支持**: 内置响应式数据流支持，使用RemoteSubject
- 🛡️ **错误处理**: 跨边界保留堆栈跟踪和错误类型
- 🧹 **资源管理**: 内置disposable模式，支持清理资源

## 安装

```bash
npm install crx-rpc
# 或
pnpm add crx-rpc
# 或
yarn add crx-rpc
```

## 快速开始

### 1. 定义服务接口

```typescript
// services/math.ts
import { createIdentifier } from 'crx-rpc';

interface IMathService {
    add(a: number, b: number): Promise<number>;
    subtract(a: number, b: number): Promise<number>;
    multiply(a: number, b: number): Promise<number>;
    divide(a: number, b: number): Promise<number>;
}

// 创建服务标识符
export const IMathService = createIdentifier<IMathService>('MathService');
```

### 2. 实现服务（背景脚本）

```typescript
// background.ts
import { BackgroundRPC } from 'crx-rpc';
import { IMathService } from './services/math';

class MathService implements IMathService {
    async add(a: number, b: number): Promise<number> {
        return a + b;
    }

    async subtract(a: number, b: number): Promise<number> {
        return a - b;
    }

    async multiply(a: number, b: number): Promise<number> {
        return a * b;
    }

    async divide(a: number, b: number): Promise<number> {
        if (b === 0) throw new Error('Division by zero');
        return a / b;
    }
}

// 注册服务，可选择启用日志
const rpc = new BackgroundRPC(true); // 启用日志
// const rpc = new BackgroundRPC(); // 禁用日志（默认）
rpc.register(IMathService, new MathService());
```

### 3. 初始化内容脚本

内容脚本可以以两种模式工作：

#### 选项A：作为桥接器（用于网页通信）

```typescript
// content.ts
import { ContentRPC } from 'crx-rpc';

// 为网页 ↔ 背景脚本通信初始化RPC桥接器
const contentRpc = new ContentRPC();

// 需要清理时记得dispose
// contentRpc.dispose();
```

#### 选项B：作为直接客户端

```typescript
// content.ts
import { ContentRPCClient } from 'crx-rpc';
import { IMathService } from './services/math';

// 将内容脚本用作直接RPC客户端
const client = new ContentRPCClient();
const mathService = client.createWebRPCService(IMathService);

// 直接调用背景服务
const result = await mathService.add(5, 3);
console.log('内容脚本结果:', result);

// 需要清理时记得dispose
// client.dispose();
```

#### 选项C：既是桥接器又是客户端

```typescript
// content.ts
import { ContentRPC, ContentRPCClient } from 'crx-rpc';
import { IMathService } from './services/math';

// 为网页初始化桥接器
const bridge = new ContentRPC();

// 同时用作直接客户端
const client = new ContentRPCClient();
const mathService = client.createWebRPCService(IMathService);

// 内容脚本可以进行自己的RPC调用
const result = await mathService.multiply(2, 3);
console.log('内容脚本计算:', result);
```

### 4. 使用客户端（网页）

```typescript
// web-page.ts
import { WebRPCClient } from 'crx-rpc';
import { IMathService } from './services/math';

async function calculate() {
    // 创建RPC客户端
    const client = new WebRPCClient();

    // 创建类型安全的服务代理
    const mathService = client.createWebRPCService(IMathService);

    // 类型安全的方法调用
    const sum = await mathService.add(1, 2); // TypeScript知道这返回Promise<number>
    const difference = await mathService.subtract(10, 5);
    const product = await mathService.multiply(3, 4);
    const quotient = await mathService.divide(15, 3);

    console.log('结果:', { sum, difference, product, quotient });

    // 需要清理时记得dispose
    // client.dispose();
}
```

## 架构

```
网页               内容脚本            背景脚本
┌─────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ WebRPCClient│──▶│   ContentRPC    │──▶│  BackgroundRPC  │
│             │   │   (桥接器)      │   │                 │
│ 代理        │   │                 │   │ 服务            │
│ 服务        │   │ MessageAdapter  │   │ 注册表          │
│ .add(1, 2)  │   │                 │   │                 │
└─────────────┘   └─────────────────┘   └─────────────────┘
        │                  │                       ▲
        │  CustomEvent     │  chrome.runtime      │
        │                  │  Messages            │
        └──────────────────┴──────────────────────┘
                           │
                    ┌─────────────────┐
                    │ContentRPCClient │
                    │   (直接)        │
                    │                 │
                    │ 代理服务        │
                    │ .subtract(5,2)  │
                    └─────────────────┘
```

### 通信流程

1. **网页 → 内容脚本**: 使用 `window.dispatchEvent` 和 `CustomEvent`
2. **内容脚本 → 背景脚本**: 使用 `chrome.runtime.sendMessage`
3. **背景脚本 → 内容脚本**: 使用 `chrome.tabs.sendMessage`
4. **内容脚本 → 网页**: 使用 `window.dispatchEvent` 和 `CustomEvent`
5. **内容脚本直接**: 直接使用 `chrome.runtime.sendMessage` (ContentRPCClient)

### 核心组件

- **WebRPCClient**: 用于网页的客户端，使用window事件
- **ContentRPC**: 在网页和背景脚本间转发消息的桥接器
- **ContentRPCClient**: 内容脚本的直接RPC客户端（绕过桥接器）
- **BackgroundRPC**: 背景脚本中的服务注册表和处理器
- **RPCClient**: 具有服务代理生成功能的基础客户端

## 扩展：按 tabId 调用内容脚本/网页

- **每个 tab 创建一个 RPC 客户端实例**：封装一个基于 [`@webext-core/messaging`](./packages/webext-core-messaging/index.js) 的 `TabMessageAdapter`，自动在 `browser.*` 与 `chrome.*` API 之间适配，实现跨浏览器的消息投递。
- **在内容脚本侧注册服务**：实现一个与 `BackgroundRPC` 对称的处理器，监听来自背景页的 `RPC_EVENT_NAME`，执行本地或网页方法，并通过同一套 `@webext-core/messaging` 封装回传结果。
- **需要转发到网页时复用桥接器**：由内容脚本继续利用 `ContentRPC` 把调用抛给页面，再把响应一路传回背景页。
- **调用流程**：背景页创建 `new RPCClient(new TabMessageAdapter(tabId))`，生成远程服务代理并直接 `await service.method()`；内容脚本/网页完成实际逻辑并返回结果。

## 在内容脚本中提供服务（背景 → Tab）

### 1. 在内容脚本里注册服务

```typescript
// content.ts
import { ContentRPCHost, createIdentifier } from 'crx-rpc';

interface IPageInfoService {
    ping(name: string): Promise<string>;
}

export const IPageInfoService = createIdentifier<IPageInfoService>('PageInfoService');

const host = new ContentRPCHost();

host.register(IPageInfoService, {
    async ping(name: string) {
        // 这里的逻辑运行在 tab（内容脚本 / 网页）中
        return `pong from tab: ${name}`;
    },
});

// 如需继续转发到网页，可同时创建 ContentRPC 桥接器
// const bridge = new ContentRPC();
```

`ContentRPCHost` 与 `BackgroundRPC` 对称，不过它监听来自背景页的调用。
注册到 host 的任何服务都可以被背景页通过 RPC 调用。

### 2. 在背景页调用指定 tab 的服务

```typescript
// background.ts
import { TabRPCClient } from 'crx-rpc';
import { IPageInfoService } from './services/page-info';

async function callContentService(tabId: number) {
    const client = new TabRPCClient(tabId);
    const pageInfo = client.createWebRPCService(IPageInfoService);

    const result = await pageInfo.ping('developer');

    client.dispose(); // 调用完成后记得清理监听
    return result;
}
```

`TabRPCClient` 内部的 `TabMessageAdapter` 同样依赖
[`@webext-core/messaging`](./packages/webext-core-messaging/index.js) 自动选择 Promise 化的
`browser.*` 或回调式的 `chrome.*` API，实现跨浏览器兼容的定向通信。它与其他
`RPCClient` 一样，可以复用相同的服务标识符来调用内容脚本中的服务。

> **提示：** `ContentRPCHost` 与 `ContentRPC` 也复用这一消息封装，因此即使在仅提供
> `browser.runtime` Promise API 的浏览器中，背景页与内容脚本之间的调用仍然可以正
> 常工作。

## 日志支持

框架包含内置的日志支持，用于调试和监控RPC调用。

### 启用日志

```typescript
// 在BackgroundRPC中启用日志
const rpc = new BackgroundRPC(true); // 启用日志
// const rpc = new BackgroundRPC(); // 禁用日志（默认）

// 示例输出：
// [RPC] Call: MathService.add { id: "123", args: [5, 3], senderId: 456, timestamp: "2025-09-01T10:00:00.000Z" }
// [RPC] Success: MathService.add { id: "123", result: 8, timestamp: "2025-09-01T10:00:00.001Z" }

// 对于错误：
// [RPC] Error: MathService.divide { id: "124", error: "Division by zero", timestamp: "2025-09-01T10:00:01.000Z" }
```

### 日志输出

启用日志时，会记录以下信息：

- **函数调用**: 服务名、方法名、参数、发送者ID和时间戳
- **成功响应**: 服务名、方法名、结果和时间戳  
- **错误响应**: 服务名、方法名、错误消息和时间戳
- **未知服务/方法**: 无效服务或方法调用的警告

### 使用场景

- **开发**: 在开发期间调试RPC通信
- **生产监控**: 跟踪RPC使用模式和性能
- **故障排除**: 识别失败的调用和错误模式
- **安全审计**: 监控RPC访问模式

## Observable支持

框架包含使用 `RemoteSubject` 和 `Observable` 模式的内置响应式数据流支持，采用集中式消息管理系统。

### RemoteSubjectManager 和 RemoteSubject（背景脚本）

`RemoteSubjectManager` 作为集中式消息中心处理所有订阅管理和消息路由，而 `RemoteSubject` 专注于纯状态管理。

```typescript
// background.ts
import { BackgroundRPC, RemoteSubjectManager, createIdentifier } from 'crx-rpc';

interface ICounterObservable {
    value: number;
}

const ICounterObservable = createIdentifier<ICounterObservable>('Counter');

const rpc = new BackgroundRPC();

// 创建集中式subject管理器
const subjectManager = new RemoteSubjectManager();

// 通过管理器创建远程subject
const counterSubject = subjectManager.createSubject(
    ICounterObservable, 
    'main', 
    { value: 0 }
);

// 更新值并广播给所有订阅者
setInterval(() => {
    const newValue = { value: Math.floor(Math.random() * 100) };
    counterSubject.next(newValue);
}, 1000);

// 管理器处理：
// - 消息路由和订阅管理
// - 在subject创建前到达的订阅排队
// - tab关闭时自动清理
// - 向多个订阅者广播

// 清理
// subjectManager.dispose(); // 这将处理所有subject
```

### RemoteSubjectManager 的核心特性

- **集中式消息中心**: 所有observable相关的消息都由管理器处理
- **队列管理**: 在subject创建前收到的订阅会被排队并稍后处理
- **资源管理**: tab关闭时自动清理订阅
- **类型安全**: 完整的TypeScript支持和恰当的类型检查

### 架构

```
┌─────────────────┐    ┌─────────────────────────────────────┐    ┌─────────────────┐
│      网页        │    │             背景脚本                 │    │    内容脚本       │
├─────────────────┤    ├─────────────────────────────────────┤    ├─────────────────┤
│ WebObservable   │    │       RemoteSubjectManager          │    │ContentObservable│
│                 │    │  ┌─────────────────────────────────┐│    │                 │
│ subscribe() ────┼───▶│  │   消息路由和队列管理               │ │◄──┤ subscribe()     │
│                 │◄───│  │                                 │ │   │                 │
└─────────────────┘    │  └─────────────────────────────────┘ │   └─────────────────┘
                       │               │                      │
                       │  ┌─────────────▼─────────────────┐   │
                       │  │        RemoteSubject          │   │
                       │  │      (纯状态管理)               │   │
                       │  │                               │   │
                       │  │ next() ─────────────────────▶ │   │
                       │  │ complete() ─────────────────▶ │   │
                       │  └───────────────────────────────┘   │
                       └──────────────────────────────────────┘
```

### 从网页订阅

```typescript
// web-page.ts
import { WebObservable, createIdentifier } from 'crx-rpc';

interface ICounterObservable {
    value: number;
}

const ICounterObservable = createIdentifier<ICounterObservable>('Counter');

// 订阅远程observable
const observable = new WebObservable(
    ICounterObservable,
    'main',
    (value) => {
        console.log('计数器更新:', value.value);
    }
);

// 完成时清理
// observable.dispose();
```

### 从内容脚本订阅

```typescript
// content.ts
import { ContentObservable, createIdentifier } from 'crx-rpc';

interface ICounterObservable {
    value: number;
}

const ICounterObservable = createIdentifier<ICounterObservable>('Counter');

// 内容脚本可以直接订阅observables
const observable = new ContentObservable(
    ICounterObservable,
    'main',
    (value) => {
        console.log('来自内容脚本的计数器:', value.value);
        // 内容脚本可以响应实时更新
        updateUI(value.value);
    }
);

// 完成时清理
// observable.dispose();
```

### Observable通信模式

Observable系统支持多种具有集中式管理的通信模式：

```typescript
// 模式1: 背景脚本 → 网页 (通过内容脚本桥接器)
// 背景脚本: RemoteSubjectManager创建和管理RemoteSubject
// 背景脚本: RemoteSubject.next() → Manager路由到订阅者
// 网页: WebObservable.subscribe()

// 模式2: 背景脚本 → 内容脚本 (直接)
// 背景脚本: RemoteSubject.next() → Manager直接路由
// 内容脚本: ContentObservable.subscribe()

// 模式3: 背景脚本 → 网页和内容脚本同时
// 背景脚本: RemoteSubject.next() → Manager广播给所有订阅者
// 网页: WebObservable.subscribe()
// 内容脚本: ContentObservable.subscribe()

// 模式4: Subject创建前的订阅 (队列管理)
// 订阅者: WebObservable.subscribe() → Manager将订阅排队
// 背景脚本: 稍后创建RemoteSubject → Manager处理排队的订阅
// 结果: 不会错过初始值，保证订阅顺序
```

## 高级用法

### 使用Disposables进行资源管理

所有RPC组件都继承了 `Disposable` 类来进行适当的清理：

```typescript
import { WebRPCClient, ContentRPC, BackgroundRPC } from 'crx-rpc';

const client = new WebRPCClient();
const contentRpc = new ContentRPC();
const backgroundRpc = new BackgroundRPC();

// 适当的清理
function cleanup() {
    client.dispose();
    contentRpc.dispose();
    backgroundRpc.dispose();
}

// 检查是否已经disposed
if (!client.isDisposed()) {
    const service = client.createWebRPCService(IMathService);
    // 使用服务...
}
```

### 内容脚本作为直接客户端

内容脚本具有完整的RPC功能，可以作为直接客户端而无需通过网页桥接：

```typescript
// content.ts
import { ContentRPCClient, ContentObservable } from 'crx-rpc';
import { IMathService, IUserService } from './services';

const client = new ContentRPCClient();

// 创建服务代理
const mathService = client.createWebRPCService(IMathService);
const userService = client.createWebRPCService(IUserService);

// 直接调用背景服务
const result = await mathService.add(5, 3);
const user = await userService.getUser('123');

// 内容脚本也可以订阅observables
const counterObservable = new ContentObservable(
    ICounterObservable,
    'main',
    (value) => {
        // 基于实时数据更新内容脚本UI
        updateContentScriptUI(value);
    }
);

// 在DOM操作中使用
document.addEventListener('DOMContentLoaded', async () => {
    const calculation = await mathService.multiply(2, 3);
    document.body.appendChild(
        createElement('div', `计算结果: ${calculation}`)
    );
});
```

### 内容脚本使用场景

内容脚本可以在各种场景中使用RPC：

1. **直接通信**: 在不涉及网页的情况下进行RPC调用
2. **数据处理**: 在注入页面之前处理来自背景服务的数据
3. **实时更新**: 订阅observables获取实时数据更新
4. **桥接+客户端**: 既作为网页的桥接器又作为直接客户端
5. **DOM操作**: 使用RPC数据修改页面内容

### 复杂数据类型

```typescript
interface IUserService {
    getUser(id: string): Promise<User>;
    createUser(userData: CreateUserRequest): Promise<User>;
    updateUser(id: string, updates: Partial<User>): Promise<User>;
}

interface User {
    id: string;
    name: string;
    email: string;
    createdAt: Date;
}

interface CreateUserRequest {
    name: string;
    email: string;
}

export const IUserService = createIdentifier<IUserService>('UserService');

// 使用示例
const client = new WebRPCClient();
const userService = client.createWebRPCService(IUserService);

const newUser = await userService.createUser({
    name: 'John Doe',
    email: 'john@example.com',
});
```

### 多服务管理

```typescript
// 创建RPC客户端
const client = new WebRPCClient();

// 创建多个服务代理
const mathService = client.createWebRPCService(IMathService);
const userService = client.createWebRPCService(IUserService);
const fileService = client.createWebRPCService(IFileService);

// 并行调用不同的服务
const [sum, user, file] = await Promise.all([
    mathService.add(1, 2),
    userService.getUser('123'),
    fileService.readFile('config.json'),
]);
```

## 使用场景

### 场景1: 仅网页
- 网页需要与背景服务通信
- 使用: `WebRPCClient` + `ContentRPC` 桥接器

### 场景2: 仅内容脚本  
- 内容脚本需要直接访问背景服务
- 使用: 直接使用 `ContentRPCClient`（无需桥接器）

### 场景3: 网页和内容脚本同时
- 两个上下文都需要RPC访问
- 使用: `ContentRPC` 桥接器 + `ContentRPCClient` 进行直接访问

### 场景4: 实时数据流
- 背景脚本需要向多个上下文推送更新
- 使用: `RemoteSubject` + `WebObservable`/`ContentObservable`

## API参考

### 核心类

- **`BackgroundRPC`**: 背景脚本的服务注册表和消息处理器
- **`ContentRPC`**: 网页和背景脚本间的消息桥接器
- **`WebRPCClient`**: 网页的RPC客户端
- **`ContentRPCClient`**: 内容脚本的直接RPC客户端
- **`RemoteSubjectManager`**: 集中式observable消息管理系统

### Observable类

- **`RemoteSubjectManager`**: 管理订阅和消息路由的集中式消息中心
- **`RemoteSubject<T>`**: 与管理器配合进行纯状态管理的Observable subject
- **`WebObservable<T>`**: 网页的Observable订阅者
- **`ContentObservable<T>`**: 内容脚本的Observable订阅者

### 工具函数

- **`createIdentifier<T>(key: string)`**: 创建类型安全的服务标识符

### 接口

- **`Identifier<T>`**: 类型安全的服务标识符接口
- **`RpcRequest`**: RPC请求消息结构
- **`RpcResponse`**: RPC响应消息结构
- **`IMessageAdapter`**: 消息传输抽象接口
- **`IDisposable`**: 资源管理接口

## 最佳实践

1. **服务接口设计**
   - 使用清晰的方法名和适当的TypeScript类型
   - 为异步操作支持返回Promise类型
   - 定义详细的参数和返回值类型
   - 保持接口专注和内聚

2. **资源管理**
   - 需要清理时始终在RPC实例上调用 `dispose()`
   - 使用已销毁的实例之前检查 `isDisposed()`
   - 在组件卸载/销毁生命周期中进行适当的清理

3. **错误处理**
   - 在服务方法中实现适当的错误处理
   - 抛出有意义且描述性的错误
   - 在客户端适当处理RPC错误

4. **性能优化**
   - 避免频繁的小数据传输
   - 可能时考虑批处理操作
   - 对实时数据更新使用Observable模式，通过 `RemoteSubjectManager` 进行高效消息路由
   - 在适当的地方实现缓存策略
   - 管理器自动处理订阅排队以防止竞态条件

5. **安全考虑**
   - 在服务实现中验证输入参数
   - 不要通过RPC暴露敏感操作
   - 对资源密集型操作考虑速率限制

## 许可证

MIT