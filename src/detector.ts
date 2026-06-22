/**
 * PERCEIVE layer.
 *
 * Runs inside the browser context to convert the live DOM into a structured,
 * form-scoped `PageSnapshot`. Each interactive element is:
 *   - tagged with a stable `data-agent-idx` attribute (reused as its selector),
 *   - associated with its owning <form> via `formIndex`,
 *   - labelled (for / wrapping / aria-labelledby / aria-label / container),
 *   - measured (viewport-relative bounding box).
 *
 * Tagging the DOM with the index is what makes just-in-time coordinate
 * resolution reliable: the agent can re-find any element later by selector,
 * scroll it into view, and read a *fresh* box even after the layout shifts.
 */
import { Page } from 'playwright';
import { PageSnapshot, ElementInfo } from './types';
import * as logger from './logger';

export function perceive(page: Page): Promise<PageSnapshot> {
  return logger.step('perceive(snapshot)', async () => {
    const snapshot = await page.evaluate((): PageSnapshot => {
      const forms = Array.from(document.querySelectorAll('form'));

      const clean = (s: string | null | undefined): string =>
        (s || '').replace(/\s+/g, ' ').replace(/\*$/, '').trim();

      const textOf = (n: Element | null): string =>
        n ? clean((n as HTMLElement).innerText || n.textContent || '') : '';

      // Resolve the best human-readable label for a control.
      const labelFor = (el: HTMLElement): string => {
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const t = labelledBy
            .split(/\s+/)
            .map((id) => textOf(document.getElementById(id)))
            .filter(Boolean)
            .join(' ');
          if (t) return t;
        }
        const aria = el.getAttribute('aria-label');
        if (aria) return clean(aria);
        if (el.id) {
          const forEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (forEl) return textOf(forEl);
        }
        const wrap = el.closest('label');
        if (wrap) return textOf(wrap);
        // shadcn/ui structure: label is a sibling within the form-item container.
        const container =
          el.closest('[data-slot="form-item"]') || el.closest('.grid') || el.parentElement;
        if (container) {
          const lbl = container.querySelector('label, [data-slot="form-label"]');
          if (lbl && lbl !== el) return textOf(lbl);
        }
        return '';
      };

      const isVisible = (el: HTMLElement): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) {
          return false;
        }
        return true;
      };

      const selector =
        'input, textarea, select, button, [role="button"], [role="textbox"],' +
        '[role="checkbox"], [role="radio"], [role="switch"], [contenteditable="true"]';
      const nodes = Array.from(document.querySelectorAll(selector)) as HTMLElement[];

      const elements: ElementInfo[] = [];
      let idx = 0;

      for (const el of nodes) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'input' && type === 'hidden') continue;
        if (!isVisible(el)) continue;

        el.setAttribute('data-agent-idx', String(idx));
        const r = el.getBoundingClientRect();
        const role = el.getAttribute('role') || '';
        const editable = el.getAttribute('contenteditable') === 'true';

        const isTextarea = tag === 'textarea';
        const isTextInput =
          (tag === 'input' &&
            ['text', '', 'search', 'email', 'tel', 'url', 'number', 'password'].includes(type)) ||
          role === 'textbox' ||
          editable;
        const isButton =
          tag === 'button' || role === 'button' || (tag === 'input' && ['submit', 'button', 'reset'].includes(type));

        const owningForm = el.closest('form');
        const value = (el as HTMLInputElement | HTMLTextAreaElement).value;

        elements.push({
          idx,
          selector: `[data-agent-idx="${idx}"]`,
          tagName: tag,
          type,
          role,
          label: labelFor(el),
          placeholder: el.getAttribute('placeholder') || '',
          name: el.getAttribute('name') || '',
          text: clean((el.innerText || value || '')).slice(0, 80),
          formIndex: owningForm ? forms.indexOf(owningForm as HTMLFormElement) : -1,
          isTextInput,
          isTextarea,
          isButton,
          visible: true,
          box: {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
            centerX: Math.round(r.left + r.width / 2),
            centerY: Math.round(r.top + r.height / 2),
          },
        });
        idx++;
      }

      return {
        url: location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        formCount: forms.length,
        elements,
      };
    });

    return snapshot;
  });
}
