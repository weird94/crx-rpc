# Chrome Extension RPC (@weird94/crx-rpc)

A lightweight, type-safe RPC framework for Chrome Extensions supporting communication between web pages, content scripts, and background scripts. Built with TypeScript for maximum type safety and developer experience.

## Features

- 🔒 **Type Safety**: Full TypeScript type support with automatic proxy type generation
- 🚀 **Easy to Use**: Auto-generated client proxies based on interfaces
- 🔄 **Bidirectional Communication**: Supports web page ↔ content script ↔ background script
- 📦 **Zero Configuration**: No manual method binding required
- 🎯 **Observable Support**: Built-in support for reactive data streams with RemoteSubject
- 🛡️ **Error Handling**: Preserves stack traces and error types across boundaries
- 🧹 **Resource Management**: Built-in disposable pattern for clean resource cleanup

## Quick Start

### 1. Define Service Interface

```typescript
// services/math.ts
import { createIdentifier } from '@weird94/crx-rpc';

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
import { ContentRPC } from '@weird94/crx-rpc';

// Initialize RPC bridge
const contentRpc = new ContentRPC();

// Remember to dispose when cleanup is needed
// contentRpc.dispose();
```

### 4. Use Client (Web Page)

```typescript
// web-page.ts
import { WebRPCClient } from '@weird94/crx-rpc';
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

    // Remember to dispose when cleanup is needed
    // client.dispose();
}
```

## Architecture

```
Web Page           Content Script        Background Script
┌─────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ WebRPCClient│──▶│   ContentRPC    │──▶│  BackgroundRPC  │
│             │   │   (Bridge)      │   │                 │
│ Proxy       │   │                 │   │ Service         │
│ Service     │   │ MessageAdapter  │   │ Registry        │
│ .add(1, 2)  │   │                 │   │                 │
└─────────────┘   └─────────────────┘   └─────────────────┘
        │                  │                       │
        │  CustomEvent     │  chrome.runtime      │
        │                  │  Messages            │
        └──────────────────┴──────────────────────┘
```

### Communication Flow

1. **Web Page → Content Script**: Uses `window.dispatchEvent` with `CustomEvent`
2. **Content Script → Background**: Uses `chrome.runtime.sendMessage`
3. **Background → Content Script**: Uses `chrome.tabs.sendMessage`
4. **Content Script → Web Page**: Uses `window.dispatchEvent` with `CustomEvent`

### Key Components

- **WebRPCClient**: Client for web pages using window events
- **ContentRPC**: Bridge that forwards messages between web and background
- **BackgroundRPC**: Service registry and handler in the background script
- **ContentRPCClient**: Client for content scripts (direct chrome.runtime communication)
- **RPCClient**: Base client with service proxy generation

## Type System

### Service Proxy Types

The framework automatically converts service interfaces to client proxy types using advanced TypeScript utilities:

```typescript
// Original interface
interface IMathService {
    add(a: number, b: number): number; // Sync method
    asyncAdd(a: number, b: number): Promise<number>; // Async method
}

// Auto-converted to client proxy type (ServiceProxy<T>)
interface MathServiceProxy {
    add(a: number, b: number): Promise<number>; // Converted to async
    asyncAdd(a: number, b: number): Promise<number>; // Remains async
};
```

### Type Transformation

The framework uses these TypeScript utility types:

```typescript
type FunctionArgs<T> = T extends (...args: infer A) => any ? A : never;
type FunctionReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

type ServiceProxy<T> = {
    [K in keyof T]: T[K] extends (...args: any[]) => any
    ? (...args: FunctionArgs<T[K]>) => Promise<Awaited<FunctionReturnType<T[K]>>>
    : never;
};
```

### Type Safety Guarantees

- ✅ Method parameter type checking
- ✅ Return value type inference with `Awaited<T>`
- ✅ Compile-time error detection
- ✅ IDE IntelliSense and auto-completion
- ✅ Preserves error types across RPC boundaries

## Error Handling

The framework preserves error details including stack traces and error types:

```typescript
const client = new WebRPCClient();
const mathService = client.createWebRPCService(IMathService);

try {
    const result = await mathService.divide(10, 0);
} catch (error) {
    console.error('RPC Error:', error.message);
    console.error('Stack trace:', error.stack);
    console.error('Error name:', error.name);
    // Error preserves original stack trace and error type from the background script
}
```

### Error Structure

Errors are transmitted with full details:

```typescript
interface RpcErrorDetails {
    message: string;
    stack?: string;
    name?: string;
}
```

## Observable Support

The framework includes built-in support for reactive data streams using `RemoteSubject` and `Observable` patterns.

### Remote Subject (Background Script)

```typescript
// background.ts
import { BackgroundRPC, RemoteSubject, createIdentifier } from '@weird94/crx-rpc';

interface ICounterObservable {
    value: number;
}

const ICounterObservable = createIdentifier<ICounterObservable>('Counter');

const rpc = new BackgroundRPC();

// Create a remote subject that can broadcast to multiple subscribers
const counterSubject = new RemoteSubject(ICounterObservable, 'main', { value: 0 });

// Update value and broadcast to all subscribers
setInterval(() => {
    const newValue = { value: Math.floor(Math.random() * 100) };
    counterSubject.next(newValue);
}, 1000);

// Cleanup
// counterSubject.dispose();
```

### Subscribing from Web Page

```typescript
// web-page.ts
import { WebObservable, createIdentifier } from '@weird94/crx-rpc';

interface ICounterObservable {
    value: number;
}

const ICounterObservable = createIdentifier<ICounterObservable>('Counter');

// Subscribe to remote observable
const observable = new WebObservable(
    ICounterObservable,
    'main',
    (value) => {
        console.log('Counter updated:', value.value);
    }
);

// Cleanup when done
// observable.dispose();
```

### Subscribing from Content Script

```typescript
// content.ts (if needed)
import { ContentObservable, createIdentifier } from '@weird94/crx-rpc';

const observable = new ContentObservable(
    ICounterObservable,
    'main',
    (value) => {
        console.log('Counter from content script:', value.value);
    }
);
```

## Advanced Usage

### Resource Management with Disposables

All RPC components extend the `Disposable` class for proper cleanup:

```typescript
import { WebRPCClient, ContentRPC, BackgroundRPC } from '@weird94/crx-rpc';

const client = new WebRPCClient();
const contentRpc = new ContentRPC();
const backgroundRpc = new BackgroundRPC();

// Proper cleanup
function cleanup() {
    client.dispose();
    contentRpc.dispose();
    backgroundRpc.dispose();
}

// Check if already disposed
if (!client.isDisposed()) {
    const service = client.createWebRPCService(IMathService);
    // Use service...
}
```

### Content Script as Direct Client

Content scripts can also act as direct RPC clients:

```typescript
// content.ts
import { ContentRPCClient } from '@weird94/crx-rpc';
import { IMathService } from './services/math';

const client = new ContentRPCClient();
const mathService = client.createWebRPCService(IMathService);

// Direct call to background script
const result = await mathService.add(5, 3);
```

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

export const IUserService = createIdentifier<IUserService>('UserService');

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

## Installation

```bash
npm install @weird94/crx-rpc
# or
pnpm add @weird94/crx-rpc
# or
yarn add @weird94/crx-rpc
```

## API Reference

### Core Classes

- **`BackgroundRPC`**: Service registry and message handler for background scripts
- **`ContentRPC`**: Message bridge between web pages and background scripts
- **`WebRPCClient`**: RPC client for web pages
- **`ContentRPCClient`**: Direct RPC client for content scripts

### Observable Classes

- **`RemoteSubject<T>`**: Observable subject that can broadcast to multiple subscribers
- **`WebObservable<T>`**: Observable subscriber for web pages
- **`ContentObservable<T>`**: Observable subscriber for content scripts

### Utility Functions

- **`createIdentifier<T>(key: string)`**: Creates a type-safe service identifier

### Interfaces

- **`Identifier<T>`**: Type-safe service identifier interface
- **`RpcRequest`**: RPC request message structure
- **`RpcResponse`**: RPC response message structure
- **`IMessageAdapter`**: Message transport abstraction interface
- **`IDisposable`**: Resource management interface

## Best Practices

1. **Service Interface Design**
   - Use clear method names and proper TypeScript types
   - Return Promise types for async operation support
   - Define detailed parameter and return value types
   - Keep interfaces focused and cohesive

2. **Resource Management**
   - Always call `dispose()` on RPC instances when cleanup is needed
   - Check `isDisposed()` before using disposed instances
   - Use proper cleanup in component unmount/destroy lifecycle

3. **Error Handling**
   - Implement proper error handling in service methods
   - Throw meaningful errors with descriptive messages
   - Handle RPC errors appropriately on the client side

4. **Performance Optimization**
   - Avoid frequent small data transfers
   - Consider batching operations when possible
   - Use Observable pattern for real-time data updates
   - Implement caching strategies where appropriate

5. **Security Considerations**
   - Validate input parameters in service implementations
   - Don't expose sensitive operations through RPC
   - Consider rate limiting for resource-intensive operations

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Changelog

### v1.0.0
- Initial release
- Type-safe RPC framework for Chrome Extensions
- Support for web page ↔ content script ↔ background script communication
- Built-in Observable support with RemoteSubject
- Disposable pattern for resource management
- Full TypeScript support with automatic proxy type generation
