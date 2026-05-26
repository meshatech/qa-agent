const BLOCK_BREAK_TAGS =
  /<\s*(?:br\s*\/?|\/(?:p|div|li|ul|ol|h[1-6]|tr|table|blockquote|pre|section|article|header|footer|main|aside|nav|figure|figcaption|hr))\s*>/gi;

const HTML_TAG = /<[^>]+>/g;

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
  const withLineBreaks = raw.replace(BLOCK_BREAK_TAGS, '\n');
  const withoutTags = withLineBreaks.replace(HTML_TAG, '');
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
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
