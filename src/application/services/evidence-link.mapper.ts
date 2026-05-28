export interface EvidenceLink {
  type:
    | 'screenshot'
    | 'video'
    | 'trace'
    | 'console'
    | 'network'
    | 'dom'
    | 'bugReport'
    | 'other';
  label: string;
  path: string;
}

const TYPE_PRIORITY: Record<EvidenceLink['type'], number> = {
  bugReport: 0,
  screenshot: 1,
  video: 2,
  trace: 3,
  console: 4,
  network: 5,
  dom: 6,
  other: 7,
};

export function mapFileToEvidenceLink(relativePath: string): EvidenceLink | undefined {
  if (relativePath.includes('..')) return undefined;
  if (relativePath.startsWith('/')) return undefined;

  const lower = relativePath.toLowerCase();
  const filename = lower.split('/').pop() ?? '';
  const ext = filename.split('.').pop() ?? '';

  if (filename === 'bug-report.md') {
    return { type: 'bugReport', label: 'Bug report', path: relativePath };
  }

  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    return { type: 'screenshot', label: 'Screenshot', path: relativePath };
  }

  if (['webm', 'mp4', 'mov'].includes(ext) || filename.includes('video')) {
    return { type: 'video', label: 'Video', path: relativePath };
  }

  if (ext === 'zip' || filename.includes('trace')) {
    return { type: 'trace', label: 'Trace', path: relativePath };
  }

  if (filename.includes('console') && ext === 'log') {
    return { type: 'console', label: 'Console log', path: relativePath };
  }

  if ((filename.includes('network') || filename.includes('har')) && (ext === 'har' || ext === 'json')) {
    return { type: 'network', label: 'Network log', path: relativePath };
  }

  if ((filename.includes('dom') || filename.includes('snapshot')) && ext === 'html') {
    return { type: 'dom', label: 'DOM snapshot', path: relativePath };
  }

  return undefined;
}

export function sortEvidenceLinks(links: EvidenceLink[]): EvidenceLink[] {
  return [...links].sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]);
}
