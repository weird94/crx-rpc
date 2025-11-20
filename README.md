# crx-rpc

A type-safe RPC implementation for Chrome Extensions, supporting communication between Content Scripts, Background, Popup/Sidepanel, and Web Pages.

## Features

- **Type-safe**: Built with TypeScript.
- **Flexible**: Supports various communication paths within a Chrome Extension.
- **Observable**: Supports RxJS-like observables for real-time updates.

## Communication Architecture

The library facilitates communication between different parts of a Chrome Extension.

### Service Providers

Services can be hosted in two locations:

1.  **Background**: Hosted using `BackgroundRPCHost`. Handles requests from Content Scripts and Web Pages.
2.  **Content Script**: Hosted using `ContentRPCHost`. Handles requests from Background and Popup/Sidepanel.

### Callers

Callers can be:

1.  **Runtime**: Content Scripts, Popup, Sidepanel.
2.  **Web**: Injected scripts in the web page.

### Supported Flows

| Caller | Target | Client | Host | Note |
| :--- | :--- | :--- | :--- | :--- |
| **Content Script** | **Background** | `RuntimeRPCClient` | `BackgroundRPCHost` | Standard Runtime -> Background communication. |
| **Web Page** | **Background** | `WebRPCClient` | `BackgroundRPCHost` | Relayed via Content Script (`Web2BackgroundProxy`). |
| **Background** | **Content Script** | `TabRPCClient` | `ContentRPCHost` | Targets a specific tab. |
| **Popup/Sidepanel** | **Content Script** | `TabRPCClient` | `ContentRPCHost` | Targets a specific tab. |

> **Note**: Direct communication from Popup/Sidepanel to Background using `RuntimeRPCClient` is currently not supported by `BackgroundRPCHost` as it requires a sender tab ID.

## Usage

### 1. Define API

Define your service interface and create an identifier.

```typescript
import { createIdentifier } from 'crx-rpc';

export interface IMathService {
  add(a: number, b: number): Promise<number>;
}

export const IMathService = createIdentifier<IMathService>('math-service', 'background');
```

### 2. Implement & Host Service

#### In Background

```typescript
// background.ts
import { BackgroundRPCHost } from 'crx-rpc';
import { IMathService } from './api';

class MathService implements IMathService {
  async add(a: number, b: number) {
    return a + b;
  }
}

const host = new BackgroundRPCHost();
host.register(IMathService, new MathService());
```

#### In Content Script

```typescript
// content.ts
import { ContentRPCHost, createIdentifier } from 'crx-rpc';

export interface IPageService {
    doSomething(): void;
}
export const IPageService = createIdentifier<IPageService>('page-service', 'content');

const host = new ContentRPCHost();
host.register(IPageService, new PageService());
```

### 3. Call Service

#### From Content Script (to Background)

```typescript
import { RuntimeRPCClient } from 'crx-rpc';
import { IMathService } from './api';

const client = new RuntimeRPCClient();
const mathService = client.createRPCService(IMathService);

await mathService.add(1, 2);
```

#### From Web Page (to Background)

```typescript
import { WebRPCClient } from 'crx-rpc';
import { IMathService } from './api';

const client = new WebRPCClient();
const mathService = client.createRPCService(IMathService);

await mathService.add(1, 2);
```

*Note: Requires `Web2BackgroundProxy` to be active in the content script.*

```typescript
// content.ts
import { Web2BackgroundProxy } from 'crx-rpc';
const proxy = new Web2BackgroundProxy();
```

#### From Background/Popup (to Content)

```typescript
import { TabRPCClient } from 'crx-rpc';
import { IPageService } from './api';

const tabId = 123; // Target Tab ID
const client = new TabRPCClient(tabId);
const pageService = client.createRPCService(IPageService);

await pageService.doSomething();
```

## API Reference

### Hosts

-   `BackgroundRPCHost`: Handles RPC requests in the background script.
-   `ContentRPCHost`: Handles RPC requests in the content script.

### Clients

-   `RuntimeRPCClient`: Used in Content Scripts to call Background services.
-   `WebRPCClient`: Used in Web Pages to call Background services (via relay).
-   `TabRPCClient`: Used in Background/Popup to call Content Script services for a specific tab.

### Proxies

-   `Web2BackgroundProxy`: Relays messages from Web Page to Background. Must be instantiated in the Content Script.
