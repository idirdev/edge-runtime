import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { RuntimeConfig, EdgeRequest, EdgeResponse } from './types';
import { EdgeRuntime } from './Runtime';
import { Router } from './Router';

export class DevServer {
  private config: RuntimeConfig;
  private runtime: EdgeRuntime;
  private router: Router;
  private server: http.Server | null = null;
  private watcher: fs.FSWatcher | null = null;

  constructor(config: Partial<RuntimeConfig> = {}) {
    this.config = {
      port: config.port ?? 8787,
      functionsDir: config.functionsDir ?? './functions',
      hotReload: config.hotReload ?? true,
    };
    this.runtime = new EdgeRuntime();
    this.router = new Router();
  }

  async start(): Promise<void> {
    await this.loadFunctions();

    if (this.config.hotReload) {
      this.watchForChanges();
    }

    this.server = http.createServer(async (req, res) => {
      const startTime = Date.now();

      try {
        const edgeRequest = this.parseRequest(req);
        const edgeResponse = await this.router.handle(edgeRequest);

        this.sendResponse(res, edgeResponse);
        this.logRequest(req, edgeResponse.status, Date.now() - startTime);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        const stack = error instanceof Error ? error.stack : undefined;

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: message,
          stack: process.env.NODE_ENV !== 'production' ? stack : undefined,
        }));

        this.logError(req, message, stack);
      }
    });

    this.server.listen(this.config.port, () => {
      console.log(`\n  Edge Runtime Dev Server`);
      console.log(`  ----------------------`);
      console.log(`  Listening on: http://localhost:${this.config.port}`);
      console.log(`  Functions:    ${this.config.functionsDir}`);
      console.log(`  Hot reload:   ${this.config.hotReload ? 'enabled' : 'disabled'}`);
      console.log(`  Functions:    ${this.runtime.listFunctions().length} loaded\n`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private async loadFunctions(): Promise<void> {
    const functionsDir = path.resolve(this.config.functionsDir);

    if (!fs.existsSync(functionsDir)) {
      console.log(`Functions directory not found: ${functionsDir}`);
      console.log('Creating directory with example function...');
      fs.mkdirSync(functionsDir, { recursive: true });
      return;
    }

    const files = fs.readdirSync(functionsDir).filter(
      (f) => f.endsWith('.ts') || f.endsWith('.js')
    );

    for (const file of files) {
      try {
        const filePath = path.join(functionsDir, file);
        const functionName = path.basename(file, path.extname(file));

        // Clear module cache for hot reload
        delete require.cache[require.resolve(filePath)];

        const mod = require(filePath);
        const handler = mod.default ?? mod.handler;
        const config = mod.config ?? { route: `/${functionName}` };

        if (typeof handler === 'function') {
          this.runtime.registerFunction(functionName, handler, config);
          this.router.all(config.route, handler);
          console.log(`  Loaded: ${functionName} -> ${config.route}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  Failed to load ${file}: ${message}`);
      }
    }
  }

  private watchForChanges(): void {
    const functionsDir = path.resolve(this.config.functionsDir);
    if (!fs.existsSync(functionsDir)) return;

    let debounceTimer: NodeJS.Timeout | null = null;

    this.watcher = fs.watch(functionsDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (debounceTimer) clearTimeout(debounceTimer);

      debounceTimer = setTimeout(async () => {
        console.log(`\n  File changed: ${filename}`);
        console.log('  Reloading functions...\n');
        this.router = new Router();
        this.runtime = new EdgeRuntime();
        await this.loadFunctions();
      }, 200);
    });
  }

  private parseRequest(req: http.IncomingMessage): EdgeRequest {
    const url = new URL(req.url ?? '/', `http://localhost:${this.config.port}`);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    return {
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers: req.headers as Record<string, string>,
      body: null,
      params: {},
      query,
    };
  }

  private sendResponse(res: http.ServerResponse, edgeResponse: EdgeResponse): void {
    res.writeHead(edgeResponse.status, edgeResponse.headers);
    if (edgeResponse.body !== null) {
      res.end(typeof edgeResponse.body === 'string' ? edgeResponse.body : JSON.stringify(edgeResponse.body));
    } else {
      res.end();
    }
  }

  private logRequest(req: http.IncomingMessage, status: number, durationMs: number): void {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    const statusColor = status < 400 ? '\x1b[32m' : status < 500 ? '\x1b[33m' : '\x1b[31m';
    console.log(`  ${method} ${url} ${statusColor}${status}\x1b[0m ${durationMs}ms`);
  }

  private logError(req: http.IncomingMessage, message: string, stack?: string): void {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    console.error(`\x1b[31m  ERROR\x1b[0m ${method} ${url}: ${message}`);
    if (stack) {
      console.error(`  ${stack.split('\n').slice(1, 4).join('\n  ')}`);
    }
  }
}
