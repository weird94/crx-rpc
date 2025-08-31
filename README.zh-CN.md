# Chrome 扩展 RPC 框架 (@weird94/crx-rpc)

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
npm install @weird94/crx-rpc
# 或
pnpm add @weird94/crx-rpc
# 或
yarn add @weird94/crx-rpc
```

## 快速开始

### 1. 定义服务接口

```typescript
// services/math.ts
import { createIdentifier } from '@weird94/crx-rpc';

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
import { BackgroundRPC } from '@weird94/crx-rpc';
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
        if (b === 0) throw new Error('除零错误');
        return a / b;
    }
}

// 注册服务
const rpc = new BackgroundRPC();
rpc.register(IMathService, new MathService());
```

### 3. 初始化内容脚本

内容脚本可以以两种模式工作：

#### 选项A：作为桥接器（用于网页通信）

```typescript
// content.ts
import { ContentRPC } from '@weird94/crx-rpc';

// 为网页 ↔ 背景脚本通信初始化RPC桥接器
const contentRpc = new ContentRPC();

// 需要清理时记得dispose
// contentRpc.dispose();
```

#### 选项B：作为直接客户端

```typescript
// content.ts
import { ContentRPCClient } from '@weird94/crx-rpc';
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
import { ContentRPC, ContentRPCClient } from '@weird94/crx-rpc';
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
import { WebRPCClient } from '@weird94/crx-rpc';
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

## 错误处理

框架保留错误详细信息，包括堆栈跟踪和错误类型：

```typescript
const client = new WebRPCClient();
const mathService = client.createWebRPCService(IMathService);

try {
    const result = await mathService.divide(10, 0);
} catch (error) {
    console.error('RPC错误:', error.message);
    console.error('堆栈跟踪:', error.stack);
    console.error('错误名称:', error.name);
    // 错误保留了来自背景脚本的原始堆栈跟踪和错误类型
}
```

### 错误结构

错误会传输完整的详细信息：

```typescript
interface RpcErrorDetails {
    message: string;
    stack?: string;
    name?: string;
}
```

## Observable支持

框架包含使用 `RemoteSubject` 和 `Observable` 模式的内置响应式数据流支持。

### 远程Subject（背景脚本）

```typescript
// background.ts
import { BackgroundRPC, RemoteSubject, createIdentifier } from '@weird94/crx-rpc';

interface ICounterObservable {
    value: number;
}

const ICounterObservable = createIdentifier<ICounterObservable>('Counter');

const rpc = new BackgroundRPC();

// 创建可以向多个订阅者广播的远程subject
const counterSubject = new RemoteSubject(ICounterObservable, 'main', { value: 0 });

// 更新值并广播给所有订阅者
setInterval(() => {
    const newValue = { value: Math.floor(Math.random() * 100) };
    counterSubject.next(newValue);
}, 1000);

// 清理
// counterSubject.dispose();
```

### 从网页订阅

```typescript
// web-page.ts
import { WebObservable, createIdentifier } from '@weird94/crx-rpc';

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
import { ContentObservable, createIdentifier } from '@weird94/crx-rpc';

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

Observable系统支持多种通信模式：

```typescript
// 模式1: 背景脚本 → 网页 (通过内容脚本桥接器)
// 背景脚本: RemoteSubject.next()
// 网页: WebObservable.subscribe()

// 模式2: 背景脚本 → 内容脚本 (直接)
// 背景脚本: RemoteSubject.next()
// 内容脚本: ContentObservable.subscribe()

// 模式3: 背景脚本 → 网页和内容脚本同时
// 背景脚本: RemoteSubject.next() (广播给所有订阅者)
// 网页: WebObservable.subscribe()
// 内容脚本: ContentObservable.subscribe()
```

## 高级用法

### 使用Disposables进行资源管理

所有RPC组件都继承了 `Disposable` 类来进行适当的清理：

```typescript
import { WebRPCClient, ContentRPC, BackgroundRPC } from '@weird94/crx-rpc';

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
import { ContentRPCClient, ContentObservable } from '@weird94/crx-rpc';
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

### Observable类

- **`RemoteSubject<T>`**: 可以向多个订阅者广播的Observable subject
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
   - 对实时数据更新使用Observable模式
   - 在适当的地方实现缓存策略

5. **安全考虑**
   - 在服务实现中验证输入参数
   - 不要通过RPC暴露敏感操作
   - 对资源密集型操作考虑速率限制

## 许可证

MIT

## 贡献

1. Fork 这个仓库
2. 创建您的功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开一个 Pull Request

## 更新日志

### v1.0.0
- 初始发布
- Chrome扩展的类型安全RPC框架
- 支持网页 ↔ 内容脚本 ↔ 背景脚本通信
- 内置Observable支持与RemoteSubject
- 资源管理的Disposable模式
- 完整的TypeScript支持与自动代理类型生成
