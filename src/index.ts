/**
 * CLI entry point: parse flags → build config → run the agent.
 *
 * Flags (all also settable via .env; CLI wins):
 *   -m/--mode, -u/--url, -n/--name, -d/--description,
 *   --headless [bool], --out, --timeout, --slowmo, -v/--verbose
 *
 * Note: there is intentionally NO `-h` short flag — commander reserves it for
 * --help, so headless is the long `--headless` only.
 */
import { Command } from 'commander';
import * as dotenv from 'dotenv';
dotenv.config();

import { buildConfig } from './config';
import { createPlanner } from './planners/factory';
import { Agent } from './agent';
import * as logger from './logger';

const program = new Command();
program
  .name('web-agent')
  .description('Intelligent website automation agent (perceive → decide → act)')
  .version('2.0.0')
  .option('-m, --mode <mode>', 'engine: heuristic | ai')
  .option('-p, --provider <p>', 'AI provider: groq | gemini')
  .option('-u, --url <url>', 'target URL')
  .option('-n, --name <text>', 'value for the name/title field')
  .option('-d, --description <text>', 'value for the description field')
  .option('--headless [bool]', 'run headless (default true; "--headless false" shows the window)')
  .option('--out <dir>', 'output directory for screenshots + run-log.json')
  .option('--timeout <ms>', 'navigation / element timeout in ms')
  .option('--slowmo <ms>', 'delay between browser ops (useful for demos)')
  .option('-v, --verbose', 'verbose (debug) logging')
  .parse(process.argv);

const opts = program.opts();

const config = buildConfig({
  mode: opts.mode,
  provider: opts.provider,
  url: opts.url,
  name: opts.name,
  description: opts.description,
  headless: opts.headless, // true (bare flag) or "true"/"false" string or undefined
  out: opts.out,
  timeout: opts.timeout !== undefined ? Number(opts.timeout) : undefined,
  slowmo: opts.slowmo !== undefined ? Number(opts.slowmo) : undefined,
  verbose: Boolean(opts.verbose),
});

async function main(): Promise<void> {
  logger.setVerbose(config.verbose);
  logger.banner('WEBSITE AUTOMATION AGENT');
  logger.summary({
    Mode: config.mode.toUpperCase(),
    ...(config.mode === 'ai' ? { Provider: config.provider } : {}),
    URL: config.url,
    Headless: String(config.headless),
    Name: config.name,
    Output: config.outDir,
  });
  logger.setMeta({ mode: config.mode, provider: config.provider, url: config.url, headless: config.headless });

  const planner = createPlanner(config);
  const agent = new Agent(config, planner);
  const result = await agent.run();

  // Exit non-zero if we could not confirm the task succeeded.
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  logger.log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
