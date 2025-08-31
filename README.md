# Chrome Extension RPC

A lightweight, type-safe RPC framework for Chrome Extensions supporting communication between web pages, content scripts, and background scripts.

## Features

- 🔒 **Type Safety**: Full TypeScript type support
- 🚀 **Easy to Use**: Auto-generated client proxies based on interfaces
- 🔄 **Bidirectional Communication**: Supports web page ↔ content script ↔ background script
- 📦 **Zero Configuration**: No manual method binding required

## Quick Start

### 1. Define Service Interface

```typescript
// services/math.ts
import { createIdentifier } from '@weird94/chrome-extension-rpc';

interface IMathService {
    add(a: number, b: number): Promise<number>;
    subtract(a: number, b: number): Promise<number>;
    multiply(a: number, b: number): Promise<number>;
    divide(a: number, b: number): Promise<number>;
}

// Create service identifier
export const IMathService = createIdentifier<IMathService>('MathService');
```

### 2. Implement Service (Background Script)

```typescript
// background.ts
import { BackgroundRPC } from '@weird94/chrome-extension-rpc';
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

// Register service
const rpc = new BackgroundRPC();
rpc.register(IMathService, new MathService());
```

### 3. Initialize Content Script

```typescript
// content.ts
import { ContentRPC } from '@weird94/chrome-extension-rpc';

// Initialize RPC bridge
new ContentRPC();
```

### 4. Use Client (Web Page)

```typescript
// web-page.ts
import { WebRPCClient } from '@weird94/chrome-extension-rpc';
import { IMathService } from './services/math';

async function calculate() {
    // Create RPC client
    const client = new WebRPCClient();

    // Create type-safe service proxy
    const mathService = client.createWebRPCService(IMathService);

    // Type-safe method calls
    const sum = await mathService.add(1, 2); // TypeScript knows this returns Promise<number>
    const difference = await mathService.subtract(10, 5);
    const product = await mathService.multiply(3, 4);
    const quotient = await mathService.divide(15, 3);

    console.log('Results:', { sum, difference, product, quotient });
}
```

## Architecture

```
Web Page           Content Script        Background Script
┌─────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ WebRPCClient│──▶│   ContentRPC    │──▶│  BackgroundRPC  │
│  .createWeb │   │   (Bridge)      │   │ (Service Reg.)  │
│  RPCService │   │                 │   │ MathService     │
│ mathService │   │                 │   │ UserService     │
│ .add(1, 2)  │   │                 │   │                 │
└─────────────┘   └─────────────────┘   └─────────────────┘
```

## Type System

### Service Proxy Types

The framework automatically converts service interfaces to client proxy types:

```typescript
// Original interface
interface IMathService {
    add(a: number, b: number): number; // Sync method
    asyncAdd(a: number, b: number): Promise<number>; // Async method
}

// Auto-converted to client proxy type
interface MathServiceProxy {
    add(a: number, b: number): Promise<number>; // Converted to async
    asyncAdd(a: number, b: number): Promise<number>; // Remains async
};
```

### Type Safety Guarantees

- ✅ Method parameter type checking
- ✅ Return value type inference
- ✅ Compile-time error detection
- ✅ IDE IntelliSense and auto-completion

## Error Handling

```typescript
const client = new WebRPCClient();
const mathService = client.createWebRPCService(IMathService);

try {
    const result = await mathService.divide(10, 0);
} catch (error) {
    console.error('RPC Error:', error.message);
    // Error preserves original stack trace and error type
}
```

## Advanced Usage

### Complex Data Types

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

// Usage example
const client = new WebRPCClient();
const userService = client.createWebRPCService(IUserService);

const newUser = await userService.createUser({
    name: 'John Doe',
    email: 'john@example.com',
});
```

### Multiple Service Management

```typescript
// Create RPC client
const client = new WebRPCClient();

// Create multiple service proxies
const mathService = client.createWebRPCService(IMathService);
const userService = client.createWebRPCService(IUserService);
const fileService = client.createWebRPCService(IFileService);

// Parallel calls to different services
const [sum, user, file] = await Promise.all([
    mathService.add(1, 2),
    userService.getUser('123'),
    fileService.readFile('config.json'),
]);
```

## Best Practices

1. **Service Interface Design**
   - Use clear method names
   - Return Promise types for async operation support
   - Define detailed parameter and return value types

2. **Error Handling**
   - Throw meaningful errors in service implementations
   - Handle exceptions appropriately on the client side

3. **Performance Optimization**
   - Avoid frequent small data transfers
   - Consider batch operation interfaces
   - Use caching appropriately

## License

MIT
