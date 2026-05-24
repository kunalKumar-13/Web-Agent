import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private headless: boolean;

  constructor(headless: boolean = false) {
    this.headless = headless;
  }

  /**
   * Generic retry utility for robust operations
   */
  public async retry<T>(fn: () => Promise<T>, retries: number = 3, delay: number = 1000): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        }
      }
    }
    throw lastError;
  }

  /**
   * Launch the browser and create a new context/page
   */
  public async openBrowser(): Promise<Page> {
    return this.retry(async () => {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      this.page = await this.context.newPage();
      return this.page;
    });
  }

  /**
   * Navigate to a URL
   */
  public async navigateToUrl(url: string): Promise<void> {
    if (!this.page) throw new Error('Browser is not open. Call openBrowser() first.');
    await this.retry(async () => {
      await this.page!.goto(url, { waitUntil: 'load', timeout: 30000 });
      // Wait a short time for hydration/animations
      await this.page!.waitForTimeout(2000);
    });
  }

  /**
   * Take screenshot of the page and save it
   */
  public async takeScreenshot(filePath: string): Promise<string> {
    if (!this.page) throw new Error('Browser is not open. Call openBrowser() first.');
    return this.retry(async () => {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await this.page!.screenshot({ path: filePath, fullPage: false });
      return filePath;
    });
  }

  /**
   * Visual animation overlay before actions
   */
  private async showVisualFeedback(x: number, y: number, color: string = '#ff3b30'): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.evaluate(({ x, y, color }) => {
        const marker = document.createElement('div');
        marker.id = 'agent-click-marker';
        marker.style.position = 'fixed';
        marker.style.left = `${x - 15}px`;
        marker.style.top = `${y - 15}px`;
        marker.style.width = '30px';
        marker.style.height = '30px';
        marker.style.borderRadius = '50%';
        marker.style.backgroundColor = 'transparent';
        marker.style.border = `3px solid ${color}`;
        marker.style.boxShadow = `0 0 10px ${color}`;
        marker.style.zIndex = '999999';
        marker.style.pointerEvents = 'none';
        marker.style.transition = 'transform 0.4s ease-out, opacity 0.4s ease-out';
        marker.style.transform = 'scale(0.5)';
        marker.style.opacity = '1';
        document.body.appendChild(marker);

        // Force reflow
        marker.getBoundingClientRect();
        marker.style.transform = 'scale(1.5)';
        marker.style.opacity = '0';

        setTimeout(() => {
          marker.remove();
        }, 500);
      }, { x, y, color });

      await this.page.waitForTimeout(400);
    } catch (e) {
      // Ignore visual feedback failures
    }
  }

  /**
   * Click on specific coordinates on screen (Visual cursor effect included)
   */
  public async clickOnScreen(x: number, y: number): Promise<void> {
    if (!this.page) throw new Error('Browser is not open.');
    await this.retry(async () => {
      await this.showVisualFeedback(x, y);
      await this.page!.mouse.click(x, y);
    });
  }

  /**
   * Double click on specific coordinates on screen
   */
  public async doubleClick(x: number, y: number): Promise<void> {
    if (!this.page) throw new Error('Browser is not open.');
    await this.retry(async () => {
      await this.showVisualFeedback(x, y, '#ff9500');
      await this.page!.mouse.dblclick(x, y);
    });
  }

  /**
   * Click an element by selector (stabilized selector click)
   */
  public async clickElement(selector: string): Promise<void> {
    if (!this.page) throw new Error('Browser is not open.');
    await this.retry(async () => {
      const element = this.page!.locator(selector).first();
      const box = await element.boundingBox();
      if (box) {
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        await this.showVisualFeedback(centerX, centerY);
      }
      await element.click({ timeout: 5000 });
    });
  }

  /**
   * Send keys/type text to the active focused element
   */
  public async sendKeys(text: string): Promise<void> {
    if (!this.page) throw new Error('Browser is not open.');
    await this.retry(async () => {
      await this.page!.keyboard.type(text, { delay: 50 });
      // Short delay after typing
      await this.page!.waitForTimeout(200);
    });
  }

  /**
   * Type text into a specific selector
   */
  public async typeInto(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error('Browser is not open.');
    await this.retry(async () => {
      const element = this.page!.locator(selector).first();
      await element.click({ timeout: 5000 });
      // Clear input first
      await this.page!.keyboard.press('Control+A');
      await this.page!.keyboard.press('Backspace');
      await this.page!.keyboard.type(text, { delay: 50 });
      await this.page!.waitForTimeout(200);
    });
  }

  /**
   * Scroll the page (down or up)
   */
  public async scroll(direction: 'down' | 'up', amount: number = 400): Promise<void> {
    if (!this.page) throw new Error('Browser is not open.');
    await this.retry(async () => {
      const deltaY = direction === 'down' ? amount : -amount;
      await this.page!.evaluate((y) => {
        window.scrollBy({ top: y, behavior: 'smooth' });
      }, deltaY);
      // Wait for scroll animation to settle
      await this.page!.waitForTimeout(1000);
    });
  }

  /**
   * Close browser
   */
  public async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  public getPage(): Page | null {
    return this.page;
  }
}
