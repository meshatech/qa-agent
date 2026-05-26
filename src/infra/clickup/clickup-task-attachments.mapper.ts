import {
  DemandAttachmentSchema,
  type DemandAttachment,
} from '../../domain/schemas/demand-attachment.schema.js';

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  json: 'application/json',
};

export interface ClickUpTaskAttachmentSource {
  title?: string;
  url?: string;
  mimetype?: string;
  extension?: string;
  deleted?: boolean;
  hidden?: boolean;
}

export function mapClickUpTaskAttachments(
  attachments: ClickUpTaskAttachmentSource[] | undefined,
): DemandAttachment[] {
  if (!attachments?.length) {
    return [];
  }

  const mapped: DemandAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.deleted === true) {
      continue;
    }

    const url = attachment.url?.trim();
    if (!url) {
      continue;
    }

    const candidate = {
      name: resolveAttachmentName(attachment, url),
      url,
      type: resolveAttachmentType(attachment),
    };

    const parsed = DemandAttachmentSchema.safeParse(candidate);
    if (parsed.success) {
      mapped.push(parsed.data);
    }
  }

  return mapped;
}

function resolveAttachmentName(
  attachment: ClickUpTaskAttachmentSource,
  url: string,
): string {
  const title = attachment.title?.trim();
  if (title) {
    return title;
  }

  const basename = extractUrlBasename(url);
  if (basename) {
    return basename;
  }

  const extension = attachment.extension?.trim();
  if (extension) {
    return `attachment.${extension.replace(/^\./, '')}`;
  }

  return 'attachment';
}

function resolveAttachmentType(attachment: ClickUpTaskAttachmentSource): string {
  const mimetype = attachment.mimetype?.trim();
  if (mimetype) {
    return mimetype;
  }

  const extension = attachment.extension?.trim().replace(/^\./, '').toLowerCase();
  if (extension && MIME_BY_EXTENSION[extension]) {
    return MIME_BY_EXTENSION[extension];
  }

  return 'application/octet-stream';
}

function extractUrlBasename(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const basename = segments.at(-1)?.trim();
    return basename || null;
  } catch {
    return null;
  }
}
