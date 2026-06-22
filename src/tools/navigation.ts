/**
 * Tool: navigate_to_url.
 * Goes to a URL and waits for the client-rendered content to settle (the
 * shadcn docs mount their live form previews after load).
 */
import { Page } from 'playwright';
import * as logger from '../logger';

export function navigateToUrl(page: Page, url: string, timeout: number): Promise<void> {
  return logger.step(`navigate_to_url(${url})`, async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    // Best-effort wait for network idle, then a short settle for hydration.
    await page.waitForLoadState('networkidle', { timeout: Math.min(15000, timeout) }).catch(() => {});
    await page.waitForTimeout(1200);
  });
}
