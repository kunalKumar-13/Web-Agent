import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as path from 'path';
import chalk from 'chalk';
import { AgentOrchestrator } from './agent';
import { AgentConfig } from './types';

// Load environment variables from .env file
dotenv.config();

const program = new Command();

program
  .name('website-automation-agent')
  .description('An intelligent, autonomous website automation agent using Playwright.')
  .version('1.0.0')
  .option('-m, --mode <mode>', 'Execution mode: "ai" or "heuristic"', 'heuristic')
  .option('-u, --url <url>', 'Target URL to automate', 'https://ui.shadcn.com/docs/forms/react-hook-form')
  .option('-h, --headless <boolean>', 'Run browser in headless mode (true/false)', 'false')
  .option('-s, --steps <number>', 'Maximum steps for AI loop', '10')
  .parse(process.argv);

const options = program.opts();

// Determine configuration
const headless = options.headless === 'true';
const mode = (options.mode === 'ai' || options.mode === 'heuristic') ? options.mode : 'heuristic';
const url = options.url;
const maxSteps = parseInt(options.steps, 10) || 10;

const config: AgentConfig = {
  headless,
  mode,
  maxSteps,
  url,
};

async function main() {
  console.log(chalk.bold.magenta('\n============================================='));
  console.log(chalk.bold.magenta('        WEBSITE AUTOMATION AGENT             '));
  console.log(chalk.bold.magenta('=============================================\n'));

  // If AI mode is requested, check if API key exists. If not, auto-toggle to heuristic.
  if (config.mode === 'ai' && (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === '')) {
    console.log(chalk.yellow('[NOTICE] GEMINI_API_KEY is not defined in your .env file.'));
    console.log(chalk.yellow('[NOTICE] Automatically fallback to HEURISTIC mode for out-of-the-box reliability.\n'));
    config.mode = 'heuristic';
  }

  console.log(chalk.cyan(`Configured Mode:   ${chalk.bold(config.mode.toUpperCase())}`));
  console.log(chalk.cyan(`Target URL:        ${chalk.bold(config.url)}`));
  console.log(chalk.cyan(`Headless:          ${chalk.bold(config.headless.toString())}`));
  console.log(chalk.cyan(`Max Steps (AI):    ${chalk.bold(config.maxSteps.toString())}`));
  console.log(chalk.gray('---------------------------------------------\n'));

  const orchestrator = new AgentOrchestrator(config);
  await orchestrator.run();
}

main().catch((err) => {
  console.error(chalk.red('Fatal execution error:'));
  console.error(err);
  process.exit(1);
});
