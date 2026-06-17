#!/usr/bin/env node
/**
 * Generates a Playwright storageState.json from a preview test-login endpoint.
 * Used by the CI workflow (Model A) to auth the agent without manual SSO.
 *
 * Usage:
 *   node scripts/generate-storage-state.mjs \
 *     --url https://kriya-pr-94.preview.kriya-hml.mesha.com.br/auth/sso/test-login \
 *     --token $PREVIEW_TEST_AUTH_TOKEN \
 *     --output ./storage-state.json
 */

import { writeFile } from 'node:fs/promises';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key && value !== undefined) args[key] = value;
  }
  return args;
}

function parseCookies(setCookieHeader) {
  if (!setCookieHeader) return [];
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const cookies = [];
  for (const header of raw) {
    const [nameValue] = header.split(';');
    const [name, value] = nameValue.trim().split('=');
    if (!name || value === undefined) continue;
    const attrs = Object.fromEntries(
      header.split(';').slice(1).map((p) => {
        const [k, v] = p.trim().split('=');
        return [k?.toLowerCase().trim(), v?.trim()];
      }).filter(([k]) => k),
    );
    cookies.push({
      name: name.trim(),
      value: value.trim(),
      domain: attrs.domain || '',
      path: attrs.path || '/',
      expires: attrs.expires ? Math.floor(new Date(attrs.expires).getTime() / 1000) : -1,
      httpOnly: attrs.httponly !== undefined,
      secure: attrs.secure !== undefined,
      sameSite: attrs.samesite?.toLowerCase() === 'none' ? 'None'
        : attrs.samesite?.toLowerCase() === 'strict' ? 'Strict'
          : 'Lax',
    });
  }
  return cookies;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = args.url;
  const token = args.token;
  const output = args.output || './storage-state.json';

  if (!url) {
    console.error('Missing --url (test-login endpoint)');
    process.exit(1);
  }

  const fetchUrl = token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url;

  const res = await fetch(fetchUrl, { redirect: 'manual' });
  const cookies = parseCookies(res.headers.getSetCookie?.() || res.headers.get('set-cookie'));

  const storageState = { cookies, origins: [] };
  await writeFile(output, JSON.stringify(storageState, null, 2), 'utf8');

  console.log(`Storage state written to ${output} (${cookies.length} cookie(s))`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
