import { EdgeHandler, EdgeRequest, EdgeResponse, Middleware, Route } from './types';

interface RouteGroup {
  prefix: string;
  middleware: Middleware[];
  routes: Route[];
}

export class Router {
  private routes: Route[] = [];
  private groups: RouteGroup[] = [];
  private globalMiddleware: Middleware[] = [];

  use(middleware: Middleware): void {
    this.globalMiddleware.push(middleware);
    this.globalMiddleware.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  get(path: string, handler: EdgeHandler, middleware: Middleware[] = []): void {
    this.addRoute('GET', path, handler, middleware);
  }

  post(path: string, handler: EdgeHandler, middleware: Middleware[] = []): void {
    this.addRoute('POST', path, handler, middleware);
  }

  put(path: string, handler: EdgeHandler, middleware: Middleware[] = []): void {
    this.addRoute('PUT', path, handler, middleware);
  }

  delete(path: string, handler: EdgeHandler, middleware: Middleware[] = []): void {
    this.addRoute('DELETE', path, handler, middleware);
  }

  all(path: string, handler: EdgeHandler, middleware: Middleware[] = []): void {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      this.addRoute(method, path, handler, middleware);
    }
  }

  group(prefix: string, setup: (router: Router) => void, middleware: Middleware[] = []): void {
    const subRouter = new Router();
    setup(subRouter);

    const group: RouteGroup = { prefix, middleware, routes: [] };

    for (const route of subRouter.routes) {
      const fullPath = this.normalizePath(`${prefix}${route.path}`);
      const combinedMiddleware = [...middleware, ...route.middleware];
      group.routes.push({ ...route, path: fullPath, middleware: combinedMiddleware });
      this.routes.push({ ...route, path: fullPath, middleware: combinedMiddleware });
    }

    this.groups.push(group);
  }

  match(request: EdgeRequest): { route: Route; params: Record<string, string> } | null {
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;

    for (const route of this.routes) {
      if (route.method !== request.method && route.method !== '*') continue;

      const params = this.matchPath(route.path, pathname);
      if (params !== null) {
        return { route, params };
      }
    }

    return null;
  }

  async handle(request: EdgeRequest): Promise<EdgeResponse> {
    const matched = this.match(request);
    if (!matched) {
      return { status: 404, headers: {}, body: 'Not Found' };
    }

    const { route, params } = matched;
    request.params = params;

    // Build middleware chain
    const allMiddleware = [...this.globalMiddleware, ...route.middleware];

    const context = {
      request,
      env: {},
      waitUntil: () => {},
      passThroughOnException: () => {},
    };

    // Execute middleware chain then handler
    let index = 0;
    const next = async (): Promise<EdgeResponse> => {
      if (index < allMiddleware.length) {
        const mw = allMiddleware[index++];
        return mw.handler(context, next);
      }
      return route.handler(context);
    };

    return next();
  }

  private addRoute(method: string, path: string, handler: EdgeHandler, middleware: Middleware[]): void {
    this.routes.push({
      path: this.normalizePath(path),
      method,
      handler,
      middleware,
      params: {},
    });
  }

  private matchPath(pattern: string, pathname: string): Record<string, string> | null {
    // Wildcard
    if (pattern === '*' || pattern === '/*') return {};

    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);

    // Check for wildcard suffix
    const hasWildcard = patternParts[patternParts.length - 1] === '*';
    if (hasWildcard) patternParts.pop();

    if (!hasWildcard && patternParts.length !== pathParts.length) return null;
    if (hasWildcard && pathParts.length < patternParts.length) return null;

    const params: Record<string, string> = {};

    for (let i = 0; i < patternParts.length; i++) {
      const part = patternParts[i];
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (part !== pathParts[i]) {
        return null;
      }
    }

    return params;
  }

  private normalizePath(path: string): string {
    return '/' + path.split('/').filter(Boolean).join('/');
  }

  getRoutes(): Route[] {
    return [...this.routes];
  }
}
