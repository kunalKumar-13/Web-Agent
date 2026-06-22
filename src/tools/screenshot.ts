/**
 * Tool: take_screenshot.
 * Captures the current viewport to <outDir>/<name>.png and returns the path.
 */
import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../logger';

export function takeScreenshot(page: Page, outDir: string, name: string): Promise<string> {
  const fileName = name.endsWith('.png') ? name : `${name}.png`;
  return logger.step(`take_screenshot(${fileName})`, async () => {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, fileName);
    await page.screenshot({ path: filePath, fullPage: false });
    return filePath;
  });
}
