/**
 * Tool: open_browser / close_browser.
 * Launches Chromium and creates an isolated context + page.
 */
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as logger from '../logger';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface OpenBrowserOptions {
  headless: boolean;
  slowmo: number;
  viewport?: { width: number; height: number };
}

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** open_browser: launch Chromium + a fresh context/page. */
export function openBrowser(opts: OpenBrowserOptions): Promise<BrowserSession> {
  return logger.step(`open_browser(headless=${opts.headless})`, async () => {
    const browser = await chromium.launch({
      headless: opts.headless,
      slowMo: opts.slowmo,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext({
      viewport: opts.viewport ?? { width: 1280, height: 800 },
      userAgent: MAC_UA,
    });
    const page = await context.newPage();
    return { browser, context, page };
  });
}

/** Close the browser (best-effort). */
export function closeBrowser(session: BrowserSession): Promise<void> {
  return logger.step('close_browser', async () => {
    await session.browser.close();
  });
}
