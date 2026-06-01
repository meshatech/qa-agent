import { Injectable } from '@nestjs/common';
import type { Page, Locator } from 'playwright';
import type { LocatorDescriptor } from '../../domain/schemas/action.schema.js';
import type { ObservableElement } from '../../domain/schemas/observation.schema.js';

const REMOVE_TAGS = ['script', 'style', 'noscript', 'meta', 'link', 'svg', 'canvas', 'template', 'iframe'];
const REMOVE_ATTRS = /^on[a-z]+$/i;
const KEEP_DATA_ATTR = /^data-(testid|test-id|qa|cy)$/i;

export interface PurifyOptions {
  maxClassChars?: number;
  hideHidden?: boolean;
}

@Injectable()
export class DomPurifier {
  async purifyHtml(page: Page, opts: PurifyOptions = {}): Promise<string> {
    const html = await page.evaluate(
      ({ removeTags, removeAttrsSrc, keepDataAttrSrc, maxClassChars, hideHidden }) => {
        const removeAttrsRe = new RegExp(removeAttrsSrc);
        const keepDataRe = new RegExp(keepDataAttrSrc);
        const clone = document.documentElement.cloneNode(true) as HTMLElement;

        for (const tag of removeTags) clone.querySelectorAll(tag).forEach((n) => n.remove());

        const walk = (node: Element) => {
          if (hideHidden) {
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || node.getAttribute('aria-hidden') === 'true') {
              node.remove();
              return;
            }
          }
          for (const attr of Array.from(node.attributes)) {
            const name = attr.name.toLowerCase();
            if (removeAttrsRe.test(name)) node.removeAttribute(attr.name);
            else if (name.startsWith('data-') && !keepDataRe.test(name)) node.removeAttribute(attr.name);
            else if (name === 'class' && attr.value.length > maxClassChars) node.setAttribute('class', attr.value.slice(0, maxClassChars) + '…');
          }
          for (const child of Array.from(node.children)) walk(child);
        };

        walk(clone);
        return '<!doctype html>' + clone.outerHTML;
      },
      {
        removeTags: REMOVE_TAGS,
        removeAttrsSrc: REMOVE_ATTRS.source,
        keepDataAttrSrc: KEEP_DATA_ATTR.source,
        maxClassChars: opts.maxClassChars ?? 200,
        hideHidden: opts.hideHidden ?? true,
      },
    );
    return html;
  }

  purifyForEvidence(html: string): string {
    return html
      .replace(/<input([^>]*type=["']password["'][^>]*)value=["'][^"']*["']/gi, '<input$1value="***"')
      .replace(/<meta([^>]*name=["']csrf-token["'][^>]*)content=["'][^"']*["']/gi, '<meta$1content="***"');
  }

  async fallbackElements(page: Page): Promise<ObservableElement[]> {
    type RawElement = {
      tag: string;
      role: string;
      name: string;
      text?: string;
      placeholder?: string;
      value?: string;
      disabled?: boolean;
      required?: boolean;
      checked?: boolean;
      selected?: boolean;
      testid?: string;
      label?: string;
      bounds?: { x: number; y: number; width: number; height: number };
      inViewport: boolean;
      type?: string;
      options?: string[];
      editable?: boolean;
      ariaLabel?: string;
    };

    const raws = await page
      .locator('input,textarea,select,button,a,[role],[data-testid],[contenteditable="true"]')
      .evaluateAll((nodes) => {
        return nodes
          .filter((n) => {
            const el = n as HTMLElement;
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.getAttribute('aria-hidden') !== 'true';
          })
          .slice(0, 120)
          .map((n) => {
            const el = n as HTMLElement;
            const input = el as HTMLInputElement;
            const select = el as HTMLSelectElement;
            const textarea = el as HTMLTextAreaElement;
            const rect = el.getBoundingClientRect();
            const inputType = el.tagName === 'INPUT' ? (input.type ?? 'text') : '';
            const editable = el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true';
            const role =
              el.getAttribute('role') ||
              (el.tagName === 'INPUT'
                ? inputType === 'checkbox'
                  ? 'checkbox'
                  : inputType === 'radio'
                    ? 'radio'
                    : 'textbox'
                : el.tagName === 'TEXTAREA'
                  ? 'textbox'
                  : editable
                    ? 'textbox'
                  : el.tagName === 'BUTTON'
                    ? 'button'
                    : el.tagName === 'SELECT'
                      ? 'combobox'
                      : el.tagName === 'A'
                        ? 'link'
                        : 'generic');
            const labels = (input.labels ?? textarea.labels ?? select.labels) as NodeListOf<HTMLLabelElement> | null;
            const label = labels?.[0]?.textContent?.trim() ?? undefined;
            const ariaLabel = el.getAttribute('aria-label');
            const placeholder = input.placeholder ?? textarea.placeholder ?? undefined;
            const name = ariaLabel || label || placeholder || el.textContent?.trim() || (el as HTMLInputElement).name || (editable ? 'Editable text area' : '');
            const opts: string[] | undefined = el.tagName === 'SELECT' ? Array.from(select.options).map((o) => o.label || o.value) : undefined;
            const isInputElement = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
            const value = isInputElement && inputType !== 'password' ? (input.value ?? select.value ?? textarea.value ?? '') : '';
            const checked = el.tagName === 'INPUT' && (inputType === 'checkbox' || inputType === 'radio') ? input.checked : undefined;
            return {
              tag: el.tagName.toLowerCase(),
              role,
              name,
              text: el.textContent?.trim() || undefined,
              placeholder,
              value: value || undefined,
              disabled: (input.disabled ?? select.disabled ?? textarea.disabled) || undefined,
              required: (input.required ?? select.required ?? textarea.required) || undefined,
              checked,
              selected: el.tagName === 'OPTION' ? (el as HTMLOptionElement).selected : undefined,
              testid: el.getAttribute('data-testid') || undefined,
              label,
              bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              inViewport: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth,
              type: inputType || undefined,
              ariaLabel: el.getAttribute('aria-label') || undefined,
              title: el.getAttribute('title') || undefined,
              alt: (el as HTMLImageElement).alt || undefined,
              className: el.className || undefined,
              options: opts,
              editable,
            } as RawElement;
          });
      });

    return raws
      .filter((r) => r.name.length > 0)
      .map((r, i) => {
        const id = `el_${String(i + 1).padStart(3, '0')}`;
        const locator: LocatorDescriptor = r.testid
          ? { strategy: 'testid', value: r.testid }
          : r.label || (r.tag === 'input' && r.ariaLabel)
            ? { strategy: 'label', text: r.label ?? r.ariaLabel! }
            : r.placeholder
              ? { strategy: 'placeholder', text: r.placeholder }
              : r.editable
                ? { strategy: 'role', role: r.role }
                : { strategy: 'role', role: r.role, name: r.name };
        return {
          id,
          role: r.role,
          name: r.name.slice(0, 120),
          text: r.text?.slice(0, 120),
          placeholder: r.placeholder,
          value: r.value?.slice(0, 120),
          disabled: r.disabled,
          required: r.required,
          checked: r.checked,
          selected: r.selected,
          options: r.options,
          inViewport: r.inViewport,
          bounds: r.bounds,
          source: 'dom' as const,
          locator,
        };
      });
  }

  async resolveBounds(page: Page, locator: Locator): Promise<{ x: number; y: number; width: number; height: number } | undefined> {
    void page;
    const box = await locator.boundingBox().catch(() => null);
    return box ?? undefined;
  }
}
