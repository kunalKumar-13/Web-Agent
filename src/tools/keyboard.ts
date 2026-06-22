/**
 * Tool: send_keys.
 * Types text into the currently focused element, and (helper) presses key
 * combinations such as select-all used when clearing a field before retyping.
 */
import { Page } from 'playwright';
import * as logger from '../logger';

function truncate(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** send_keys: type text into the focused element. */
export function sendKeys(page: Page, text: string): Promise<void> {
  return logger.step(`send_keys("${truncate(text)}")`, async () => {
    await page.keyboard.type(text, { delay: 25 });
  });
}

/** Press a key or key-combo (e.g. "Meta+A") on the focused element. */
export function pressKey(page: Page, combo: string): Promise<void> {
  return logger.step(`press_key(${combo})`, async () => {
    await page.keyboard.press(combo);
  });
}
