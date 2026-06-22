/**
 * AI planner — provider-agnostic.
 *
 * It builds one text prompt (indexed element list + goal), asks an `LlmClient`
 * (Groq or Gemini — see llm.ts) for a JSON-array action plan, and validates the
 * response. The model only ever sees the element indices; it returns actions
 * referencing those indices, using the SAME vocabulary as the heuristic planner
 * (incl. double_click and direction-aware scroll). Unknown action types and
 * out-of-range indices are dropped; a non-JSON response fails loudly.
 */
import { Planner } from './planner';
import { LlmClient } from './llm';
import { PageSnapshot, Goal, Action, ACTION_TYPES } from '../types';
import * as logger from '../logger';

export class AiPlanner implements Planner {
  readonly name: string;

  constructor(private client: LlmClient) {
    this.name = `ai:${client.name}`;
  }

  async plan(snapshot: PageSnapshot, goal: Goal): Promise<Action[]> {
    const prompt = buildPrompt(snapshot, goal);

    const text = await logger.step(`ai.plan(${this.client.name}:${this.client.model})`, () =>
      this.client.complete(prompt)
    );

    const validIdx = new Set(snapshot.elements.map((e) => e.idx));
    const actions = parseAndValidate(text, validIdx);
    logger.log.think(`${this.name} proposed ${actions.length} valid action(s)`);
    return actions;
  }
}

/** Build the provider-agnostic planning prompt. */
export function buildPrompt(snapshot: PageSnapshot, goal: Goal): string {
  const list = snapshot.elements.slice(0, 200).map((e) => ({
    idx: e.idx,
    tag: e.tagName,
    type: e.type || undefined,
    role: e.role || undefined,
    label: e.label || undefined,
    placeholder: e.placeholder || undefined,
    name: e.name || undefined,
    text: e.text || undefined,
    formIndex: e.formIndex,
  }));

  return [
    'You are a web-automation planner. Reply with ONLY a JSON array of action objects.',
    'No prose, no markdown, no code fences, no wrapper object — just the array.',
    '',
    `TASK: ${goal.taskDescription}`,
    `- Type "${goal.primaryValue}" into the primary single-line field (name/title/subject).`,
    `- Type "${goal.descriptionValue}" into the description field (usually a <textarea>).`,
    goal.submit ? "- Then click the form's submit button." : '- Do not submit.',
    '',
    'Allowed actions (use these exact shapes):',
    '{"type":"double_click","idx":N,"reason":"..."}   // focus a field, selecting existing text',
    '{"type":"type","idx":N,"text":"...","reason":"..."}',
    '{"type":"click","idx":N,"reason":"..."}',
    '{"type":"scroll","direction":"down"|"up","amount":400,"reason":"..."}',
    '{"type":"wait","ms":1000,"reason":"..."}',
    '{"type":"done","reason":"..."}',
    '',
    'RULES:',
    '- idx must reference an element from the list below.',
    '- Keep the primary and description fields in the SAME formIndex.',
    '- To fill a field: double_click it, then type into it.',
    '- Finish with the submit click (if asked), then a "done" action.',
    '',
    `PAGE: ${snapshot.formCount} form(s), ${snapshot.elements.length} interactive elements.`,
    'ELEMENTS:',
    JSON.stringify(list),
    '',
    'Return the JSON array now.',
  ].join('\n');
}

/**
 * Parse the model output into a JSON array and validate each action.
 * Exported so it can be unit-tested offline (see ai.test.ts) without any
 * network call or API key. Tolerant of code fences, a wrapper object
 * ({actions:[...]}), or surrounding prose — but still throws on non-JSON.
 */
export function parseAndValidate(raw: string, validIdx: Set<number>): Action[] {
  const arr = extractActionArray(raw);

  const out: Action[] = [];
  for (const item of arr) {
    const action = coerceAction(item, validIdx);
    if (action) out.push(action);
    else logger.log.debug(`Dropped invalid AI action: ${JSON.stringify(item)}`);
  }
  if (out.length === 0) throw new Error('AI returned no valid actions');
  return out;
}

/** Extract the JSON action array from raw model text (provider-tolerant). */
function extractActionArray(raw: string): unknown[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Salvage: grab the first [...] block if the model wrapped it in prose.
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        /* fall through to the throw below */
      }
    }
    if (parsed === undefined) {
      throw new Error(`AI response was not valid JSON: ${cleaned.slice(0, 200)}`);
    }
  }

  if (Array.isArray(parsed)) return parsed;

  // Some models wrap the array in an object — accept common keys.
  if (parsed && typeof parsed === 'object') {
    for (const key of ['actions', 'plan', 'steps', 'tool_calls']) {
      const value = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }

  throw new Error('AI response JSON was not an array of actions');
}

function coerceAction(item: unknown, validIdx: Set<number>): Action | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(type)) return null;

  const reason = typeof o.reason === 'string' ? o.reason : '';
  const idxOk = typeof o.idx === 'number' && Number.isInteger(o.idx) && validIdx.has(o.idx);

  switch (type) {
    case 'click':
      return idxOk ? { type: 'click', idx: o.idx as number, reason } : null;
    case 'double_click':
      return idxOk ? { type: 'double_click', idx: o.idx as number, reason } : null;
    case 'type':
      return idxOk && typeof o.text === 'string' && o.text.length > 0
        ? { type, idx: o.idx as number, text: o.text, reason }
        : null;
    case 'scroll': {
      const dir = o.direction === 'up' ? 'up' : o.direction === 'down' ? 'down' : null;
      if (!dir) return null;
      const amount = typeof o.amount === 'number' ? o.amount : undefined;
      return { type, direction: dir, amount, reason };
    }
    case 'wait':
      return { type, ms: typeof o.ms === 'number' ? o.ms : 800, reason };
    case 'done':
      return { type, reason };
    default:
      return null;
  }
}
