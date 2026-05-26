const BLOCK_BREAK_TAGS =
  /<\s*(?:br\s*\/?|\/(?:p|div|li|ul|ol|h[1-6]|tr|table|blockquote|pre|section|article|header|footer|main|aside|nav|figure|figcaption|hr))\s*>/gi;

const HTML_TAG = /<[^>]+>/g;

const ANCHOR_TAG =
  /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

const ELEMENT_WITH_DATA_ATTR =
  /<([a-z][a-z0-9]*)\b([^>]*\bdata-[a-z0-9-]+=["'][^"']+["'][^>]*)>([\s\S]*?)<\/\1>/gi;

const DATA_ATTR = /\bdata-([a-z0-9-]+)=["']([^"']+)["']/gi;

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

export interface ClickUpTaskContentSource {
  description?: string;
  text_content?: string;
}

export function extractClickUpTitle(name: string): string {
  return name.trim();
}

export function extractClickUpDescription(payload: ClickUpTaskContentSource): string {
  const raw = payload.description ?? payload.text_content ?? '';
  return sanitizeClickUpDescription(raw);
}

export function sanitizeClickUpDescription(raw: string): string {
  let withLineBreaks = raw.replace(BLOCK_BREAK_TAGS, '\n');
  withLineBreaks = preserveAnchorLinks(withLineBreaks);
  withLineBreaks = preserveDataAttributes(withLineBreaks);
  const withoutTags = withLineBreaks.replace(HTML_TAG, '');
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

function preserveAnchorLinks(html: string): string {
  return html.replace(ANCHOR_TAG, (_match, href: string, text: string) => {
    const linkText = text.replace(HTML_TAG, '').trim();
    return linkText ? `${linkText} (${href})` : href;
  });
}

function preserveDataAttributes(html: string): string {
  return html.replace(
    ELEMENT_WITH_DATA_ATTR,
    (_match, _tag: string, attrs: string, inner: string) => {
      const dataSuffix = [...attrs.matchAll(DATA_ATTR)]
        .map(([, name, value]) => `[data-${name}=${value}]`)
        .join(' ');
      const text = inner.replace(HTML_TAG, '').trim();
      if (!dataSuffix) return text;
      return text ? `${text} ${dataSuffix}` : dataSuffix;
    },
  );
}

function decodeHtmlEntities(text: string): string {
  let result = text;

  for (const [entity, value] of Object.entries(HTML_ENTITIES)) {
    result = result.replaceAll(entity, value);
  }

  return result.replace(/&#(\d+);/g, (_, code: string) =>
    String.fromCharCode(Number.parseInt(code, 10)),
  );
}
