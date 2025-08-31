# TypeScript RPC Service

支持 TypeScript 类型安全的 Chrome 扩展 RPC 通信框架。

## 特性

- 🔒 **类型安全**: 完全的 TypeScript 类型支持
- 🚀 **简单易用**: 基于接口自动生成客户端代理
- 🔄 **双向通信**: 支持 web page ↔ content script ↔ background script
- 📦 **零配置**: 无需手动绑定方法

## 快速开始

### 1. 定义服务接口

```typescript
// services/math.ts
import { createIdentifier } from '@clipsheet/rpc';

interface IMathService {
    add(a: number, b: number): Promise<number>;
    subtract(a: number, b: number): Promise<number>;
    multiply(a: number, b: number): Promise<number>;
    divide(a: number, b: number): Promise<number>;
}

// 创建服务标识符
export const IMathService = createIdentifier<IMathService>('MathService');
```

### 2. 实现服务（Background Script）

```typescript
// background.ts
import { BackgroundRPC } from '@clipsheet/rpc';
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

// 注册服务
const rpc = new BackgroundRPC();
rpc.register(IMathService, new MathService());
```

### 3. 初始化 Content Script

```typescript
// content.ts
import { ContentRPC } from '@clipsheet/rpc';

// 初始化 RPC 桥接
new ContentRPC();
```

### 4. 使用客户端（Web Page）

```typescript
// web-page.ts
import { WebRPCClient } from '@clipsheet/rpc';
import { IMathService } from './services/math';

async function calculate() {
    // 创建 RPC 客户端
    const client = new WebRPCClient();

    // 创建类型安全的服务代理
    const mathService = client.createWebRPCService(IMathService);

    // 类型安全的方法调用
    const sum = await mathService.add(1, 2); // TypeScript 知道返回 Promise<number>
    const difference = await mathService.subtract(10, 5);
    const product = await mathService.multiply(3, 4);
    const quotient = await mathService.divide(15, 3);

    console.log('Results:', { sum, difference, product, quotient });
}
```

## 架构

```
Web Page           Content Script        Background Script
┌─────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ WebRPCClient│──▶│   ContentRPC    │──▶│  BackgroundRPC  │
│  .createWeb │   │   (桥接转发)    │   │  (服务注册)     │
│  RPCService │   │                 │   │ MathService     │
│ mathService │   │                 │   │ UserService     │
│ .add(1, 2)  │   │                 │   │                 │
└─────────────┘   └─────────────────┘   └─────────────────┘
```

## 类型系统

### 服务代理类型

框架会自动将服务接口转换为客户端代理类型：

```typescript
// 原始接口
interface IMathService {
    add(a: number, b: number): number; // 同步方法
    asyncAdd(a: number, b: number): Promise<number>; // 异步方法
}

// 自动转换为客户端代理类型
interface MathServiceProxy {
    add(a: number, b: number): Promise<number>; // 转换为异步
    asyncAdd(a: number, b: number): Promise<number>; // 保持异步
};
```

### 类型安全保证

- ✅ 方法参数类型检查
- ✅ 返回值类型推断
- ✅ 编译时错误检测
- ✅ IDE 智能提示和自动完成

## 错误处理

```typescript
const client = new WebRPCClient();
const mathService = client.createWebRPCService(IMathService);

try {
    const result = await mathService.divide(10, 0);
} catch (error) {
    console.error('RPC Error:', error.message);
    // 错误会保留原始的 stack trace 和错误类型
}
```

## 高级用法

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
// 创建 RPC 客户端
const client = new WebRPCClient();

// 创建多个服务代理
const mathService = client.createWebRPCService(IMathService);
const userService = client.createWebRPCService(IUserService);
const fileService = client.createWebRPCService(IFileService);

// 并行调用不同服务
const [sum, user, file] = await Promise.all([
    mathService.add(1, 2),
    userService.getUser('123'),
    fileService.readFile('config.json'),
]);
```

## 最佳实践

1. **服务接口设计**
   - 使用清晰的方法名
   - 返回 Promise 类型以支持异步操作
   - 定义详细的参数和返回值类型

2. **错误处理**
   - 在服务实现中抛出有意义的错误
   - 在客户端适当处理异常

3. **性能优化**
   - 避免频繁的小数据传输
   - 考虑批量操作接口
   - 合理使用缓存

## 迁移指南

### 从旧版 WebRPCClient 迁移

```typescript
// 原始 call 方法用法
const client = new WebRPCClient();
const result = await client.call('MathService', 'add', [1, 2]); // 无类型安全

// 新的类型安全用法
const client = new WebRPCClient();
const mathService = client.createWebRPCService(IMathService);
const result = await mathService.add(1, 2); // 完全类型安全
```

## 许可证

MIT
