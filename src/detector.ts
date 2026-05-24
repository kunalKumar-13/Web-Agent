import { Page } from 'playwright';
import { InteractiveElement } from './types';

/**
 * Extracts visible interactive elements from the DOM and draws visual badges on them
 */
export class ElementDetector {
  /**
   * Scans the page and returns all interactable elements
   */
  public static async detectElements(page: Page): Promise<InteractiveElement[]> {
    return await page.evaluate(() => {
      const interactives: InteractiveElement[] = [];
      let idCounter = 1;

      // Helper to generate a CSS selector for an element
      function getCSSSelector(el: HTMLElement): string {
        if (el.id) {
          return `#${CSS.escape(el.id)}`;
        }
        
        // Check for unique attribute selectors
        const attributes = ['name', 'placeholder', 'data-testid', 'aria-label'];
        for (const attr of attributes) {
          const val = el.getAttribute(attr);
          if (val) {
            const selector = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
            try {
              if (document.querySelectorAll(selector).length === 1) {
                return selector;
              }
            } catch (e) {
              // Ignore invalid selectors
            }
          }
        }

        // Fallback to building an nth-child path
        const path: string[] = [];
        let current: HTMLElement | null = el;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
          let selector = current.tagName.toLowerCase();
          if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children);
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-child(${index})`;
          }
          path.unshift(selector);
          current = current.parentElement as HTMLElement | null;
          if (current && current.tagName.toLowerCase() === 'html') {
            break;
          }
        }
        return path.join(' > ');
      }

      // Helper to detect label for an element
      function findLabel(el: HTMLElement): string {
        let labelText = '';
        
        // 1. By ID matching
        if (el.id) {
          const labelEl = document.querySelector(`label[for="${el.id}"]`);
          if (labelEl) labelText = (labelEl as HTMLElement).innerText || labelEl.textContent || '';
        }
        
        // 2. By parent label
        if (!labelText) {
          const parentLabel = el.closest('label');
          if (parentLabel) labelText = parentLabel.innerText || parentLabel.textContent || '';
        }

        // 3. By shadcn/ui or form container structure (check siblings)
        if (!labelText) {
          // Look up for form-item or vertical groups
          const formItem = el.closest('[data-slot="form-item"]') || el.closest('.space-y-2') || el.parentElement;
          if (formItem) {
            const labelEl = formItem.querySelector('label') || formItem.querySelector('.text-sm');
            if (labelEl && labelEl !== el) {
              labelText = (labelEl as HTMLElement).innerText || labelEl.textContent || '';
            }
          }
        }

        // Clean up the text (remove newlines, extra spaces, asterisk for required fields)
        return labelText.replace(/\s+/g, ' ').replace(/\*$/, '').trim();
      }

      // Helper to check if element is visible and in viewport
      function isVisible(el: HTMLElement): boolean {
        const rect = el.getBoundingClientRect();
        
        // Check size
        if (rect.width === 0 || rect.height === 0) return false;
        
        // Check opacity and visibility styles
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0) {
          return false;
        }

        // Basic check if it is within scroll height/width (not necessarily current viewport, as we can scroll)
        return true;
      }

      // Gather candidate elements
      const elements = Array.from(document.querySelectorAll('input, textarea, select, button, a, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"]'));
      
      // Also add divs/spans that have cursor: pointer and click handlers
      const clickables = Array.from(document.querySelectorAll('div, span, svg, li')).filter(el => {
        const style = window.getComputedStyle(el);
        return style.cursor === 'pointer' && isVisible(el as HTMLElement);
      });

      const allCandidates = [...elements, ...clickables] as HTMLElement[];
      const seen = new Set<HTMLElement>();

      for (const el of allCandidates) {
        if (seen.has(el)) continue;
        
        if (!isVisible(el)) continue;

        // Skip script, style elements
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;

        // Skip certain system overlays
        if (el.id === 'agent-click-marker' || el.closest('#agent-badges-container')) continue;

        const rect = el.getBoundingClientRect();
        
        const tagName = el.tagName.toLowerCase();
        const type = el.getAttribute('type') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const name = el.getAttribute('name') || '';
        const idAttribute = el.id || '';
        
        // Get text content, prioritizing button/anchor text or labels
        let text = (el.innerText || el.textContent || '').trim();
        if (tagName === 'input' && (type === 'button' || type === 'submit')) {
          text = el.getAttribute('value') || '';
        }

        const label = findLabel(el);

        interactives.push({
          id: idCounter++,
          selector: getCSSSelector(el),
          tagName,
          type,
          text: text.substring(0, 100), // Limit text length
          placeholder: placeholder.substring(0, 100),
          name,
          idAttribute,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          centerX: Math.round(rect.left + rect.width / 2),
          centerY: Math.round(rect.top + rect.height / 2),
          label
        });

        seen.add(el);
      }

      return interactives;
    });
  }

  /**
   * Draws badges with numbers over each interactable element on the screen.
   * This allows the visual model (and human verifiers) to map IDs to page locations.
   */
  public static async drawBadges(page: Page, elements: InteractiveElement[]): Promise<void> {
    await page.evaluate((elList) => {
      // Clean up previous badges if they exist
      const existing = document.getElementById('agent-badges-container');
      if (existing) existing.remove();

      const container = document.createElement('div');
      container.id = 'agent-badges-container';
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '999998';
      document.body.appendChild(container);

      // We draw badges matching the coordinates of the elements
      elList.forEach((el) => {
        // Absolute position based on viewport rect + current scroll
        const left = el.x + window.scrollX;
        const top = el.y + window.scrollY;

        const badge = document.createElement('div');
        badge.innerText = el.id.toString();
        badge.style.position = 'absolute';
        badge.style.left = `${left}px`;
        badge.style.top = `${top}px`;
        badge.style.backgroundColor = '#ff3f34'; // High contrast vibrant red-orange
        badge.style.color = 'white';
        badge.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        badge.style.fontSize = '10px';
        badge.style.fontWeight = 'bold';
        badge.style.padding = '1px 5px';
        badge.style.borderRadius = '3px';
        badge.style.border = '1px solid white';
        badge.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
        badge.style.pointerEvents = 'none';
        badge.style.transform = 'translate(-5px, -5px)'; // Shift slightly offset top-left

        container.appendChild(badge);
      });
    }, elements);
  }

  /**
   * Removes visual badges from the page
   */
  public static async removeBadges(page: Page): Promise<void> {
    await page.evaluate(() => {
      const container = document.getElementById('agent-badges-container');
      if (container) container.remove();
    });
  }
}
