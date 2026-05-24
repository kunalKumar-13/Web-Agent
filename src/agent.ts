import { Page } from 'playwright';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { BrowserManager } from './browser';
import { ElementDetector } from './detector';
import { InteractiveElement, AgentAction, AgentConfig } from './types';

export class AgentOrchestrator {
  private browserManager: BrowserManager;
  private config: AgentConfig;
  private step = 1;
  private aiClient: GoogleGenAI | null = null;
  private screenshotsDir: string;

  constructor(config: AgentConfig) {
    this.config = config;
    this.browserManager = new BrowserManager(config.headless);
    
    // Save screenshots inside the workspace screenshots directory
    this.screenshotsDir = path.join('C:\\Users\\kunal\\Desktop\\Website-Agent', 'screenshots');
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }

    // Initialize Gemini client if API key is provided and mode is AI
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (config.mode === 'ai' && apiKey.trim() !== '') {
      this.aiClient = new GoogleGenAI({ apiKey });
      this.logInfo('AI Client initialized using Gemini 2.5 Flash.');
    } else if (config.mode === 'ai') {
      this.logWarning('GEMINI_API_KEY not found in environment. Defaulting to Heuristic Mode.');
      this.config.mode = 'heuristic';
    }
  }

  // --- Logger Helpers ---
  private logThinking(message: string) {
    console.log(chalk.blue(`[THINKING] 🧠 ${message}`));
  }

  private logSuccess(message: string) {
    console.log(chalk.green(`[SUCCESS] ✅ ${message}`));
  }

  private logAction(message: string) {
    console.log(chalk.cyan(`[ACTION] ⚙️  ${message}`));
  }

  private logWarning(message: string) {
    console.log(chalk.yellow(`[WARNING] ⚠️  ${message}`));
  }

  private logError(message: string, error?: any) {
    console.error(chalk.red(`[ERROR] ❌ ${message}`));
    if (error) console.error(chalk.red(error.stack || error));
  }

  private logInfo(message: string) {
    console.log(chalk.gray(`[INFO] ℹ️  ${message}`));
  }

  /**
   * Run the agent execution loop
   */
  public async run(): Promise<void> {
    this.logInfo(`Starting Automation Agent in ${chalk.bold(this.config.mode.toUpperCase())} mode.`);
    this.logInfo(`Target URL: ${this.config.url}`);

    try {
      const page = await this.browserManager.openBrowser();
      this.logSuccess('Browser instance launched successfully.');

      this.logAction(`Navigating to ${this.config.url}...`);
      await this.browserManager.navigateToUrl(this.config.url);
      this.logSuccess('Navigation complete.');

      // Initial scroll down a bit to reveal page content (Shadcn docs forms are lower down)
      this.logAction('Performing initial scroll to reveal form content...');
      await this.browserManager.scroll('down', 500);

      if (this.config.mode === 'ai' && this.aiClient) {
        await this.runAILoop(page);
      } else {
        await this.runHeuristicLoop(page);
      }
    } catch (error) {
      this.logError('Fatal error encountered during agent execution:', error);
    } finally {
      this.logAction('Closing browser context...');
      await this.browserManager.closeBrowser();
      this.logSuccess('Browser closed. Automation execution finished.');
    }
  }

  /**
   * AI-Driven Execution Loop
   */
  private async runAILoop(page: Page): Promise<void> {
    const taskDescription = 'Locate the form elements on the page (such as Name/Username and Description fields). Automatically fill in the Name and Description, then submit the form.';
    
    while (this.step <= this.config.maxSteps) {
      this.logInfo(`\n--- Step ${this.step} of ${this.config.maxSteps} ---`);

      // 1. Detect elements
      this.logAction('Scanning for interactive elements on the page...');
      const elements = await ElementDetector.detectElements(page);
      this.logInfo(`Detected ${elements.length} interactive elements.`);

      // 2. Draw visual badges
      await ElementDetector.drawBadges(page, elements);

      // 3. Take screenshot with badges overlayed
      const screenshotPath = path.join(this.screenshotsDir, `step-${this.step}.png`);
      await this.browserManager.takeScreenshot(screenshotPath);
      this.logSuccess(`Screenshot saved to: ${screenshotPath}`);

      // 4. Remove badges for clean interactions
      await ElementDetector.removeBadges(page);

      // 5. Query Gemini
      this.logThinking('Consulting Gemini for the next action...');
      let agentAction: AgentAction;
      try {
        agentAction = await this.getAIResponse(elements, screenshotPath, taskDescription);
      } catch (err) {
        this.logWarning('AI decision query failed. Falling back to Heuristic Mode for this step...');
        await this.executeHeuristicFallback(page, elements);
        this.step++;
        continue;
      }

      this.logThinking(`Gemini's Decision: "${agentAction.reason}"`);
      this.logAction(`Action: ${agentAction.action.toUpperCase()}${agentAction.elementId ? ` on Element ID: ${agentAction.elementId}` : ''}`);

      // 6. Execute action
      if (agentAction.action === 'complete') {
        this.logSuccess('Task marked as COMPLETE by AI Agent.');
        break;
      }

      await this.executeAction(page, agentAction, elements);
      
      this.step++;
      await page.waitForTimeout(1500); // Small cooldown
    }
  }

  /**
   * Sends screenshot and elements list to Gemini
   */
  private async getAIResponse(
    elements: InteractiveElement[],
    screenshotPath: string,
    taskDescription: string
  ): Promise<AgentAction> {
    if (!this.aiClient) throw new Error('AI client not initialized.');

    // Prepare image payload
    const imageBuffer = fs.readFileSync(screenshotPath);
    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: 'image/png',
      },
    };

    const systemPrompt = `You are an autonomous web automation agent. Your task: "${taskDescription}".
We have captured a screenshot of the current page. We scanned the page and overlaid bright red badges with numbers on all interactable elements.
Below is the JSON list of these elements. Each element has an 'id' that matches the number on its red badge in the screenshot.

Analyze the screenshot and the list of elements. Choose the next logical action. 

Your options:
1. Click: {"action": "click", "elementId": number, "reason": "explanation"}
2. Type: {"action": "type", "elementId": number, "text": "text to type", "reason": "explanation"}
3. Scroll: {"action": "scroll", "direction": "down" | "up", "reason": "explanation"}
4. Wait: {"action": "wait", "reason": "explanation"}
5. Complete: {"action": "complete", "reason": "explanation"}

RULES:
- Respond ONLY with a valid JSON object matching one of the schemas above.
- Do NOT output markdown formatting, code blocks (like \`\`\`json), or explanations outside of the JSON.
- Prefer utilizing 'elementId' for actions, which allows us to use stable CSS selectors.
- If you believe the form is successfully filled and submitted, choose "complete".`;

    const elementsListText = JSON.stringify(
      elements.map((el) => ({
        id: el.id,
        tagName: el.tagName,
        type: el.type,
        label: el.label,
        placeholder: el.placeholder,
        text: el.text,
      })),
      null,
      2
    );

    const response = await this.browserManager.retry(async () => {
      return await this.aiClient!.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          systemPrompt,
          imagePart,
          `Interactive elements list:\n${elementsListText}`,
        ],
        config: {
          responseMimeType: 'application/json',
        },
      });
    });

    const responseText = response.text?.trim() || '';
    
    try {
      return JSON.parse(responseText) as AgentAction;
    } catch (e) {
      this.logWarning(`Failed to parse Gemini response as JSON. Raw response: ${responseText}`);
      throw e;
    }
  }

  /**
   * Executes a specific AgentAction
   */
  private async executeAction(page: Page, action: AgentAction, elements: InteractiveElement[]): Promise<void> {
    const el = action.elementId ? elements.find((e) => e.id === action.elementId) : null;

    switch (action.action) {
      case 'click':
        if (el) {
          this.logAction(`Clicking element: "${el.label || el.text || el.placeholder || el.selector}"`);
          await this.browserManager.clickElement(el.selector);
        } else if (action.x !== undefined && action.y !== undefined) {
          this.logAction(`Clicking coordinates: (${action.x}, ${action.y})`);
          await this.browserManager.clickOnScreen(action.x, action.y);
        } else {
          this.logWarning('Click action requested but no valid elementId or coordinates provided.');
        }
        break;

      case 'double_click':
        if (el) {
          this.logAction(`Double clicking element: "${el.label || el.selector}"`);
          const box = await page.locator(el.selector).first().boundingBox();
          if (box) {
            await this.browserManager.doubleClick(box.x + box.width / 2, box.y + box.height / 2);
          }
        } else if (action.x !== undefined && action.y !== undefined) {
          await this.browserManager.doubleClick(action.x, action.y);
        }
        break;

      case 'type':
        if (!action.text) {
          this.logWarning('Type action requested but no text provided.');
          break;
        }
        if (el) {
          this.logAction(`Typing "${action.text}" into element: "${el.label || el.placeholder || el.selector}"`);
          await this.browserManager.typeInto(el.selector, action.text);
        } else {
          this.logAction(`Typing "${action.text}" at current focus`);
          await this.browserManager.sendKeys(action.text);
        }
        break;

      case 'scroll':
        const dir = action.text === 'up' || action.text === 'down' ? action.text : 'down';
        this.logAction(`Scrolling ${dir}...`);
        await this.browserManager.scroll(dir, 400);
        break;

      case 'wait':
        this.logAction('Waiting for 3 seconds...');
        await page.waitForTimeout(3000);
        break;

      case 'complete':
        this.logSuccess('Action execution marked complete.');
        break;
    }
  }

  /**
   * Heuristic fallback for single-step failure in AI mode
   */
  private async executeHeuristicFallback(page: Page, elements: InteractiveElement[]): Promise<void> {
    this.logInfo('Evaluating page layout semantically...');
    const formFields = this.findFormFieldsHeuristically(elements);
    
    if (formFields.nameField) {
      this.logAction(`Heuristic Type: "Agent User" -> "${formFields.nameField.label || formFields.nameField.selector}"`);
      await this.browserManager.typeInto(formFields.nameField.selector, 'Agent User');
    }
    if (formFields.descField) {
      this.logAction(`Heuristic Type: "Automated test description." -> "${formFields.descField.label || formFields.descField.selector}"`);
      await this.browserManager.typeInto(formFields.descField.selector, 'Automated test description.');
    }
    if (formFields.submitBtn) {
      this.logAction(`Heuristic Click: Submit Button -> "${formFields.submitBtn.text || formFields.submitBtn.selector}"`);
      await this.browserManager.clickElement(formFields.submitBtn.selector);
      this.logSuccess('Heuristic submission clicked.');
    }
  }

  /**
   * Heuristic-Driven Execution Loop
   */
  private async runHeuristicLoop(page: Page): Promise<void> {
    this.logInfo('\n--- Executing Heuristic Mode Form Fill ---');
    
    // Step 1: Detect elements
    this.logAction('Scanning for interactive elements...');
    const elements = await ElementDetector.detectElements(page);
    this.logInfo(`Detected ${elements.length} interactive elements.`);

    // Save initial screenshot
    const initScreenshot = path.join(this.screenshotsDir, 'heuristic-step-1-scan.png');
    await this.browserManager.takeScreenshot(initScreenshot);
    this.logSuccess(`Initial scan screenshot saved: ${initScreenshot}`);

    // Step 2: Extract Name, Description, and Submit elements
    const formFields = this.findFormFieldsHeuristically(elements);

    // Step 3: Draw badges & Screenshot for log verification
    await ElementDetector.drawBadges(page, elements);
    const badgesScreenshot = path.join(this.screenshotsDir, 'heuristic-step-2-badges.png');
    await this.browserManager.takeScreenshot(badgesScreenshot);
    await ElementDetector.removeBadges(page);
    this.logSuccess(`Badges scan screenshot saved: ${badgesScreenshot}`);

    // Step 4: Fill fields
    if (formFields.nameField) {
      this.logAction(`Identified Name/Username field (ID: ${formFields.nameField.id}, Label: "${formFields.nameField.label}")`);
      this.logAction('Typing "Agent User" into Name field...');
      await this.browserManager.typeInto(formFields.nameField.selector, 'Agent User');
      
      const stepNameScreenshot = path.join(this.screenshotsDir, 'heuristic-step-3-name.png');
      await this.browserManager.takeScreenshot(stepNameScreenshot);
    } else {
      this.logWarning('Could not identify a Name/Username field.');
    }

    if (formFields.descField) {
      this.logAction(`Identified Description field (ID: ${formFields.descField.id}, Label: "${formFields.descField.label}")`);
      this.logAction('Typing "This form was successfully filled by our autonomous website agent using TypeScript and Playwright."...');
      await this.browserManager.typeInto(formFields.descField.selector, 'This form was successfully filled by our autonomous website agent using TypeScript and Playwright.');
      
      const stepDescScreenshot = path.join(this.screenshotsDir, 'heuristic-step-4-desc.png');
      await this.browserManager.takeScreenshot(stepDescScreenshot);
    } else {
      // In case there is no explicit description field on this specific shadcn documentation page (which sometimes only has a single Username field), we continue.
      this.logWarning('Could not identify a Description field. Continuing...');
    }

    // Step 5: Submit form
    if (formFields.submitBtn) {
      this.logAction(`Identified Submit Button (ID: ${formFields.submitBtn.id}, Text: "${formFields.submitBtn.text}")`);
      this.logAction('Clicking Submit button...');
      await this.browserManager.clickElement(formFields.submitBtn.selector);
      
      await page.waitForTimeout(2000); // Wait for submission action
      const stepSubmitScreenshot = path.join(this.screenshotsDir, 'heuristic-step-5-submitted.png');
      await this.browserManager.takeScreenshot(stepSubmitScreenshot);
      this.logSuccess(`Submission complete. Final state screenshot saved: ${stepSubmitScreenshot}`);
    } else {
      this.logWarning('Could not identify a Submit button.');
    }

    this.logSuccess('Heuristic Form Fill Process Complete!');
  }

  /**
   * Weighted scoring to identify fields matching Name/Username, Description, and Submit button
   */
  private findFormFieldsHeuristically(elements: InteractiveElement[]): {
    nameField: InteractiveElement | null;
    descField: InteractiveElement | null;
    submitBtn: InteractiveElement | null;
  } {
    let bestName: { el: InteractiveElement; score: number } | null = null;
    let bestDesc: { el: InteractiveElement; score: number } | null = null;
    let bestSubmit: { el: InteractiveElement; score: number } | null = null;

    for (const el of elements) {
      const tagName = el.tagName.toLowerCase();
      const type = el.type.toLowerCase();
      const label = el.label.toLowerCase();
      const placeholder = el.placeholder.toLowerCase();
      const name = el.name.toLowerCase();
      const idAttr = el.idAttribute.toLowerCase();
      const text = el.text.toLowerCase();

      // --- 1. Score for Name / Username ---
      if (tagName === 'input' && (type === 'text' || type === '')) {
        let score = 0;
        // Label matches (highest priority)
        if (label.includes('username')) score += 30;
        else if (label.includes('name')) score += 20;

        // Placeholder matches
        if (placeholder.includes('username')) score += 25;
        else if (placeholder.includes('name')) score += 15;

        // Name / ID attribute matches
        if (name.includes('username')) score += 20;
        else if (name.includes('name')) score += 10;
        if (idAttr.includes('username')) score += 20;
        else if (idAttr.includes('name')) score += 10;

        if (score > 0 && (!bestName || score > bestName.score)) {
          bestName = { el, score };
        }
      }

      // --- 2. Score for Description ---
      if (tagName === 'textarea' || (tagName === 'input' && (type === 'text' || type === ''))) {
        let score = 0;
        // Textarea gets a weight bonus for descriptions
        if (tagName === 'textarea') score += 10;

        // Label matches
        if (label.includes('description') || label.includes('desc')) score += 30;
        else if (label.includes('bio') || label.includes('about')) score += 25;

        // Placeholder matches
        if (placeholder.includes('description') || placeholder.includes('desc')) score += 25;
        else if (placeholder.includes('bio') || placeholder.includes('about')) score += 20;

        // Name / ID attribute matches
        if (name.includes('description') || name.includes('desc') || name.includes('bio')) score += 15;
        if (idAttr.includes('description') || idAttr.includes('desc') || idAttr.includes('bio')) score += 15;

        // Avoid overlap with the name field
        if (bestName && el.id === bestName.el.id) score = 0;

        if (score > 0 && (!bestDesc || score > bestDesc.score)) {
          bestDesc = { el, score };
        }
      }

      // --- 3. Score for Submit Button ---
      if (tagName === 'button' || (tagName === 'input' && (type === 'submit' || type === 'button'))) {
        let score = 0;

        // Submit/Submit labels
        if (text.includes('submit')) score += 30;
        else if (text.includes('create') || text.includes('save') || text.includes('send')) score += 20;
        else if (text.length > 0) score += 5; // Any button gets tiny score

        if (type === 'submit') score += 15;

        if (score > 0 && (!bestSubmit || score > bestSubmit.score)) {
          bestSubmit = { el, score };
        }
      }
    }

    return {
      nameField: bestName ? bestName.el : null,
      descField: bestDesc ? bestDesc.el : null,
      submitBtn: bestSubmit ? bestSubmit.el : null,
    };
  }
}
