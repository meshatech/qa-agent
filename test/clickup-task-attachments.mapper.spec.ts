import { describe, expect, it } from 'vitest';

import {
  mapClickUpTaskAttachments,
  type ClickUpTaskAttachmentSource,
} from '../src/infra/clickup/clickup-task-attachments.mapper.js';

describe('mapClickUpTaskAttachments', () => {
  it('maps a complete attachment with title, url and mimetype', () => {
    const attachments: ClickUpTaskAttachmentSource[] = [
      {
        title: 'spec.pdf',
        url: 'https://example.com/spec.pdf',
        mimetype: 'application/pdf',
      },
    ];

    expect(mapClickUpTaskAttachments(attachments)).toEqual([
      {
        name: 'spec.pdf',
        url: 'https://example.com/spec.pdf',
        type: 'application/pdf',
      },
    ]);
  });

  it('maps real ClickUp attachment shape with extension and mimetype', () => {
    const attachments: ClickUpTaskAttachmentSource[] = [
      {
        title: 'error-logs.txt',
        url: 'https://t123456.p.clickup-attachments.com/t123456/error-logs.txt',
        extension: 'txt',
        mimetype: 'text/plain',
      },
    ];

    expect(mapClickUpTaskAttachments(attachments)).toEqual([
      {
        name: 'error-logs.txt',
        url: 'https://t123456.p.clickup-attachments.com/t123456/error-logs.txt',
        type: 'text/plain',
      },
    ]);
  });

  it('includes attachment with only url and extension using fallbacks', () => {
    const attachments: ClickUpTaskAttachmentSource[] = [
      {
        url: 'https://example.com/files/report.pdf',
        extension: 'pdf',
      },
    ];

    expect(mapClickUpTaskAttachments(attachments)).toEqual([
      {
        name: 'report.pdf',
        url: 'https://example.com/files/report.pdf',
        type: 'application/pdf',
      },
    ]);
  });

  it('ignores deleted attachments', () => {
    const attachments: ClickUpTaskAttachmentSource[] = [
      {
        title: 'removed.pdf',
        url: 'https://example.com/removed.pdf',
        mimetype: 'application/pdf',
        deleted: true,
      },
      {
        title: 'active.pdf',
        url: 'https://example.com/active.pdf',
        mimetype: 'application/pdf',
      },
    ];

    expect(mapClickUpTaskAttachments(attachments)).toEqual([
      {
        name: 'active.pdf',
        url: 'https://example.com/active.pdf',
        type: 'application/pdf',
      },
    ]);
  });

  it('ignores attachments without url or with invalid url', () => {
    const attachments: ClickUpTaskAttachmentSource[] = [
      { title: 'missing-url.pdf', mimetype: 'application/pdf' },
      { title: 'bad-url.pdf', url: 'not-a-url', mimetype: 'application/pdf' },
      {
        title: 'valid.pdf',
        url: 'https://example.com/valid.pdf',
        mimetype: 'application/pdf',
      },
    ];

    expect(mapClickUpTaskAttachments(attachments)).toEqual([
      {
        name: 'valid.pdf',
        url: 'https://example.com/valid.pdf',
        type: 'application/pdf',
      },
    ]);
  });

  it('returns empty array for empty or undefined input', () => {
    expect(mapClickUpTaskAttachments([])).toEqual([]);
    expect(mapClickUpTaskAttachments(undefined)).toEqual([]);
  });

  it('preserves attachment order', () => {
    const attachments: ClickUpTaskAttachmentSource[] = [
      {
        title: 'first.png',
        url: 'https://example.com/first.png',
        mimetype: 'image/png',
      },
      {
        title: 'second.json',
        url: 'https://example.com/second.json',
        mimetype: 'application/json',
      },
    ];

    expect(mapClickUpTaskAttachments(attachments)).toEqual([
      {
        name: 'first.png',
        url: 'https://example.com/first.png',
        type: 'image/png',
      },
      {
        name: 'second.json',
        url: 'https://example.com/second.json',
        type: 'application/json',
      },
    ]);
  });
});
