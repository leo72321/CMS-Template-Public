import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gtmInlineCode } from '../src/lib/gtm';
import { isValidDomain } from '../src/lib/storage-providers';

test('domain validation has one strict shared policy', () => {
  for (const valid of ['example.com', 'sub.example.com', 'example.co.uk']) assert.equal(isValidDomain(valid), true);
  for (const bad of ['-bad.com', 'bad-.com', 'bad..com', 'EXAMPLE.COM', 'http://example.com', 'x.local', 'example.com.', 'localhost', '127.0.0.1']) assert.equal(isValidDomain(bad), false);
});
test('GTM and language script audit compares exact output, not markers', () => {
  const audit = readFileSync('scripts/audit.ts', 'utf8');
  const languageSource = readFileSync('src/components/LanguageSwitcher.astro', 'utf8');
  const extracted = languageSource.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1]?.trim();
  assert.ok(extracted?.includes('cms:locale-preference:v1'));
  assert.match(audit, /source === approvedLocaleScript/);
  assert.match(audit, /source === gtmInlineCode/);
  assert.match(audit, /script\.attr\('src'\)/);
  assert.ok(gtmInlineCode('GTM-TEST1').includes('GTM-TEST1'));
  assert.notEqual(gtmInlineCode('GTM-TEST1'), gtmInlineCode('GTM-TEST2'));
});
