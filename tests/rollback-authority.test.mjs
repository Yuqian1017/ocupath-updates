import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DEFAULT_ROLLBACK_AUTHORITY_URL,
  rollbackStepUrl,
  validateLiveRollbackState,
  validateRollbackAuthority,
} from '../scripts/rollback-authority.mjs';

const authority = JSON.parse(readFileSync(DEFAULT_ROLLBACK_AUTHORITY_URL, 'utf8'));

test('frozen 0.992.1 rollback bodies, feed and marker absence, and restore order are exact', () => {
  assert.deepEqual(validateRollbackAuthority(authority), { status: 'GREEN', failures: [] });
  assert.deepEqual(authority.restoreSteps.map(({ surface, action, key }) => ({ surface, action, key })), [
    { surface: 'pages', action: 'ensure_absent', key: 'ocupathif/regional-cos/v0.993.1.json' },
    { surface: 'cos', action: 'restore_body', key: 'latest-mac.yml' },
    { surface: 'cos', action: 'restore_body', key: 'darwin-arm64/latest-mac.yml' },
    { surface: 'pages', action: 'restore_body', key: 'ocupathif/direct/darwin-arm64/latest-mac.yml' },
    { surface: 'pages', action: 'ensure_absent', key: 'ocupathif/direct/win32-x64/latest.yml' },
    { surface: 'pages', action: 'restore_body', key: 'ocupathif/latest.json' },
    { surface: 'pages', action: 'restore_body', key: 'ocupathif/install.html' },
  ]);
});

test('rollback authority rejects order, body hash, feed absence and marker absence drift', () => {
  const order = structuredClone(authority);
  [order.restoreSteps[0], order.restoreSteps[1]] = [order.restoreSteps[1], order.restoreSteps[0]];
  assert.match(validateRollbackAuthority(order).failures.join('\n'), /sequence mismatch/);

  const body = structuredClone(authority);
  body.restoreSteps[1].sha256 = 'f'.repeat(64);
  assert.match(validateRollbackAuthority(body).failures.join('\n'), /body mismatch/);

  const windows = structuredClone(authority);
  windows.restoreSteps[4].expectedHttpStatus = 200;
  assert.match(validateRollbackAuthority(windows).failures.join('\n'), /absence contract mismatch/);

  const marker = structuredClone(authority);
  marker.restoreSteps[0].expectedHttpStatus = 200;
  assert.match(validateRollbackAuthority(marker).failures.join('\n'), /regional-cos/);
});

test('rollback authority rejects noncanonical capture time and live source drift', () => {
  const time = structuredClone(authority);
  time.capturedAt = '2026-08-18T07:17:29Z';
  assert.match(validateRollbackAuthority(time).failures.join('\n'), /canonical UTC ISO/);

  const source = structuredClone(authority);
  source.source = 'operator recollection';
  assert.match(validateRollbackAuthority(source).failures.join('\n'), /source mismatch/);

  const origin = structuredClone(authority);
  origin.origins.cos = 'https://example.invalid';
  assert.match(validateRollbackAuthority(origin).failures.join('\n'), /COS origin mismatch/);
});

test('pre-mutation live rollback recheck detects capture-to-cutover drift and Windows feed appearance', () => {
  const observations = authority.restoreSteps.map((step) => ({
    url: rollbackStepUrl(authority, step),
    httpStatus: step.expectedHttpStatus,
    bytes: step.bytes,
    sha256: step.sha256,
  }));
  assert.deepEqual(validateLiveRollbackState(authority, observations), {
    status: 'GREEN',
    failures: [],
  });

  const drift = structuredClone(observations);
  drift[5].sha256 = 'f'.repeat(64);
  assert.match(validateLiveRollbackState(authority, drift).failures.join('\n'), /latest.json/);

  const windowsAppeared = structuredClone(observations);
  windowsAppeared[4].httpStatus = 200;
  assert.match(validateLiveRollbackState(authority, windowsAppeared).failures.join('\n'), /win32-x64/);

  const markerAppeared = structuredClone(observations);
  markerAppeared[0].httpStatus = 200;
  assert.match(validateLiveRollbackState(authority, markerAppeared).failures.join('\n'), /regional-cos/);
});
