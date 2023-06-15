# edge-runtime

> Experimental project — exploring edge runtime internals and V8 isolate patterns.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

A lightweight edge function runtime and serverless framework. Develop locally with hot reload, deploy globally with built-in KV storage, routing, and middleware.

## Features

- **V8-like Sandbox** - Function isolation with timeout, memory, and CPU limits
- **Local Dev Server** - Hot reload, request logging, error display with stack traces
- **Request Router** - Path params, method matching, wildcard routes, route groups
- **KV Store** - Key-value storage with TTL, namespaces, atomic operations, JSON support
- **Middleware Chain** - JWT auth, API key validation, rate limiting, caching with ETag
- **Deploy Tooling** - Bundle, upload, rollback, blue-green deployment, domain binding

## Installation

```bash
npm install -g edge-runtime
```

## Quick Start

Create a function in `./functions/hello.js`:

```javascript
export const config = {
  route: '/hello/:name',
  methods: ['GET'],
};

export default async function handler(ctx) {
  const name = ctx.request.params.name || 'World';
  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Hello, ${name}!` }),
  };
}
```

Start the dev server:

```bash
edge dev --port 8787
```

## Function API

Every edge function receives a `Context` object:

```typescript
interface EdgeContext {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
    params: Record<string, string>;
    query: Record<string, string>;
  };
  env: Record<string, string>;
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
```

## KV Store

Built-in key-value storage with TTL support:

```typescript
import { KVStore } from 'edge-runtime';

const store = new KVStore('my-namespace');

// Basic operations
await store.set('user:1', JSON.stringify({ name: 'Alice' }), {
  expirationTtl: 3600, // 1 hour
});

const user = await store.getJSON('user:1');

// List keys with prefix
const { keys } = await store.list({ prefix: 'user:', limit: 100 });

// Atomic operations
await store.atomic([
  { type: 'set', key: 'counter', value: '42' },
  { type: 'delete', key: 'old-key' },
]);
```

## Middleware

### JWT Authentication

```typescript
import { jwtAuth } from 'edge-runtime/middleware/auth';

router.get('/protected', handler, [jwtAuth]);
```

### Rate Limiting

```typescript
import { rateLimit } from 'edge-runtime/middleware/auth';

router.use(rateLimit(100, 60)); // 100 requests per 60 seconds
```

### Cache Control

```typescript
import { cacheControl, purgeCache } from 'edge-runtime/middleware/cache';

router.get('/data', handler, [cacheControl(300)]); // 5 min cache

// Purge specific routes
purgeCache('/api/data.*');
```

## Deploy

```bash
# Deploy all functions to production
edge deploy --env production

# Deploy specific functions
edge deploy --env staging --functions hello,api

# Dry run
edge deploy --dry-run

# Rollback
edge deploy --env production --rollback
```

### Deploy Flow

```
Bundle function code
       |
  Upload to edge network
       |
  Configure routes & triggers
       |
  Health check
       |
  Switch traffic (blue-green)
       |
  Done (old version kept for rollback)
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `edge dev` | Start local development server |
| `edge deploy` | Deploy functions to edge network |
| `edge logs` | View function execution logs |
| `edge list` | List all deployed functions |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port <port>` | Dev server port | `8787` |
| `--dir <directory>` | Functions directory | `./functions` |
| `--env <environment>` | Target environment | `production` |
| `--dry-run` | Preview without deploying | `false` |
| `-f, --follow` | Follow log output | `false` |

## License

MIT
