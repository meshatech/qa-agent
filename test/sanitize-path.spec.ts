import { describe, expect, it } from 'vitest';
import { sanitizePath } from '../src/domain/helpers/sanitize-path.js';

describe('sanitizePath', () => {
  it('returns empty string unchanged', () => {
    expect(sanitizePath('')).toBe('');
    expect(sanitizePath('   ')).toBe('');
  });

  it('keeps short relative paths readable', () => {
    expect(sanitizePath('login.ts')).toBe('login.ts');
    expect(sanitizePath('routes/login.ts')).toBe('routes/login.ts');
  });

  it('obfuscates long relative paths to the last two segments', () => {
    expect(sanitizePath('src/routes/login.ts')).toBe('.../routes/login.ts');
  });

  it('redacts home directory prefixes from absolute paths', () => {
    expect(sanitizePath('/home/user/proj/src/api.ts')).toBe('<redacted>/.../src/api.ts');
    expect(sanitizePath('/Users/dev/app/src/api.ts')).toBe('<redacted>/.../src/api.ts');
  });

  it('keeps short routes readable', () => {
    expect(sanitizePath('/login')).toBe('/login');
    expect(sanitizePath('/billing')).toBe('/billing');
  });

  it('obfuscates long routes to the last two segments', () => {
    expect(sanitizePath('/billing/dashboard/page')).toBe('/.../dashboard/page');
  });

  it('normalizes Windows-style separators', () => {
    expect(sanitizePath('src\\routes\\login.ts')).toBe('.../routes/login.ts');
  });

  it('redacts Windows user profile prefixes from absolute paths', () => {
    expect(sanitizePath('C:/Users/dev/proj/src/api.ts')).toBe('<redacted>/.../src/api.ts');
    expect(sanitizePath('C:\\Users\\dev\\proj\\src\\api.ts')).toBe('<redacted>/.../src/api.ts');
  });

  it('redacts paths under the process home directory', () => {
    expect(sanitizePath('/custom/root/project/src/api.ts', '/custom/root')).toBe('<redacted>/.../src/api.ts');
  });
});
