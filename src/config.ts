/**
 * Configuration resolution: .env (via dotenv, loaded in index.ts) provides the
 * defaults, and CLI flags override them. Everything funnels into one typed
 * `AgentConfig` object that the rest of the app consumes.
 */
import * as path from 'path';

export type Mode = 'heuristic' | 'ai';
export type Provider = 'groq' | 'gemini';

export interface AgentConfig {
  mode: Mode;
  /** Which LLM backend AI mode uses. */
  provider: Provider;
  url: string;
  /** Value for the primary (name/title) field. */
  name: string;
  /** Value for the description field. */
  description: string;
  headless: boolean;
  /** Output directory for screenshots + run-log.json (absolute). */
  outDir: string;
  /** Navigation / element timeout (ms). */
  timeout: number;
  /** Per-operation slow-motion delay (ms). */
  slowmo: number;
  /** Max plan/act cycles for AI mode. */
  maxSteps: number;
  geminiApiKey?: string;
  geminiModel: string;
  groqApiKey?: string;
  groqModel: string;
  verbose: boolean;
}

/** Raw CLI options (all optional; undefined means "not provided"). */
export interface CliOptions {
  mode?: string;
  provider?: string;
  url?: string;
  name?: string;
  description?: string;
  headless?: string | boolean;
  out?: string;
  timeout?: number;
  slowmo?: number;
  verbose?: boolean;
}

const DEFAULTS = {
  url: 'https://ui.shadcn.com/docs/forms/react-hook-form',
  name: 'Automated Test Entry',
  description: 'Filled automatically by an autonomous agent using Playwright and TypeScript.',
  outDir: 'output',
  timeout: 45000,
  slowmo: 0,
  maxSteps: 8,
  geminiModel: 'gemini-3.5-flash',
  groqModel: 'llama-3.3-70b-versatile',
};

function toBool(v: string | boolean | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (typeof v === 'boolean') return v; // bare `--headless` flag → true
  return v.trim().toLowerCase() === 'true';
}

function toInt(v: string | number | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Merge .env + CLI into a validated AgentConfig (CLI wins). */
export function buildConfig(cli: CliOptions): AgentConfig {
  const env = process.env;

  const rawMode = (cli.mode ?? env.MODE ?? 'heuristic').toLowerCase();
  const mode: Mode = rawMode === 'ai' ? 'ai' : 'heuristic';

  const rawProvider = (cli.provider ?? env.LLM_PROVIDER ?? 'groq').toLowerCase();
  const provider: Provider = rawProvider === 'gemini' ? 'gemini' : 'groq';

  return {
    mode,
    provider,
    url: cli.url ?? env.URL ?? DEFAULTS.url,
    name: cli.name ?? env.NAME_VALUE ?? DEFAULTS.name,
    description: cli.description ?? env.DESCRIPTION_VALUE ?? DEFAULTS.description,
    headless: toBool(cli.headless, toBool(env.HEADLESS, true)),
    outDir: path.resolve(process.cwd(), cli.out ?? env.OUT_DIR ?? DEFAULTS.outDir),
    timeout: toInt(cli.timeout, toInt(env.TIMEOUT, DEFAULTS.timeout)),
    slowmo: toInt(cli.slowmo, toInt(env.SLOWMO, DEFAULTS.slowmo)),
    maxSteps: toInt(env.MAX_STEPS, DEFAULTS.maxSteps),
    geminiApiKey: env.GEMINI_API_KEY?.trim() || undefined,
    geminiModel: env.GEMINI_MODEL?.trim() || DEFAULTS.geminiModel,
    groqApiKey: env.GROQ_API_KEY?.trim() || undefined,
    groqModel: env.GROQ_MODEL?.trim() || DEFAULTS.groqModel,
    verbose: cli.verbose ?? false,
  };
}
