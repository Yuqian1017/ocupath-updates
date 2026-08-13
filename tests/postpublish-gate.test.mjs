import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePostpublishGate,
  parseUpdaterMetadata,
} from '../scripts/postpublish-gate.mjs';

function greenState(overrides = {}) {
  return {
    liveVersion: '0.991.1',
    expectedVersion: '0.991.1',
    releaseDraft: false,
    releaseTagName: 'v0.991.1-c801',
    expectedTagName: 'v0.991.1-c801',
    productionRuntimeFeed: {
      url: 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com/darwin-arm64/latest-mac.yml',
      expectedUrl: 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com/darwin-arm64/latest-mac.yml',
      httpStatus: 200,
      sha256: 'c45f1d96f9a7e031135afaa15ce37e8908d089f6abfa9d70a5e4a3d9ac58ce3b',
      expectedSha256: 'c45f1d96f9a7e031135afaa15ce37e8908d089f6abfa9d70a5e4a3d9ac58ce3b',
      version: '0.991.1',
      path: 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com/OcupathIF-0.991.1-arm64-mac.zip',
      expectedPath: 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com/OcupathIF-0.991.1-arm64-mac.zip',
      sha512: '5U67IW0fWPXo81VnYftMNQ9ogWbTAqXhFzOMc5gydL7Shppb8iQ5Yf/kbKOuRmc6/K5IaenqYpKk79Nb5y2ekw==',
      expectedSha512: '5U67IW0fWPXo81VnYftMNQ9ogWbTAqXhFzOMc5gydL7Shppb8iQ5Yf/kbKOuRmc6/K5IaenqYpKk79Nb5y2ekw==',
      size: 1313793497,
      expectedSize: 1313793497,
    },
    productionOldVersion: '0.99.1',
    expectedOldVersion: '0.99.1',
    productionTargetVersion: '0.991.1',
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

test('parses the updater size from the indented files entry', () => {
  const metadata = parseUpdaterMetadata(`version: 0.991.1
files:
  - url: https://downloads.example/OcupathIF.zip
    sha512: exact-sha512
    size: 1313793497
path: https://downloads.example/OcupathIF.zip
sha512: exact-sha512
`);

  assert.equal(metadata.size, 1313793497);
});

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

test('rejects a root-only metadata publication that leaves the packaged runtime route unavailable', () => {
  const result = evaluatePostpublishGate(greenState({
    productionRuntimeFeed: {
      ...greenState().productionRuntimeFeed,
      httpStatus: 404,
      sha256: undefined,
      version: undefined,
    },
  }));
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, [
    'production runtime feed is not the exact packaged-app route',
  ]);
});

test('rejects a transaction that silently falls back to the complete ZIP', () => {
  const result = evaluatePostpublishGate(greenState({ fullZipHttp200Count: 1 }));
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, ['full updater ZIP was transferred instead of the differential path']);
});

test('rejects a transaction that did not land on the released version', () => {
  const result = evaluatePostpublishGate(greenState({ productionTargetVersion: '0.991.0' }));
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, ['production updater target mismatch: 0.991.0']);
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
