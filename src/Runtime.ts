import { EdgeContext, EdgeFunction, EdgeHandler, EdgeRequest, EdgeResponse, FunctionConfig } from './types';
import { KVStore } from './KVStore';

interface SandboxLimits {
  timeout: number;
  memoryLimit: number;
  cpuLimit: number;
}

export class EdgeRuntime {
  private functions: Map<string, EdgeFunction> = new Map();
  private envVars: Map<string, Record<string, string>> = new Map();
  private secrets: Map<string, string> = new Map();
  private kvStores: Map<string, KVStore> = new Map();
  private backgroundTasks: Promise<unknown>[] = [];

  registerFunction(name: string, handler: EdgeHandler, config: FunctionConfig): void {
    this.functions.set(name, { name, handler, config });

    // Initialize env vars for this function
    if (config.envVars) {
      this.envVars.set(name, { ...config.envVars });
    }

    // Initialize KV namespaces
    if (config.kvNamespaces) {
      for (const ns of config.kvNamespaces) {
        if (!this.kvStores.has(ns)) {
          this.kvStores.set(ns, new KVStore(ns));
        }
      }
    }
  }

  setSecret(key: string, value: string): void {
    this.secrets.set(key, value);
  }

  getKVStore(namespace: string): KVStore | undefined {
    return this.kvStores.get(namespace);
  }

  async executeFunction(name: string, request: EdgeRequest): Promise<EdgeResponse> {
    const func = this.functions.get(name);
    if (!func) {
      return { status: 404, headers: {}, body: `Function "${name}" not found` };
    }

    const limits: SandboxLimits = {
      timeout: func.config.timeout ?? 30000,
      memoryLimit: func.config.memoryLimit ?? 128 * 1024 * 1024, // 128MB
      cpuLimit: func.config.cpuLimit ?? 50, // 50ms CPU time
    };

    const context = this.createContext(name, request);

    try {
      const response = await this.runInSandbox(func.handler, context, limits);
      return this.normalizeResponse(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: message, function: name }),
      };
    }
  }

  private createContext(functionName: string, request: EdgeRequest): EdgeContext {
    const envVars = this.envVars.get(functionName) ?? {};
    const secretKeys = this.functions.get(functionName)?.config.secrets ?? [];

    // Merge env vars and resolved secrets
    const env: Record<string, string> = { ...envVars };
    for (const key of secretKeys) {
      const value = this.secrets.get(key);
      if (value) env[key] = value;
    }

    return {
      request,
      env,
      waitUntil: (promise: Promise<unknown>) => {
        this.backgroundTasks.push(promise);
      },
      passThroughOnException: () => {
        // In production, this would pass the request to the origin server
      },
    };
  }

  private async runInSandbox(
    handler: EdgeHandler,
    context: EdgeContext,
    limits: SandboxLimits
  ): Promise<EdgeResponse> {
    const startMemory = process.memoryUsage().heapUsed;

    // Timeout enforcement
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Function timed out after ${limits.timeout}ms`)), limits.timeout);
    });

    const executionPromise = Promise.resolve(handler(context));
    const response = await Promise.race([executionPromise, timeoutPromise]);

    // Memory check (approximate)
    const memoryUsed = process.memoryUsage().heapUsed - startMemory;
    if (memoryUsed > limits.memoryLimit) {
      throw new Error(`Memory limit exceeded: ${(memoryUsed / 1024 / 1024).toFixed(1)}MB > ${(limits.memoryLimit / 1024 / 1024).toFixed(0)}MB`);
    }

    return response;
  }

  private normalizeResponse(response: EdgeResponse): EdgeResponse {
    return {
      status: response.status ?? 200,
      headers: {
        'Content-Type': 'text/plain',
        ...response.headers,
      },
      body: response.body ?? '',
    };
  }

  async drainBackgroundTasks(): Promise<void> {
    await Promise.allSettled(this.backgroundTasks);
    this.backgroundTasks = [];
  }

  listFunctions(): string[] {
    return Array.from(this.functions.keys());
  }

  getFunction(name: string): EdgeFunction | undefined {
    return this.functions.get(name);
  }
}
