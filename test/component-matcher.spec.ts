import { describe, expect, it } from 'vitest';
import { normalizeComponentName, componentMatches } from '../src/domain/helpers/component-matcher.js';

describe('normalizeComponentName', () => {
  it('lowercases the name', () => {
    expect(normalizeComponentName('LoginForm')).toBe('loginform');
  });

  it('removes hyphens', () => {
    expect(normalizeComponentName('login-form')).toBe('loginform');
  });

  it('removes underscores', () => {
    expect(normalizeComponentName('login_form')).toBe('loginform');
  });

  it('removes dots', () => {
    expect(normalizeComponentName('login.form')).toBe('loginform');
  });

  it('handles mixed separators', () => {
    expect(normalizeComponentName('Login-Form_v2.test')).toBe('loginformv2test');
  });

  it('trims whitespace', () => {
    expect(normalizeComponentName('  LoginForm  ')).toBe('loginform');
  });

  it('returns empty string for non-string input', () => {
    expect(normalizeComponentName('')).toBe('');
  });
});

describe('componentMatches', () => {
  it('returns true for exact match', () => {
    expect(componentMatches('LoginForm', 'LoginForm')).toBe(true);
  });

  it('returns true for match after normalization', () => {
    expect(componentMatches('LoginForm', 'login-form')).toBe(true);
    expect(componentMatches('login_form', 'LoginForm')).toBe(true);
  });

  it('returns false for substring', () => {
    expect(componentMatches('LoginForm', 'Form')).toBe(false);
    expect(componentMatches('LoginForm', 'Login')).toBe(false);
  });

  it('returns false for different names', () => {
    expect(componentMatches('LoginForm', 'AccountMenu')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(componentMatches('', 'LoginForm')).toBe(false);
    expect(componentMatches('LoginForm', '')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(componentMatches('loginform', 'LoginForm')).toBe(true);
    expect(componentMatches('LOGINFORM', 'loginForm')).toBe(true);
  });
});
