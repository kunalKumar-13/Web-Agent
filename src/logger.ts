/**
 * Leveled console logging + a structured run-log.json audit trail.
 *
 * - The `log.*` helpers print colour-coded lines AND append a narrative entry.
 * - `step()` wraps an async tool call, timing it and recording success/failure.
 * - `recordAction()` logs an executed planner action.
 * - `flush()` writes the full audit trail to <outDir>/run-log.json.
 *
 * Implemented with raw ANSI codes so we add no logging dependency (chalk, etc).
 */
import * as fs from 'fs';
import * as path from 'path';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

type Level = 'debug' | 'info' | 'success' | 'warn' | 'error' | 'action' | 'think';
type EntryKind = 'tool' | 'action' | 'event' | 'error';

interface RunLogEntry {
  seq: number;
  kind: EntryKind;
  label: string;
  ok: boolean;
  ms?: number;
  detail?: unknown;
  screenshot?: string;
  ts: string;
}

let seq = 0;
let verbose = false;
const entries: RunLogEntry[] = [];
let meta: Record<string, unknown> = {};

function record(
  kind: EntryKind,
  label: string,
  ok: boolean,
  ms?: number,
  detail?: unknown,
  screenshot?: string
): void {
  entries.push({ seq: seq++, kind, label, ok, ms, detail, screenshot, ts: new Date().toISOString() });
}

function emit(level: Level, color: string, prefix: string, msg: string): void {
  if (level === 'debug' && !verbose) return;
  console.log(`${color}${prefix}${msg}${C.reset}`);
  if (level !== 'debug') record('event', `${level}: ${msg}`, level !== 'error' && level !== 'warn');
}

export const log = {
  info: (m: string) => emit('info', C.cyan, 'ℹ  ', m),
  success: (m: string) => emit('success', C.green, '✓  ', m),
  warn: (m: string) => emit('warn', C.yellow, '⚠  ', m),
  error: (m: string) => emit('error', C.red, '✗  ', m),
  action: (m: string) => emit('action', C.blue, '»  ', m),
  think: (m: string) => emit('think', C.magenta, '🧠 ', m),
  debug: (m: string) => emit('debug', C.gray, '   ', m),
};

export function setVerbose(v: boolean): void {
  verbose = v;
}

export function setMeta(m: Record<string, unknown>): void {
  meta = { ...meta, ...m };
}

/** Time + log an async tool call; records a 'tool' entry in the audit trail. */
export async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  process.stdout.write(`${C.gray}   ▶ ${label}${C.reset}\n`);
  try {
    const result = await fn();
    const ms = Date.now() - start;
    record('tool', label, true, ms);
    console.log(`${C.gray}   ✓ ${label} ${C.bold}(${ms}ms)${C.reset}`);
    return result;
  } catch (err) {
    const ms = Date.now() - start;
    record('tool', label, false, ms, { error: String(err) });
    console.log(`${C.red}   ✗ ${label} (${ms}ms): ${String(err)}${C.reset}`);
    throw err;
  }
}

/** Record an executed planner action (with an optional screenshot path). */
export function recordAction(action: { type: string; reason: string }, ok: boolean, screenshot?: string): void {
  record('action', `${action.type}`, ok, undefined, action, screenshot);
}

/** Record a structured event (does not print on its own). */
export function event(label: string, detail?: unknown): void {
  record('event', label, true, undefined, detail);
}

/** Persist the audit trail to <outDir>/run-log.json (never throws). */
export function flush(outDir: string): string | null {
  try {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, 'run-log.json');
    fs.writeFileSync(file, JSON.stringify({ meta, generatedAt: new Date().toISOString(), entries }, null, 2));
    return file;
  } catch {
    return null;
  }
}

/** Pretty banner for the CLI header. */
export function banner(title: string): void {
  const line = '═'.repeat(title.length + 6);
  console.log(`\n${C.bold}${C.magenta}╔${line}╗${C.reset}`);
  console.log(`${C.bold}${C.magenta}║   ${title}   ║${C.reset}`);
  console.log(`${C.bold}${C.magenta}╚${line}╝${C.reset}\n`);
}

/** Print a key/value config summary. */
export function summary(rows: Record<string, string>): void {
  for (const [k, v] of Object.entries(rows)) {
    console.log(`${C.cyan}${k.padEnd(13)}${C.reset}${C.bold}${v}${C.reset}`);
  }
  console.log(`${C.gray}${'─'.repeat(48)}${C.reset}`);
}
