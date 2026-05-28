import { describe, expect, it } from 'vitest';
import { normalizeRoute, routeMatches } from '../src/domain/helpers/route-matcher.js';

describe('normalizeRoute', () => {
  it('adds leading slash when missing', () => {
    expect(normalizeRoute('login')).toBe('/login');
  });

  it('removes trailing slash', () => {
    expect(normalizeRoute('/login/')).toBe('/login');
  });

  it('preserves root route', () => {
    expect(normalizeRoute('/')).toBe('/');
  });

  it('removes query string', () => {
    expect(normalizeRoute('/login?redirect=/home')).toBe('/login');
  });

  it('removes hash', () => {
    expect(normalizeRoute('/login#form')).toBe('/login');
  });

  it('removes both query and hash', () => {
    expect(normalizeRoute('/login?foo=bar#form')).toBe('/login');
  });

  it('normalizes backslashes', () => {
    expect(normalizeRoute('\\login\\profile')).toBe('/login/profile');
  });

  it('returns empty string for non-string input', () => {
    expect(normalizeRoute('')).toBe('/');
    expect(normalizeRoute('   ')).toBe('/');
  });
});

describe('routeMatches', () => {
  it('returns true for exact match', () => {
    expect(routeMatches('/login', '/login')).toBe(true);
  });

  it('returns true when scenario route is a child of affected route', () => {
    expect(routeMatches('/login', '/login/profile')).toBe(true);
    expect(routeMatches('/login', '/login/reset')).toBe(true);
    expect(routeMatches('/login', '/login/profile/edit')).toBe(true);
  });

  it('returns false for parent route when only child is affected', () => {
    expect(routeMatches('/login/profile', '/login')).toBe(false);
  });

  it('returns false for substring that is not a prefix', () => {
    expect(routeMatches('/login', '/admin/login')).toBe(false);
    expect(routeMatches('/login', '/admin/login-history')).toBe(false);
  });

  it('returns false for unrelated routes', () => {
    expect(routeMatches('/login', '/logout')).toBe(false);
    expect(routeMatches('/login', '/register')).toBe(false);
  });

  it('returns false when routes share a common prefix but diverge', () => {
    expect(routeMatches('/login', '/login2')).toBe(false);
    expect(routeMatches('/login', '/login-old')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(routeMatches('/Login', '/login')).toBe(false);
    expect(routeMatches('/login', '/Login')).toBe(false);
  });

  it('handles normalized inputs with trailing slashes', () => {
    expect(routeMatches('/login/', '/login/profile/')).toBe(true);
  });

  it('handles normalized inputs with query strings', () => {
    expect(routeMatches('/login?foo=bar', '/login/profile')).toBe(true);
  });

  it('returns false for empty or invalid routes', () => {
    expect(routeMatches('', '/login')).toBe(false);
    expect(routeMatches('/login', '')).toBe(false);
  });
});
