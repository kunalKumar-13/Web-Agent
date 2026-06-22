/**
 * Tool: scroll.
 * Direction-aware wheel scroll (genuine mouse wheel), then a short settle so
 * any lazy content / animations finish.
 */
import { Page } from 'playwright';
import * as logger from '../logger';

export function scroll(page: Page, direction: 'up' | 'down', amount = 500): Promise<void> {
  return logger.step(`scroll(${direction}, ${amount})`, async () => {
    const deltaY = direction === 'down' ? amount : -amount;
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(500);
  });
}
