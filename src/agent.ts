/**
 * ACT layer — the orchestration loop that ties perceive → decide → act.
 *
 * Key design point: JUST-IN-TIME COORDINATE RESOLUTION. Viewport coordinates
 * captured during perception go stale the moment the page scrolls or reflows.
 * So for every targeted action the agent re-resolves the element from its stable
 * selector → scrollIntoViewIfNeeded → reads a FRESH bounding box → computes the
 * centre → performs a genuine coordinate mouse op there.
 */
import { Page } from 'playwright';
import { AgentConfig } from './config';
import { Planner } from './planners/planner';
import { perceive } from './detector';
import { Action, Goal, PageSnapshot, ElementInfo, VerifyResult } from './types';
import * as logger from './logger';
import {
  openBrowser,
  closeBrowser,
  navigateToUrl,
  takeScreenshot,
  clickOnScreen,
  doubleClick,
  sendKeys,
  pressKey,
  scroll,
  BrowserSession,
} from './tools';

const SELECT_ALL = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

export class Agent {
  private shotCount = 0;

  constructor(private config: AgentConfig, private planner: Planner) {}

  /** Open → navigate → run the planner loop → verify → clean up. */
  async run(): Promise<VerifyResult> {
    const goal: Goal = {
      primaryValue: this.config.name,
      descriptionValue: this.config.description,
      submit: true,
      taskDescription:
        'Find the form on the page that has a name/title field and a description field, ' +
        'fill both, and submit it.',
    };

    let session: BrowserSession | null = null;
    try {
      session = await openBrowser({ headless: this.config.headless, slowmo: this.config.slowmo });
      const page = session.page;

      await navigateToUrl(page, this.config.url, this.config.timeout);
      await this.shot(page, 'loaded');

      if (this.config.mode === 'heuristic') {
        // The heuristic planner returns a complete plan in one pass.
        await this.cycle(page, goal, 1);
      } else {
        // AI mode: perceive → plan → act, looping until done or out of steps.
        for (let step = 1; step <= this.config.maxSteps; step++) {
          const done = await this.cycle(page, goal, step);
          if (done) break;
          if ((await this.verify(page, 1500)).success) break;
        }
      }

      const result = await this.verify(page, 4000);
      logger.event('verify', result);
      // Let any success toast finish animating in before the final screenshot
      // (a planner may not emit a post-submit wait of its own).
      if (result.success) await page.waitForTimeout(1200);
      await this.shot(page, 'final');
      if (result.success) logger.log.success(`Success confirmed: ${result.detail}`);
      else logger.log.warn(`Could not confirm success: ${result.detail}`);
      return result;
    } catch (err) {
      logger.log.error(`Run failed: ${String(err)}`);
      if (session) await takeScreenshot(session.page, this.config.outDir, 'error').catch(() => {});
      throw err;
    } finally {
      const logFile = logger.flush(this.config.outDir);
      if (logFile) logger.log.info(`Audit trail: ${logFile}`);
      if (session) await closeBrowser(session).catch(() => {});
    }
  }

  /** One perceive → plan → execute cycle. Returns true if a 'done' was issued. */
  private async cycle(page: Page, goal: Goal, step: number): Promise<boolean> {
    const snapshot = await perceive(page);
    logger.log.info(
      `Step ${step}: perceived ${snapshot.elements.length} elements in ${snapshot.formCount} forms; ` +
        `planning with "${this.planner.name}"`
    );

    const actions = await this.planner.plan(snapshot, goal);
    logger.log.info(`Planned ${actions.length} action(s)`);

    let done = false;
    for (const action of actions) {
      await this.execute(page, action, snapshot);
      if (action.type === 'done') done = true;
    }
    return done;
  }

  /** Execute a single action, resolving fresh coordinates just before acting. */
  private async execute(page: Page, action: Action, snapshot: PageSnapshot): Promise<void> {
    logger.log.action(`${action.type}${'idx' in action ? ` #${action.idx}` : ''} — ${action.reason}`);
    try {
      switch (action.type) {
        case 'click': {
          const { x, y } = await this.resolve(page, action.idx, snapshot);
          await clickOnScreen(page, x, y);
          break;
        }
        case 'double_click': {
          const { x, y } = await this.resolve(page, action.idx, snapshot);
          await doubleClick(page, x, y);
          break;
        }
        case 'type':
          await this.typeInto(page, action.idx, action.text, snapshot);
          break;
        case 'scroll':
          await scroll(page, action.direction, action.amount ?? 500);
          break;
        case 'wait':
          await page.waitForTimeout(action.ms);
          break;
        case 'done':
          break;
      }
      const shot = await this.shot(page, action.type);
      logger.recordAction(action, true, shot);
    } catch (err) {
      logger.recordAction(action, false);
      throw err;
    }
  }

  /**
   * Resolve an element index to fresh viewport coordinates:
   * selector → scrollIntoViewIfNeeded → fresh bounding box → centre.
   */
  private async resolve(page: Page, idx: number, snapshot: PageSnapshot): Promise<{ x: number; y: number }> {
    const el = this.find(snapshot, idx);
    const locator = page.locator(el.selector).first();
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Element ${el.selector} (#${idx}) has no bounding box (not visible)`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /**
   * Type into a field: rely on the focus from a preceding double_click; if the
   * field isn't focused, focus it with a genuine coordinate click. Then
   * select-all (clear) and type via send_keys.
   */
  private async typeInto(page: Page, idx: number, text: string, snapshot: PageSnapshot): Promise<void> {
    const el = this.find(snapshot, idx);
    const { x, y } = await this.resolve(page, idx, snapshot);
    const focused = await page.evaluate(
      (sel) => document.activeElement === document.querySelector(sel),
      el.selector
    );
    if (!focused) await clickOnScreen(page, x, y);
    await pressKey(page, SELECT_ALL);
    await sendKeys(page, text);
  }

  private find(snapshot: PageSnapshot, idx: number): ElementInfo {
    const el = snapshot.elements.find((e) => e.idx === idx);
    if (!el) throw new Error(`No element with idx ${idx} in snapshot`);
    return el;
  }

  /** Numbered screenshot for the step filmstrip. */
  private shot(page: Page, label: string): Promise<string> {
    const seq = String(++this.shotCount).padStart(2, '0');
    return takeScreenshot(page, this.config.outDir, `${seq}-${label}`);
  }

  /**
   * Verify submission succeeded: look for a sonner/radix toast or a status
   * region, falling back to a body-text scan for confirmation keywords.
   */
  private async verify(page: Page, timeout: number): Promise<VerifyResult> {
    try {
      const handle = await page.waitForSelector(
        '[data-sonner-toast], [role="status"], [data-radix-toast-root], li[data-type]',
        { timeout }
      );
      const text = (await handle.innerText()).replace(/\s+/g, ' ').trim();
      if (text) return { success: true, detail: text.slice(0, 200) };
    } catch {
      // fall through to text scan
    }

    const found = await page.evaluate(() => {
      const re = /submitted|success|thank you|saved|received|created/i;
      const nodes = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
      const hit = nodes.find((e) => e.children.length === 0 && re.test(e.textContent || ''));
      return hit ? (hit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
    });
    return found ? { success: true, detail: found } : { success: false, detail: 'no confirmation detected' };
  }
}
