import { describe, expect, it } from 'vitest';
import { mapFileToEvidenceLink, sortEvidenceLinks } from '../src/application/services/evidence-link.mapper.js';

describe('mapFileToEvidenceLink', () => {
  it('maps screenshot.png to screenshot', () => {
    const link = mapFileToEvidenceLink('bugs/B001/screenshot.png');
    expect(link).toBeDefined();
    expect(link!.type).toBe('screenshot');
    expect(link!.label).toBe('Screenshot');
  });

  it('maps video.webm to video', () => {
    const link = mapFileToEvidenceLink('bugs/B001/video.webm');
    expect(link).toBeDefined();
    expect(link!.type).toBe('video');
  });

  it('maps trace.zip to trace', () => {
    const link = mapFileToEvidenceLink('bugs/B001/trace.zip');
    expect(link).toBeDefined();
    expect(link!.type).toBe('trace');
  });

  it('maps console.log to console', () => {
    const link = mapFileToEvidenceLink('bugs/B001/console.log');
    expect(link).toBeDefined();
    expect(link!.type).toBe('console');
  });

  it('maps network.json to network', () => {
    const link = mapFileToEvidenceLink('bugs/B001/network.json');
    expect(link).toBeDefined();
    expect(link!.type).toBe('network');
  });

  it('maps dom-snapshot.html to dom', () => {
    const link = mapFileToEvidenceLink('bugs/B001/dom-snapshot.html');
    expect(link).toBeDefined();
    expect(link!.type).toBe('dom');
  });

  it('maps bug-report.md to bugReport', () => {
    const link = mapFileToEvidenceLink('bugs/B001/bug-report.md');
    expect(link).toBeDefined();
    expect(link!.type).toBe('bugReport');
  });

  it('returns undefined for unknown file', () => {
    const link = mapFileToEvidenceLink('bugs/B001/unknown.txt');
    expect(link).toBeUndefined();
  });

  it('does not classify non-image files named screenshot as screenshot', () => {
    expect(mapFileToEvidenceLink('bugs/B001/screenshot.txt')).toBeUndefined();
    expect(mapFileToEvidenceLink('bugs/B001/myscreenshot.log')).toBeUndefined();
  });

  it('returns undefined for absolute path', () => {
    const link = mapFileToEvidenceLink('/etc/passwd');
    expect(link).toBeUndefined();
  });

  it('returns undefined for path with ..', () => {
    const link = mapFileToEvidenceLink('bugs/B001/../secret.png');
    expect(link).toBeUndefined();
  });
});

describe('sortEvidenceLinks', () => {
  it('orders by type priority', () => {
    const links = [
      { type: 'other' as const, label: 'Other', path: 'x' },
      { type: 'screenshot' as const, label: 'Screenshot', path: 'y' },
      { type: 'bugReport' as const, label: 'Bug report', path: 'z' },
    ];
    const sorted = sortEvidenceLinks(links);
    expect(sorted[0].type).toBe('bugReport');
    expect(sorted[1].type).toBe('screenshot');
    expect(sorted[2].type).toBe('other');
  });
});
