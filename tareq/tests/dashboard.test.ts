import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The dashboard is a static shell. These tests assert the properties that make
 * it trustworthy: it ships no embedded data, it talks only to the API, and it
 * offers both Arabic and English. They do not assert styling.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, '..', 'src', 'app', 'dashboard.html'), 'utf8');
const storefront = readFileSync(join(HERE, '..', 'src', 'app', 'storefront.ts'), 'utf8');
const server = readFileSync(join(HERE, '..', 'src', 'app', 'server.ts'), 'utf8');

test('dashboard supports Arabic and English', () => {
  assert.match(html, /T\.en\s*=/, 'English strings table present');
  assert.match(html, /T\.ar\s*=/, 'Arabic strings table present');
  assert.match(html, /dir\s*=\s*lang === 'ar'/, 'direction flips to RTL for Arabic');
});

test('dashboard fetches data from the authenticated API, not hardcoded values', () => {
  assert.match(html, /function api\(/, 'has an API helper');
  assert.match(html, /authorization:\s*'Bearer '\s*\+\s*token/, 'sends the bearer token');
  assert.match(html, /\/capabilities/, 'reads capabilities endpoint');
  assert.match(html, /\/finance/, 'reads finance endpoint');
  assert.match(html, /\/audit/, 'reads audit endpoint');
});

test('dashboard covers the full operational surface', () => {
  for (const ep of ['/tasks', '/approvals', '/mode', '/leads', '/usage', '/errors', '/config', '/research', '/health', '/supervisor', '/controls', '/optimization', '/readiness', '/content', '/inquiries']) {
    assert.ok(html.includes(ep), `dashboard references ${ep}`);
  }
});

test('dashboard exposes owner-only inquiry review and accurately labels conditional email delivery', () => {
  assert.match(html, /api\('\/inquiries'\)/, 'loads the owner inquiry endpoint');
  assert.match(html, /data-answer-inquiry=/, 'offers processing only for new inquiries');
  assert.match(html, /api\('\/inquiries\/answer'/, 'uses the protected answer endpoint');
  assert.match(html, /esc\(inquiry\.message\)/, 'escapes customer-submitted text');
  assert.match(html, /esc\(inquiry\.answer\)/, 'escapes generated answers');
  assert.match(html, /confirm\(t\('confirmAnswerInquiry'\)\)/, 'explains a permitted response may send email and asks before processing');
  assert.match(html, /when owner permission and a configured provider both allow it/i);
});

test('contact page discloses stored inquiry fields and truthful conditional reply behavior', () => {
  assert.match(storefront, /retain your IP address for abuse prevention/i);
  assert.match(storefront, /You can ask us to delete this inquiry/i);
  assert.match(server, /email answer is sent only when owner permission and a working email provider are enabled/i);
});

test('dashboard exposes owner-gated organic content draft and publish actions', () => {
  assert.match(html, /id="contentTopic"/, 'owner can provide a specific draft topic');
  assert.match(html, /api\('\/content\/draft'/, 'draft action calls the protected draft API');
  assert.match(html, /data-publish-article=/, 'draft rows expose an explicit publish action');
  assert.match(html, /api\('\/content\/publish'/, 'publish action calls the server-gated publish API');
  assert.match(html, /confirm\(t\('confirmArticlePublish'\)\)/, 'public publishing requires an explicit confirmation click');
  assert.match(html, /Review content and sources/, 'the owner can expand a draft preview and its source URLs before publishing');
  assert.match(html, /esc\(bodyText\)/, 'article body is escaped before it is rendered in the dashboard');
  assert.match(html, /publishing is always checked by the server against the content permission, source QA and emergency stop/i);
});

test('dashboard uses the real ledger field names, not invented ones', () => {
  assert.match(html, /cashCollectedUsd/, 'reads collected revenue from the ledger summary');
  assert.match(html, /operatingCostsUsd/, 'reads expenses from the ledger summary');
  assert.match(html, /netProfitUsd/, 'reads net profit from the ledger summary');
});

test('dashboard never hardcodes a revenue or profit figure', () => {
  // A literal "$" followed by digits would mean an invented metric on screen.
  assert.doesNotMatch(html, /\$\s?\d/, 'no hardcoded currency literal');
});

test('dashboard exposes owner controls including the emergency stop', () => {
  assert.match(html, /\/emergency-stop/, 'emergency stop wired');
  assert.match(html, /\/approvals\/decide/, 'approval decisions wired');
  assert.match(html, /\/mode/, 'mode control wired');
});

test('dashboard escapes untrusted values before inserting into the DOM', () => {
  assert.match(html, /const esc = /, 'has an escaper');
  assert.match(html, /replace\(\/\[&<>"\]/, 'escapes the dangerous characters');
});
