/**
 * Tools: click_on_screen(x, y) and double_click(x, y).
 *
 * These are GENUINE coordinate-based mouse operations via Playwright's
 * `page.mouse` — not selector clicks. The agent resolves an element to fresh
 * viewport coordinates first, then calls these.
 */
import { Page } from 'playwright';
import * as logger from '../logger';

export function clickOnScreen(page: Page, x: number, y: number): Promise<void> {
  return logger.step(`click_on_screen(${Math.round(x)}, ${Math.round(y)})`, async () => {
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
  });
}

export function doubleClick(page: Page, x: number, y: number): Promise<void> {
  return logger.step(`double_click(${Math.round(x)}, ${Math.round(y)})`, async () => {
    await page.mouse.move(x, y);
    await page.mouse.dblclick(x, y);
  });
}
