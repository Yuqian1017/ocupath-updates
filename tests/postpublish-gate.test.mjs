import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePostpublishGate } from '../scripts/postpublish-gate.mjs';

function greenState(overrides = {}) {
  return {
    liveVersion: '0.991.1',
    expectedVersion: '0.991.1',
    releaseDraft: false,
    releaseTagName: 'v0.991.1',
    expectedTagName: 'v0.991.1',
    productionOldVersion: '0.99.1',
    expectedOldVersion: '0.99.1',
    productionUpdaterTransaction: 'PASS',
    automaticRelaunch: true,
    unchangedSentinels: 7,
    expectedSentinels: 7,
    rangeRequestCount: 1,
    fullZipHttp200Count: 0,
    macManualDownload: 'PASS',
    windowsManualDownload: 'PASS',
    chinaMacTransaction: 'PASS',
    chinaWindowsTransaction: 'PASS',
    ...overrides,
  };
}

test('blocks completion while the real old production app transaction is not run', () => {
  const result = evaluatePostpublishGate(greenState({
    productionUpdaterTransaction: 'not-run',
    automaticRelaunch: false,
    unchangedSentinels: 0,
    rangeRequestCount: 0,
  }));

  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, [
    'production 0.99.1 to 0.991.1 updater transaction: not-run',
    'automatic relaunch was not observed',
    'unchanged sentinels: 0/7',
    'no differential Range request was observed',
  ]);
});

test('rejects a published manifest that is not the exact target version', () => {
  const result = evaluatePostpublishGate(greenState({ liveVersion: '0.99.1' }));
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, ['live version mismatch: 0.99.1']);
});

test('rejects a transaction that silently falls back to the complete ZIP', () => {
  const result = evaluatePostpublishGate(greenState({ fullZipHttp200Count: 1 }));
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, ['full updater ZIP was transferred instead of the differential path']);
});

test('keeps the release open until both public manual downloads and China transactions pass', () => {
  const result = evaluatePostpublishGate(greenState({
    macManualDownload: 'not-run',
    windowsManualDownload: 'evidence-blocked',
    chinaMacTransaction: 'not-run',
    chinaWindowsTransaction: 'not-run',
  }));
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, [
    'Mac production Manual Download transaction: not-run',
    'Windows production Manual Download transaction: evidence-blocked',
    'China Mac complete download/install/relaunch transaction: not-run',
    'China Windows complete download/install/relaunch transaction: not-run',
  ]);
});

test('passes only after the exact public 0.99.1 app updates through production to 0.991.1', () => {
  const result = evaluatePostpublishGate(greenState());
  assert.deepEqual(result, { status: 'GREEN', failures: [] });
});
