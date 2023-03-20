import { Middleware, EdgeContext, EdgeResponse } from '../types';

interface JWTPayload {
  sub: string;
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
  [key: string]: unknown;
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload) as JWTPayload;
  } catch {
    return null;
  }
}

function isExpired(payload: JWTPayload): boolean {
  return payload.exp * 1000 < Date.now();
}

export const jwtAuth: Middleware = {
  name: 'jwt-auth',
  order: 10,
  handler: async (ctx: EdgeContext, next: () => Promise<EdgeResponse>): Promise<EdgeResponse> => {
    const authHeader = ctx.request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
        body: JSON.stringify({ error: 'Missing or invalid Authorization header' }),
      };
    }

    const token = authHeader.slice(7);
    const payload = decodeJWT(token);

    if (!payload) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JWT token' }),
      };
    }

    if (isExpired(payload)) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Token has expired' }),
      };
    }

    // Attach user info to headers for downstream handlers
    ctx.request.headers['x-user-id'] = payload.sub;
    ctx.request.headers['x-token-exp'] = String(payload.exp);

    return next();
  },
};

export const apiKeyAuth: Middleware = {
  name: 'api-key-auth',
  order: 10,
  handler: async (ctx: EdgeContext, next: () => Promise<EdgeResponse>): Promise<EdgeResponse> => {
    const apiKey = ctx.request.headers['x-api-key'] ?? ctx.request.query['api_key'];

    if (!apiKey) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing API key' }),
      };
    }

    const validKeys = (ctx.env['API_KEYS'] ?? '').split(',');
    if (!validKeys.includes(apiKey)) {
      return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid API key' }),
      };
    }

    return next();
  },
};

export const rateLimit = (maxRequests: number = 100, windowSeconds: number = 60): Middleware => ({
  name: 'rate-limit',
  order: 5,
  handler: async (ctx: EdgeContext, next: () => Promise<EdgeResponse>): Promise<EdgeResponse> => {
    const key = ctx.request.headers['x-api-key'] ??
                ctx.request.headers['x-forwarded-for'] ??
                'anonymous';

    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    } else {
      entry.count++;

      if (entry.count > maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(maxRequests),
            'X-RateLimit-Remaining': '0',
          },
          body: JSON.stringify({ error: 'Rate limit exceeded', retryAfter }),
        };
      }
    }

    const current = rateLimitStore.get(key)!;
    const response = await next();
    response.headers['X-RateLimit-Limit'] = String(maxRequests);
    response.headers['X-RateLimit-Remaining'] = String(maxRequests - current.count);

    return response;
  },
});
