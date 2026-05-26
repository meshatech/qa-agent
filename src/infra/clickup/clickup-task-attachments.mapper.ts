import { Logger } from '@nestjs/common';

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

const logger = new Logger('ClickUpTaskAttachmentsMapper');

export interface ClickUpTaskAttachmentSource {
  title?: string;
  url?: string;
  mimetype?: string;
  extension?: string;
  deleted?: boolean;
  hidden?: boolean;
}

export interface ClickUpTaskAttachmentsMapResult {
  attachments: DemandAttachment[];
  warnings: string[];
}

export function mapClickUpTaskAttachments(
  attachments: ClickUpTaskAttachmentSource[] | undefined,
): ClickUpTaskAttachmentsMapResult {
  if (!attachments?.length) {
    return { attachments: [], warnings: [] };
  }

  const mapped: DemandAttachment[] = [];
  const warnings: string[] = [];

  for (const attachment of attachments) {
    if (attachment.deleted === true) {
      const warning = 'ClickUp attachment skipped: marked as deleted';
      logger.warn(warning);
      warnings.push(warning);
      continue;
    }

    const url = attachment.url?.trim();
    if (!url) {
      const warning = 'ClickUp attachment skipped: missing url';
      logger.warn(warning);
      warnings.push(warning);
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
      continue;
    }

    const warning = 'ClickUp attachment skipped: validation failed';
    logger.warn(warning);
    warnings.push(warning);
  }

  return { attachments: mapped, warnings };
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
