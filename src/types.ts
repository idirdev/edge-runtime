export interface EdgeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  params: Record<string, string>;
  query: Record<string, string>;
  cf?: {
    country?: string;
    city?: string;
    continent?: string;
    latitude?: string;
    longitude?: string;
    timezone?: string;
  };
}

export interface EdgeResponse {
  status: number;
  headers: Record<string, string>;
  body: string | ArrayBuffer | ReadableStream | null;
}

export interface EdgeContext {
  request: EdgeRequest;
  env: Record<string, string>;
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException: () => void;
}

export type EdgeHandler = (ctx: EdgeContext) => Promise<EdgeResponse> | EdgeResponse;

export interface EdgeFunction {
  name: string;
  handler: EdgeHandler;
  config: FunctionConfig;
}

export interface FunctionConfig {
  route: string;
  methods?: string[];
  middleware?: string[];
  timeout?: number;
  memoryLimit?: number;
  cpuLimit?: number;
  envVars?: Record<string, string>;
  secrets?: string[];
  kvNamespaces?: string[];
}

export interface Middleware {
  name: string;
  handler: (ctx: EdgeContext, next: () => Promise<EdgeResponse>) => Promise<EdgeResponse>;
  order?: number;
}

export interface Route {
  path: string;
  method: string;
  handler: EdgeHandler;
  middleware: Middleware[];
  params: Record<string, string>;
}

export interface DeployConfig {
  environment: string;
  dryRun?: boolean;
  functions?: string[];
  rollbackOnFailure?: boolean;
  domain?: string;
}

export interface DeployResult {
  functionName: string;
  status: 'deployed' | 'failed' | 'skipped';
  url?: string;
  version?: string;
  size?: number;
  error?: string;
}

export interface RuntimeConfig {
  port: number;
  functionsDir: string;
  hotReload: boolean;
  kvStorePath?: string;
  envFile?: string;
}
