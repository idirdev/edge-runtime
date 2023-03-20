import * as crypto from 'crypto';
import { Middleware, EdgeContext, EdgeResponse } from '../types';

const responseCache = new Map<string, {
  response: EdgeResponse;
  etag: string;
  cachedAt: number;
  maxAge: number;
}>();

function generateETag(body: string | ArrayBuffer | ReadableStream | null): string {
  const content = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 16);
}

function getCacheKey(ctx: EdgeContext): string {
  return `${ctx.request.method}:${ctx.request.url}`;
}

export const cacheControl = (maxAge: number = 60): Middleware => ({
  name: 'cache-control',
  order: 20,
  handler: async (ctx: EdgeContext, next: () => Promise<EdgeResponse>): Promise<EdgeResponse> => {
    // Only cache GET requests
    if (ctx.request.method !== 'GET') {
      return next();
    }

    const cacheKey = getCacheKey(ctx);
    const cached = responseCache.get(cacheKey);
    const now = Date.now();

    // Check if client sent If-None-Match
    const clientETag = ctx.request.headers['if-none-match'];

    if (cached) {
      const age = (now - cached.cachedAt) / 1000;
      const isStale = age > cached.maxAge;

      // ETag match - return 304
      if (clientETag && clientETag === cached.etag && !isStale) {
        return {
          status: 304,
          headers: {
            'ETag': cached.etag,
            'Cache-Control': `public, max-age=${maxAge}`,
            'Age': String(Math.floor(age)),
          },
          body: null,
        };
      }

      // Stale-while-revalidate: serve stale and revalidate in background
      if (isStale && age < cached.maxAge * 2) {
        // Serve stale response
        const staleResponse = { ...cached.response };
        staleResponse.headers = {
          ...staleResponse.headers,
          'Cache-Control': `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}`,
          'ETag': cached.etag,
          'Age': String(Math.floor(age)),
        };

        // Revalidate in background
        ctx.waitUntil(
          (async () => {
            const freshResponse = await next();
            const etag = generateETag(freshResponse.body);
            responseCache.set(cacheKey, {
              response: freshResponse,
              etag,
              cachedAt: Date.now(),
              maxAge,
            });
          })()
        );

        return staleResponse;
      }

      // Fresh cache hit
      if (!isStale) {
        return {
          ...cached.response,
          headers: {
            ...cached.response.headers,
            'Cache-Control': `public, max-age=${maxAge}`,
            'ETag': cached.etag,
            'Age': String(Math.floor(age)),
            'X-Cache': 'HIT',
          },
        };
      }
    }

    // Cache miss - fetch fresh response
    const response = await next();
    const etag = generateETag(response.body);

    // Store in cache
    responseCache.set(cacheKey, {
      response,
      etag,
      cachedAt: now,
      maxAge,
    });

    return {
      ...response,
      headers: {
        ...response.headers,
        'Cache-Control': `public, max-age=${maxAge}`,
        'ETag': etag,
        'X-Cache': 'MISS',
      },
    };
  },
});

export function purgeCache(pattern?: string): number {
  if (!pattern) {
    const size = responseCache.size;
    responseCache.clear();
    return size;
  }

  let purged = 0;
  const regex = new RegExp(pattern);
  for (const key of responseCache.keys()) {
    if (regex.test(key)) {
      responseCache.delete(key);
      purged++;
    }
  }
  return purged;
}

export function getCacheStats(): { entries: number; keys: string[] } {
  return {
    entries: responseCache.size,
    keys: Array.from(responseCache.keys()),
  };
}
