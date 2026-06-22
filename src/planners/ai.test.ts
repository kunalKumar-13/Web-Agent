/**
 * Offline unit tests for the AI planner's JSON validator (`parseAndValidate`).
 *
 * These run with NO network and NO API key, so AI-mode parsing/validation has
 * coverage regardless of whether GEMINI_API_KEY is configured. Run via `npm test`.
 *
 * The validator is fed mock Gemini candidate text (the JSON the model would
 * return) and we assert it: (a) accepts a valid plan, (b) drops actions whose
 * target index is out of range, (c) drops unknown action types, (d) throws on
 * non-JSON. (Plus two bonus edge cases.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAndValidate } from './ai';
import { Action } from '../types';

// Indices the agent "perceived" on the page; the validator only trusts these.
const validIdx = new Set<number>([0, 4, 5, 7]);

function hasIdx(a: Action): a is Extract<Action, { idx: number }> {
  return 'idx' in a;
}

test('(a) accepts a valid plan', () => {
  const raw = JSON.stringify([
    { type: 'double_click', idx: 4, reason: 'focus title' },
    { type: 'type', idx: 4, text: 'Hello', reason: 'enter title' },
    { type: 'type', idx: 5, text: 'World', reason: 'enter description' },
    { type: 'click', idx: 7, reason: 'submit' },
    { type: 'done', reason: 'finished' },
  ]);
  const actions = parseAndValidate(raw, validIdx);
  assert.equal(actions.length, 5);
  assert.equal(actions[0].type, 'double_click');
  assert.equal(actions[4].type, 'done');
});

test('(b) drops actions with an out-of-range target index', () => {
  const raw = JSON.stringify([
    { type: 'click', idx: 999, reason: 'target does not exist' },
    { type: 'type', idx: 4, text: 'ok', reason: 'valid target' },
    { type: 'done', reason: 'finished' },
  ]);
  const actions = parseAndValidate(raw, validIdx);
  assert.equal(actions.length, 2); // the idx:999 click is dropped
  assert.ok(!actions.some((a) => hasIdx(a) && a.idx === 999));
});

test('(c) drops unknown action types', () => {
  const raw = JSON.stringify([
    { type: 'teleport', idx: 4, reason: 'not a real action' },
    { type: 'explode', reason: 'also not real' },
    { type: 'done', reason: 'finished' },
  ]);
  const actions = parseAndValidate(raw, validIdx);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'done');
});

test('(d) throws on non-JSON', () => {
  assert.throws(() => parseAndValidate('totally not json {[', validIdx));
});

// --- bonus edge cases ---

test('throws when the JSON is valid but not an array', () => {
  assert.throws(() => parseAndValidate(JSON.stringify({ type: 'done', reason: 'x' }), validIdx));
});

test('throws when no valid actions remain', () => {
  assert.throws(() => parseAndValidate(JSON.stringify([{ type: 'nope', reason: 'x' }]), validIdx));
});

test('strips ```json fences before parsing', () => {
  const fenced = '```json\n' + JSON.stringify([{ type: 'done', reason: 'ok' }]) + '\n```';
  const actions = parseAndValidate(fenced, validIdx);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'done');
});

test('drops a type action that is missing its text', () => {
  const raw = JSON.stringify([
    { type: 'type', idx: 4, reason: 'no text provided' },
    { type: 'done', reason: 'finished' },
  ]);
  const actions = parseAndValidate(raw, validIdx);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'done');
});
