interface KVEntry {
  value: string;
  metadata?: Record<string, string>;
  expiresAt?: number;
}

export class KVStore {
  private namespace: string;
  private store: Map<string, KVEntry> = new Map();

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(this.prefixKey(key));
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(this.prefixKey(key));
      return null;
    }

    return entry.value;
  }

  async getWithMetadata(key: string): Promise<{ value: string; metadata: Record<string, string> } | null> {
    const entry = this.store.get(this.prefixKey(key));
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(this.prefixKey(key));
      return null;
    }

    return { value: entry.value, metadata: entry.metadata ?? {} };
  }

  async getJSON<T = unknown>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (value === null) return null;
    return JSON.parse(value) as T;
  }

  async set(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: Record<string, string> }
  ): Promise<void> {
    const entry: KVEntry = {
      value,
      metadata: options?.metadata,
      expiresAt: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined,
    };
    this.store.set(this.prefixKey(key), entry);
  }

  async setJSON(
    key: string,
    value: unknown,
    options?: { expirationTtl?: number; metadata?: Record<string, string> }
  ): Promise<void> {
    await this.set(key, JSON.stringify(value), options);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(this.prefixKey(key));
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ keys: string[]; cursor?: string; complete: boolean }> {
    const allKeys = Array.from(this.store.keys())
      .map((k) => k.replace(`${this.namespace}:`, ''))
      .filter((k) => {
        if (options?.prefix) return k.startsWith(options.prefix);
        return true;
      })
      .sort();

    const startIndex = options?.cursor ? allKeys.indexOf(options.cursor) + 1 : 0;
    const limit = options?.limit ?? 1000;
    const keys = allKeys.slice(startIndex, startIndex + limit);
    const complete = startIndex + limit >= allKeys.length;

    return {
      keys,
      cursor: complete ? undefined : keys[keys.length - 1],
      complete,
    };
  }

  async atomic(operations: Array<{
    type: 'set' | 'delete';
    key: string;
    value?: string;
    options?: { expirationTtl?: number };
  }>): Promise<void> {
    // Execute all operations atomically (all or nothing)
    const backup = new Map(this.store);
    try {
      for (const op of operations) {
        if (op.type === 'set' && op.value !== undefined) {
          await this.set(op.key, op.value, op.options);
        } else if (op.type === 'delete') {
          await this.delete(op.key);
        }
      }
    } catch (error) {
      // Rollback on failure
      this.store = backup;
      throw error;
    }
  }

  getNamespace(): string {
    return this.namespace;
  }

  size(): number {
    // Exclude expired entries from count
    let count = 0;
    for (const [, entry] of this.store) {
      if (!entry.expiresAt || Date.now() <= entry.expiresAt) {
        count++;
      }
    }
    return count;
  }

  clear(): void {
    const prefix = `${this.namespace}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  private prefixKey(key: string): string {
    return `${this.namespace}:${key}`;
  }
}
