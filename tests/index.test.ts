import { describe, it, expect, beforeEach } from 'vitest';
import { EdgeRuntime } from '../src/Runtime';
import { Router } from '../src/Router';
import { KVStore } from '../src/KVStore';
import type { EdgeContext, EdgeRequest, EdgeResponse } from '../src/types';

// ─── KVStore ───

describe('KVStore', () => {
  let kv: KVStore;

  beforeEach(() => {
    kv = new KVStore('test');
  });

  it('should return the namespace', () => {
    expect(kv.getNamespace()).toBe('test');
  });

  it('should store and retrieve a value', async () => {
    await kv.set('key1', 'value1');
    const val = await kv.get('key1');
    expect(val).toBe('value1');
  });

  it('should return null for missing keys', async () => {
    const val = await kv.get('nonexistent');
    expect(val).toBeNull();
  });

  it('should delete a key', async () => {
    await kv.set('key1', 'value1');
    await kv.delete('key1');
    const val = await kv.get('key1');
    expect(val).toBeNull();
  });

  it('should return size of stored entries', async () => {
    await kv.set('a', '1');
    await kv.set('b', '2');
    expect(kv.size()).toBe(2);
  });

  it('should clear all entries in the namespace', async () => {
    await kv.set('a', '1');
    await kv.set('b', '2');
    kv.clear();
    expect(kv.size()).toBe(0);
  });

  it('should store and retrieve JSON values', async () => {
    await kv.setJSON('obj', { name: 'test', count: 42 });
    const val = await kv.getJSON<{ name: string; count: number }>('obj');
    expect(val).toEqual({ name: 'test', count: 42 });
  });

  it('should return null for missing JSON key', async () => {
    const val = await kv.getJSON('missing');
    expect(val).toBeNull();
  });

  it('should store metadata and retrieve with getWithMetadata', async () => {
    await kv.set('key1', 'val1', { metadata: { source: 'test' } });
    const result = await kv.getWithMetadata('key1');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('val1');
    expect(result!.metadata).toEqual({ source: 'test' });
  });

  it('should expire keys after TTL', async () => {
    await kv.set('ephemeral', 'data', { expirationTtl: 0 });
    // The TTL is 0 seconds, so Date.now() + 0*1000 = Date.now()
    // After a tiny wait the entry should be expired
    await new Promise((r) => setTimeout(r, 10));
    const val = await kv.get('ephemeral');
    expect(val).toBeNull();
  });

  it('should list keys with optional prefix filter', async () => {
    await kv.set('user:1', 'a');
    await kv.set('user:2', 'b');
    await kv.set('post:1', 'c');

    const result = await kv.list({ prefix: 'user:' });
    expect(result.keys).toEqual(['user:1', 'user:2']);
    expect(result.complete).toBe(true);
  });

  it('should list keys with limit', async () => {
    await kv.set('a', '1');
    await kv.set('b', '2');
    await kv.set('c', '3');

    const result = await kv.list({ limit: 2 });
    expect(result.keys).toHaveLength(2);
  });

  it('should perform atomic operations', async () => {
    await kv.set('x', '10');
    await kv.atomic([
      { type: 'set', key: 'y', value: '20' },
      { type: 'delete', key: 'x' },
    ]);

    expect(await kv.get('x')).toBeNull();
    expect(await kv.get('y')).toBe('20');
  });
});

// ─── Router ───

describe('Router', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
  });

  it('should register GET routes', () => {
    router.get('/api/users', async (ctx) => ({
      status: 200,
      headers: {},
      body: 'users',
    }));

    const routes = router.getRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe('GET');
    expect(routes[0].path).toBe('/api/users');
  });

  it('should register POST, PUT, DELETE routes', () => {
    router.post('/a', async () => ({ status: 200, headers: {}, body: '' }));
    router.put('/b', async () => ({ status: 200, headers: {}, body: '' }));
    router.delete('/c', async () => ({ status: 200, headers: {}, body: '' }));

    const routes = router.getRoutes();
    expect(routes).toHaveLength(3);
    expect(routes.map((r) => r.method)).toEqual(['POST', 'PUT', 'DELETE']);
  });

  it('should match a request to the correct route', () => {
    router.get('/api/users', async () => ({ status: 200, headers: {}, body: '' }));

    const req: EdgeRequest = {
      method: 'GET',
      url: '/api/users',
      headers: {},
      body: null,
      params: {},
      query: {},
    };

    const match = router.match(req);
    expect(match).not.toBeNull();
    expect(match!.route.path).toBe('/api/users');
  });

  it('should extract route parameters', () => {
    router.get('/api/users/:id', async () => ({ status: 200, headers: {}, body: '' }));

    const req: EdgeRequest = {
      method: 'GET',
      url: '/api/users/42',
      headers: {},
      body: null,
      params: {},
      query: {},
    };

    const match = router.match(req);
    expect(match).not.toBeNull();
    expect(match!.params).toEqual({ id: '42' });
  });

  it('should return null for unmatched routes', () => {
    router.get('/api/users', async () => ({ status: 200, headers: {}, body: '' }));

    const req: EdgeRequest = {
      method: 'GET',
      url: '/api/posts',
      headers: {},
      body: null,
      params: {},
      query: {},
    };

    expect(router.match(req)).toBeNull();
  });

  it('should return 404 for unmatched handle requests', async () => {
    const req: EdgeRequest = {
      method: 'GET',
      url: '/nothing',
      headers: {},
      body: null,
      params: {},
      query: {},
    };

    const res = await router.handle(req);
    expect(res.status).toBe(404);
  });

  it('should handle a request and return a response', async () => {
    router.get('/hello', async () => ({
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: 'world',
    }));

    const req: EdgeRequest = {
      method: 'GET',
      url: '/hello',
      headers: {},
      body: null,
      params: {},
      query: {},
    };

    const res = await router.handle(req);
    expect(res.status).toBe(200);
    expect(res.body).toBe('world');
  });

  it('should support route groups with prefix', () => {
    router.group('/api/v1', (sub) => {
      sub.get('/items', async () => ({ status: 200, headers: {}, body: '' }));
      sub.post('/items', async () => ({ status: 201, headers: {}, body: '' }));
    });

    const routes = router.getRoutes();
    expect(routes.some((r) => r.path === '/api/v1/items' && r.method === 'GET')).toBe(true);
    expect(routes.some((r) => r.path === '/api/v1/items' && r.method === 'POST')).toBe(true);
  });

  it('should support wildcard routes', () => {
    router.get('/static/*', async () => ({ status: 200, headers: {}, body: 'file' }));

    const req: EdgeRequest = {
      method: 'GET',
      url: '/static/css/main.css',
      headers: {},
      body: null,
      params: {},
      query: {},
    };

    const match = router.match(req);
    expect(match).not.toBeNull();
  });
});

// ─── EdgeRuntime ───

describe('EdgeRuntime', () => {
  let runtime: EdgeRuntime;

  beforeEach(() => {
    runtime = new EdgeRuntime();
  });

  it('should register a function and list it', () => {
    runtime.registerFunction(
      'hello',
      async (ctx) => ({ status: 200, headers: {}, body: 'Hello!' }),
      { route: '/hello' }
    );

    expect(runtime.listFunctions()).toEqual(['hello']);
  });

  it('should retrieve a registered function', () => {
    runtime.registerFunction(
      'greet',
      async () => ({ status: 200, headers: {}, body: '' }),
      { route: '/greet' }
    );

    const fn = runtime.getFunction('greet');
    expect(fn).toBeDefined();
    expect(fn!.name).toBe('greet');
  });

  it('should execute a function and return a response', async () => {
    runtime.registerFunction(
      'echo',
      async (ctx) => ({
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: `Received: ${ctx.request.body}`,
      }),
      { route: '/echo' }
    );

    const response = await runtime.executeFunction('echo', {
      method: 'POST',
      url: '/echo',
      headers: {},
      body: 'test data',
      params: {},
      query: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe('Received: test data');
  });

  it('should return 404 for unknown functions', async () => {
    const response = await runtime.executeFunction('nonexistent', {
      method: 'GET',
      url: '/none',
      headers: {},
      body: null,
      params: {},
      query: {},
    });

    expect(response.status).toBe(404);
  });

  it('should return 500 when a function throws', async () => {
    runtime.registerFunction(
      'broken',
      async () => {
        throw new Error('Internal failure');
      },
      { route: '/broken' }
    );

    const response = await runtime.executeFunction('broken', {
      method: 'GET',
      url: '/broken',
      headers: {},
      body: null,
      params: {},
      query: {},
    });

    expect(response.status).toBe(500);
    expect(response.body).toContain('Internal failure');
  });

  it('should set secrets and make them available to functions', async () => {
    runtime.setSecret('API_KEY', 'secret-123');
    runtime.registerFunction(
      'auth',
      async (ctx) => ({
        status: 200,
        headers: {},
        body: ctx.env['API_KEY'] || 'no key',
      }),
      { route: '/auth', secrets: ['API_KEY'] }
    );

    const res = await runtime.executeFunction('auth', {
      method: 'GET',
      url: '/auth',
      headers: {},
      body: null,
      params: {},
      query: {},
    });

    expect(res.body).toBe('secret-123');
  });

  it('should provide env vars to functions', async () => {
    runtime.registerFunction(
      'env',
      async (ctx) => ({
        status: 200,
        headers: {},
        body: ctx.env['DB_HOST'] || 'missing',
      }),
      { route: '/env', envVars: { DB_HOST: 'localhost' } }
    );

    const res = await runtime.executeFunction('env', {
      method: 'GET',
      url: '/env',
      headers: {},
      body: null,
      params: {},
      query: {},
    });

    expect(res.body).toBe('localhost');
  });

  it('should initialize KV stores for functions with kvNamespaces', () => {
    runtime.registerFunction(
      'cached',
      async () => ({ status: 200, headers: {}, body: '' }),
      { route: '/cached', kvNamespaces: ['CACHE'] }
    );

    const store = runtime.getKVStore('CACHE');
    expect(store).toBeDefined();
    expect(store!.getNamespace()).toBe('CACHE');
  });
});
