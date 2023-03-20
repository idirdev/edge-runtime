import * as fs from 'fs';
import * as path from 'path';
import { DeployConfig, DeployResult } from './types';

interface FunctionBundle {
  name: string;
  code: string;
  size: number;
  hash: string;
}

export class Deployer {
  private deployHistory: Map<string, DeployResult[]> = new Map();

  async deploy(config: DeployConfig): Promise<DeployResult[]> {
    const results: DeployResult[] = [];
    const functionsDir = path.resolve('./functions');

    console.log(`\n  Deploying to ${config.environment}...`);

    if (!fs.existsSync(functionsDir)) {
      throw new Error(`Functions directory not found: ${functionsDir}`);
    }

    const files = fs.readdirSync(functionsDir).filter(
      (f) => f.endsWith('.ts') || f.endsWith('.js')
    );

    const functionFilter = config.functions ?? files.map((f) => path.basename(f, path.extname(f)));

    for (const file of files) {
      const name = path.basename(file, path.extname(file));
      if (!functionFilter.includes(name)) continue;

      try {
        const bundle = await this.bundleFunction(path.join(functionsDir, file));

        if (config.dryRun) {
          console.log(`  [DRY RUN] Would deploy: ${name} (${this.formatSize(bundle.size)})`);
          results.push({ functionName: name, status: 'skipped' });
          continue;
        }

        const result = await this.uploadFunction(bundle, config);
        results.push(result);

        console.log(`  Deployed: ${name} -> ${result.url} (${this.formatSize(bundle.size)})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  Failed: ${name} - ${message}`);

        if (config.rollbackOnFailure) {
          console.log(`  Rolling back ${name}...`);
          await this.rollback(name, config.environment);
        }

        results.push({ functionName: name, status: 'failed', error: message });
      }
    }

    // Store deploy history
    const historyKey = `${config.environment}-${Date.now()}`;
    this.deployHistory.set(historyKey, results);

    this.printSummary(results);
    return results;
  }

  async rollback(functionName: string, environment: string): Promise<DeployResult | null> {
    // Find last successful deployment
    for (const [key, results] of Array.from(this.deployHistory.entries()).reverse()) {
      if (!key.startsWith(environment)) continue;

      const lastSuccess = results.find(
        (r) => r.functionName === functionName && r.status === 'deployed'
      );

      if (lastSuccess) {
        console.log(`  Rolled back ${functionName} to version ${lastSuccess.version}`);
        return lastSuccess;
      }
    }

    console.log(`  No previous deployment found for ${functionName}`);
    return null;
  }

  async getStatus(functionName: string, environment: string): Promise<DeployResult | null> {
    for (const [key, results] of Array.from(this.deployHistory.entries()).reverse()) {
      if (!key.startsWith(environment)) continue;
      const result = results.find((r) => r.functionName === functionName);
      if (result) return result;
    }
    return null;
  }

  private async bundleFunction(filePath: string): Promise<FunctionBundle> {
    const code = fs.readFileSync(filePath, 'utf-8');
    const name = path.basename(filePath, path.extname(filePath));

    // Simple hash for change detection
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      const char = code.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }

    return {
      name,
      code,
      size: Buffer.byteLength(code, 'utf-8'),
      hash: Math.abs(hash).toString(36),
    };
  }

  private async uploadFunction(bundle: FunctionBundle, config: DeployConfig): Promise<DeployResult> {
    // Simulate upload delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    const version = `v${Date.now().toString(36)}`;
    const domain = config.domain ?? `${config.environment}.edge-runtime.dev`;

    return {
      functionName: bundle.name,
      status: 'deployed',
      url: `https://${domain}/${bundle.name}`,
      version,
      size: bundle.size,
    };
  }

  private printSummary(results: DeployResult[]): void {
    const deployed = results.filter((r) => r.status === 'deployed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;

    console.log(`\n  Deploy Summary`);
    console.log(`  ─────────────`);
    console.log(`  Deployed: ${deployed}`);
    if (failed > 0) console.log(`  Failed:   ${failed}`);
    if (skipped > 0) console.log(`  Skipped:  ${skipped}`);
    console.log('');
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
}
