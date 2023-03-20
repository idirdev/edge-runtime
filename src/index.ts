#!/usr/bin/env node

import { Command } from 'commander';
import { DevServer } from './Server';
import { Deployer } from './Deployer';

const program = new Command();

program
  .name('edge')
  .description('Edge function runtime - develop, test, and deploy edge functions')
  .version('1.0.0');

program
  .command('dev')
  .description('Start local development server with hot reload')
  .option('-p, --port <port>', 'Server port', '8787')
  .option('-d, --dir <directory>', 'Functions directory', './functions')
  .option('--no-reload', 'Disable hot reload')
  .action(async (opts) => {
    const server = new DevServer({
      port: parseInt(opts.port, 10),
      functionsDir: opts.dir,
      hotReload: opts.reload !== false,
    });
    await server.start();
  });

program
  .command('deploy')
  .description('Deploy edge functions to production')
  .option('-e, --env <environment>', 'Target environment', 'production')
  .option('--dry-run', 'Show what would be deployed without deploying')
  .action(async (opts) => {
    const deployer = new Deployer();
    await deployer.deploy({ environment: opts.env, dryRun: opts.dryRun });
  });

program
  .command('logs')
  .description('View function execution logs')
  .option('-f, --follow', 'Follow log output (tail mode)')
  .option('-n, --lines <count>', 'Number of lines to show', '50')
  .option('--function <name>', 'Filter logs by function name')
  .action((opts) => {
    console.log(`Fetching logs (last ${opts.lines} lines, follow: ${opts.follow ?? false})`);
    if (opts.function) console.log(`Filtering by function: ${opts.function}`);
  });

program
  .command('list')
  .description('List all deployed functions')
  .option('--env <environment>', 'Target environment', 'production')
  .action((opts) => {
    console.log(`Listing functions in ${opts.env}...`);
  });

program.parse(process.argv);
