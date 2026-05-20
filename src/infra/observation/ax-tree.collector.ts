import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import type { LocatorDescriptor } from '../../domain/schemas/action.schema.js';
import type { ObservableElement } from '../../domain/schemas/observation.schema.js';

export interface AxNode {
  role: string;
  name?: string;
  text?: string;
  ref?: string;
  backendNodeId?: number;
  bounds?: { x: number; y: number; width: number; height: number };
  attrs: Record<string, string | boolean>;
  depth: number;
  children: AxNode[];
}

const INTERESTING_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'option',
  'tab',
  'spinbutton',
  'slider',
  'heading',
]);

const NON_INTERESTING_AS_TEXT = new Set(['text']);

export interface AxCollected {
  elements: ObservableElement[];
  tree: AxNode | null;
  raw: string;
  source: 'cdp' | 'ariaSnapshot';
}

@Injectable()
export class AxTreeCollector {
  async collect(page: Page): Promise<AxCollected> {
    const native = await this.collectNative(page).catch(() => undefined);
    if (native?.tree) return native;

    const raw = await page.ariaSnapshot({ mode: 'ai', boxes: true }).catch(() => '');
    if (!raw) return { elements: [], tree: null, raw: '', source: 'ariaSnapshot' };
    const tree = this.parseTree(raw);
    if (!tree) return { elements: [], tree: null, raw, source: 'ariaSnapshot' };
    const elements: ObservableElement[] = [];
    const counter = { value: 0 };
    this.collectElements(tree, elements, counter);
    return { elements, tree, raw, source: 'ariaSnapshot' };
  }

  private async collectNative(page: Page): Promise<AxCollected | undefined> {
    if (page.context().browser()?.browserType().name() !== 'chromium') return undefined;
    const session = await page.context().newCDPSession(page);
    const response = await session.send('Accessibility.getFullAXTree');
    const nodes = (response as { nodes?: CdpAxNode[] }).nodes ?? [];
    if (!nodes.length) return undefined;

    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const childIds = new Set(nodes.flatMap((node) => node.childIds ?? []));
    const root = nodes.find((node) => !childIds.has(node.nodeId)) ?? nodes[0];
    if (!root) return undefined;

    const boundsCache = new Map<number, Promise<AxNode['bounds']>>();
    const toTree = async (node: CdpAxNode, depth: number): Promise<AxNode> => {
      const attrs = this.nativeAttrs(node);
      const backendNodeId = node.backendDOMNodeId;
      const children = await Promise.all((node.childIds ?? []).map((id) => byId.get(id)).filter((child): child is CdpAxNode => Boolean(child)).map((child) => toTree(child, depth + 1)));
      const role = String(node.role?.value ?? 'generic');
      const name = this.stringValue(node.name?.value) ?? (backendNodeId && INTERESTING_ROLES.has(this.normalizeRole(role)) ? await this.domName(session, backendNodeId) : undefined);
      return {
        role,
        name,
        text: this.stringValue(node.value?.value),
        ref: backendNodeId ? `backend:${backendNodeId}` : node.nodeId,
        backendNodeId,
        bounds: backendNodeId ? await this.bounds(session, backendNodeId, boundsCache) : undefined,
        attrs,
        depth,
        children,
      };
    };

    const tree = await toTree(root, 0);
    const elements: ObservableElement[] = [];
    const counter = { value: 0 };
    this.collectElements(tree, elements, counter);
    await session.detach().catch(() => undefined);
    return { elements, tree, raw: JSON.stringify(this.compactTree(tree)), source: 'cdp' };
  }

  parseTree(raw: string): AxNode | null {
    const root: AxNode = { role: 'root', attrs: {}, depth: -1, children: [] };
    const stack: AxNode[] = [root];
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+$/g, '');
      if (!line) continue;
      const indent = line.length - line.trimStart().length;
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('- ')) continue;
      const content = trimmed.slice(2).trimEnd();
      const node = this.parseLine(content, indent);
      if (!node) continue;
      while (stack.length > 1 && stack[stack.length - 1]!.depth >= indent) stack.pop();
      stack[stack.length - 1]!.children.push(node);
      stack.push(node);
    }
    if (root.children.length === 1) return root.children[0]!;
    if (root.children.length > 1) return { ...root, children: root.children };
    return null;
  }

  private parseLine(content: string, indent: number): AxNode | null {
    let body = content;
    const trailingColon = body.endsWith(':');
    if (trailingColon) body = body.slice(0, -1).trimEnd();
    const inlineText = body.indexOf(': ');
    const valueAfter = !trailingColon && inlineText > -1 ? body.slice(inlineText + 2).trim() : undefined;
    if (valueAfter) body = body.slice(0, inlineText).trimEnd();

    const attrs: Record<string, string | boolean> = {};
    let ref: string | undefined;
    let bounds: { x: number; y: number; width: number; height: number } | undefined;
    body = body.replace(/\s*\[([^\]]+)\]/g, (_match, attrSrc: string) => {
      const eq = attrSrc.indexOf('=');
      if (eq === -1) {
        attrs[attrSrc.trim()] = true;
        return '';
      }
      const key = attrSrc.slice(0, eq).trim();
      const value = attrSrc.slice(eq + 1).trim();
      if (key === 'ref') ref = value;
      else if (key === 'box') {
        const parts = value.split(',').map((v) => Number(v));
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) bounds = { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
      } else attrs[key] = value;
      return '';
    }).trim();

    const roleMatch = body.match(/^([\w-]+)(\s+"([^"]*)")?$/);
    if (!roleMatch) return null;
    const role = roleMatch[1]!;
    const name = roleMatch[3];

    if (role === 'text' && valueAfter) return { role: 'text', text: this.unquote(valueAfter), attrs, depth: indent, children: [] };
    return { role, name, text: valueAfter ? this.unquote(valueAfter) : undefined, ref, bounds, attrs, depth: indent, children: [] };
  }

  private unquote(value: string): string {
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
    return value;
  }

  private collectElements(node: AxNode, out: ObservableElement[], counter: { value: number }): void {
    if (node.role !== 'root' && !NON_INTERESTING_AS_TEXT.has(node.role)) {
      const interesting = INTERESTING_ROLES.has(node.role) && (node.name?.length ?? 0) > 0;
      if (interesting) {
        const id = `el_${String(++counter.value).padStart(3, '0')}`;
        const role = this.normalizeRole(node.role);
        const name = node.name!.trim();
        const locator: LocatorDescriptor = { strategy: 'role', role, name };
        const disabled = node.attrs.disabled === true || node.attrs.disabled === 'true';
        const checked = node.attrs.checked === true || node.attrs.checked === 'true';
        const required = node.attrs.required === true || node.attrs.required === 'true';
        const expanded = node.attrs.expanded === true || node.attrs.expanded === 'true';
        const focused = node.attrs.focused === true || node.attrs.focused === 'true';
        const selected = node.attrs.selected === true || node.attrs.selected === 'true';
        const value = typeof node.attrs.value === 'string' ? node.attrs.value : node.text;
        out.push({
          id,
          role,
          name: name.slice(0, 120),
          value: value?.slice(0, 120),
          disabled: disabled || undefined,
          checked: checked || undefined,
          selected: selected || undefined,
          required: required || undefined,
          expanded: expanded || undefined,
          focused: focused || undefined,
          inViewport: node.bounds ? node.bounds.width > 0 && node.bounds.height > 0 : true,
          bounds: node.bounds,
          axRef: node.ref,
          source: 'ax',
          locator,
        });
      }
    }
    for (const child of node.children) this.collectElements(child, out, counter);
  }

  private normalizeRole(role: string): string {
    if (role === 'RootWebArea') return 'document';
    if (role === 'searchbox') return 'textbox';
    if (role === 'menuitemcheckbox' || role === 'menuitemradio') return 'menuitem';
    return role;
  }

  private nativeAttrs(node: CdpAxNode): Record<string, string | boolean> {
    const attrs: Record<string, string | boolean> = {};
    for (const prop of node.properties ?? []) {
      const name = prop.name;
      const value = prop.value?.value;
      if (typeof value === 'boolean' || typeof value === 'string') attrs[name] = value;
    }
    return attrs;
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private async bounds(session: CdpSession, backendNodeId: number, cache: Map<number, Promise<AxNode['bounds']>>): Promise<AxNode['bounds']> {
    if (!cache.has(backendNodeId)) {
      cache.set(backendNodeId, this.loadBounds(session, backendNodeId));
    }
    return cache.get(backendNodeId);
  }

  private async loadBounds(session: CdpSession, backendNodeId: number): Promise<AxNode['bounds']> {
    const model = await session.send('DOM.getBoxModel', { backendNodeId }).catch(() => undefined);
    const content = (model as { model?: { content?: number[] } } | undefined)?.model?.content;
    if (!content || content.length < 8) return undefined;
    const xs = [content[0]!, content[2]!, content[4]!, content[6]!];
    const ys = [content[1]!, content[3]!, content[5]!, content[7]!];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    return { x, y, width, height };
  }

  private async domName(session: CdpSession, backendNodeId: number): Promise<string | undefined> {
    const resolved = await session.send('DOM.resolveNode', { backendNodeId }).catch(() => undefined);
    const objectId = (resolved as { object?: { objectId?: string } } | undefined)?.object?.objectId;
    if (!objectId) return undefined;
    const result = await session.send('Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      functionDeclaration: `function() {
        const el = this;
        const labels = el.labels ? Array.from(el.labels).map(l => l.textContent.trim()).filter(Boolean) : [];
        return el.getAttribute('aria-label') || labels[0] || el.getAttribute('placeholder') || el.textContent.trim() || el.getAttribute('name') || '';
      }`,
    }).catch(() => undefined);
    const value = (result as { result?: { value?: unknown } } | undefined)?.result?.value;
    return typeof value === 'string' && value.length ? value : undefined;
  }

  private compactTree(node: AxNode): unknown {
    return {
      role: node.role,
      name: node.name,
      ref: node.ref,
      bounds: node.bounds,
      attrs: node.attrs,
      children: node.children.map((child) => this.compactTree(child)),
    };
  }
}

type CdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach(): Promise<void>;
};

interface CdpAxNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  backendDOMNodeId?: number;
  childIds?: string[];
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
}
