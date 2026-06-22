/**
 * Heuristic planner — deterministic, form-scoped, role-based field matching.
 *
 * The target page renders SEVERAL example forms, so scoring fields globally
 * would pair a "name" from one form with a "description" from another (and find
 * no matching submit). Instead we:
 *   1. score every element for the primary / description roles,
 *   2. group by formIndex and pick the single form that best fills BOTH roles,
 *   3. find that form's submit button (inside it, or the nearest one by
 *      geometry — on this page the submit lives outside the <form>),
 *   4. emit a tool sequence: double_click (focus+select) → type, per field,
 *      then click submit.
 *
 * No specific form/field name is hardcoded — matching is by keyword + shape.
 */
import { Planner } from './planner';
import { PageSnapshot, Goal, Action, ElementInfo } from '../types';
import * as logger from '../logger';

interface Scored {
  el: ElementInfo;
  score: number;
}

const PRIMARY_KW = ['title', 'name', 'subject', 'summary', 'username', 'headline'];
const DESC_KW = ['description', 'message', 'details', 'comment', 'body', 'about', 'bio', 'feedback', 'notes', 'content'];
const SUBMIT_NEG = ['reset', 'cancel', 'clear', 'close', 'back', 'previous'];
const SUBMIT_POS = ['save', 'send', 'create', 'post', 'continue', 'add', 'apply'];

export class HeuristicPlanner implements Planner {
  readonly name = 'heuristic';

  async plan(snapshot: PageSnapshot, goal: Goal): Promise<Action[]> {
    const { elements } = snapshot;

    // Group elements by their owning form.
    const groups = new Map<number, ElementInfo[]>();
    for (const el of elements) {
      if (!groups.has(el.formIndex)) groups.set(el.formIndex, []);
      groups.get(el.formIndex)!.push(el);
    }

    // Choose the form that best fills both roles.
    let best: { formIndex: number; primary: ElementInfo | null; desc: ElementInfo | null; score: number } | null =
      null;
    for (const [formIndex, group] of groups) {
      if (formIndex === -1) continue; // genuine forms first; -1 is a fallback
      const primary = this.bestPrimary(group);
      const desc = this.bestDesc(group, primary?.el);
      if (!primary && !desc) continue;
      const score = (primary?.score ?? 0) + (desc?.score ?? 0) + (primary && desc ? 25 : 0);
      if (!best || score > best.score) {
        best = { formIndex, primary: primary?.el ?? null, desc: desc?.el ?? null, score };
      }
    }

    // Fallback: no <form> on the page — score across everything as one group.
    if (!best) {
      const primary = this.bestPrimary(elements);
      const desc = this.bestDesc(elements, primary?.el);
      best = { formIndex: -1, primary: primary?.el ?? null, desc: desc?.el ?? null, score: 0 };
    }

    const submit = goal.submit ? this.findSubmit(snapshot, best.formIndex, best.primary, best.desc) : null;

    logger.log.think(
      `Chosen form #${best.formIndex} → primary=${fmt(best.primary)} ` +
        `description=${fmt(best.desc)} submit=${fmt(submit)}`
    );

    // Build the action sequence from the seven tools.
    const actions: Action[] = [];
    const anchor = best.primary ?? best.desc;
    if (anchor && anchor.box.centerY > snapshot.viewport.height * 0.85) {
      actions.push({ type: 'scroll', direction: 'down', amount: 400, reason: 'Bring the target form into view' });
    }

    if (best.primary) {
      actions.push({
        type: 'double_click',
        idx: best.primary.idx,
        reason: `Focus the "${best.primary.label || 'primary'}" field and select any existing text`,
      });
      actions.push({
        type: 'type',
        idx: best.primary.idx,
        text: goal.primaryValue,
        reason: `Enter the name/title value`,
      });
    }

    if (best.desc) {
      actions.push({
        type: 'double_click',
        idx: best.desc.idx,
        reason: `Focus the "${best.desc.label || 'description'}" field and select any existing text`,
      });
      actions.push({
        type: 'type',
        idx: best.desc.idx,
        text: goal.descriptionValue,
        reason: `Enter the description value`,
      });
    }

    if (submit) {
      actions.push({ type: 'click', idx: submit.idx, reason: `Submit the form via "${submit.text || 'submit'}"` });
      actions.push({ type: 'wait', ms: 1500, reason: 'Wait for the submission result / toast' });
    }

    actions.push({ type: 'done', reason: 'Form filled' + (submit ? ' and submitted' : '') });
    return actions;
  }

  /** Score an element as the primary single-line field; null if not a candidate. */
  private bestPrimary(group: ElementInfo[]): Scored | null {
    let best: Scored | null = null;
    for (const el of group) {
      if (!el.isTextInput || el.isTextarea) continue;
      let score = 2; // base: any text input can serve as the primary field
      const L = el.label.toLowerCase();
      const P = el.placeholder.toLowerCase();
      const N = el.name.toLowerCase();
      if (PRIMARY_KW.some((k) => L.includes(k))) score += 30;
      else if (PRIMARY_KW.some((k) => P.includes(k))) score += 14;
      else if (PRIMARY_KW.some((k) => N.includes(k))) score += 12;
      if (!best || score > best.score) best = { el, score };
    }
    return best;
  }

  /** Score an element as the description field (textarea strongly preferred). */
  private bestDesc(group: ElementInfo[], primary?: ElementInfo): Scored | null {
    let best: Scored | null = null;
    for (const el of group) {
      if (primary && el.idx === primary.idx) continue; // don't reuse the primary
      let score: number;
      if (el.isTextarea) score = 20;
      else if (el.isTextInput) score = 0;
      else continue;
      const L = el.label.toLowerCase();
      const P = el.placeholder.toLowerCase();
      const N = el.name.toLowerCase();
      if (DESC_KW.some((k) => L.includes(k))) score += 30;
      else if (DESC_KW.some((k) => P.includes(k))) score += 14;
      else if (DESC_KW.some((k) => N.includes(k))) score += 12;
      if (score > 0 && (!best || score > best.score)) best = { el, score };
    }
    return best;
  }

  /** Score a button as a submit control (negative words disqualify it). */
  private scoreSubmit(el: ElementInfo): number {
    if (!el.isButton) return 0;
    const t = el.text.toLowerCase();
    if (SUBMIT_NEG.some((w) => t.includes(w))) return 0;
    let score = 0;
    if (el.type === 'submit') score += 20;
    if (t.includes('submit')) score += 30;
    else if (SUBMIT_POS.some((w) => t.includes(w))) score += 18;
    else if (t.length > 0) score += 3;
    return score;
  }

  /**
   * Find the submit button: prefer one inside the chosen form; otherwise pick
   * the nearest qualifying button below the fields by geometric proximity.
   */
  private findSubmit(
    snapshot: PageSnapshot,
    formIndex: number,
    primary: ElementInfo | null,
    desc: ElementInfo | null
  ): ElementInfo | null {
    const candidates = snapshot.elements.filter((el) => this.scoreSubmit(el) > 0);
    if (candidates.length === 0) return null;

    // 1. A submit inside the chosen form wins outright.
    if (formIndex !== -1) {
      const inForm = candidates.filter((c) => c.formIndex === formIndex);
      if (inForm.length) {
        return inForm.sort((a, b) => this.scoreSubmit(b) - this.scoreSubmit(a))[0];
      }
    }

    // 2. Otherwise, nearest button below the form's fields.
    const anchor = desc ?? primary;
    if (!anchor) return null;
    const ax = anchor.box.centerX;
    const ab = anchor.box.y + anchor.box.height;

    let best: ElementInfo | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const dy = c.box.centerY - ab;
      const dx = Math.abs(c.box.centerX - ax);
      if (dy < -80 || dy > 700 || dx > 700) continue; // must be near & roughly below
      const dist = Math.max(0, dy) + dx * 0.5 + (this.scoreSubmit(c) >= 30 ? 0 : 40);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    return best;
  }
}

function fmt(el: ElementInfo | null): string {
  if (!el) return 'none';
  return `#${el.idx}("${el.label || el.text || el.placeholder || el.tagName}")`;
}
