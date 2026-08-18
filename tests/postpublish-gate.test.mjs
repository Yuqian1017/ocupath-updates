import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePostpublishGate,
  parseUpdaterMetadata,
} from '../scripts/postpublish-gate.mjs';

function exactFeed(platform) {
  const isMac = platform === 'mac';
  const fileName = isMac
    ? 'OcupathIF-0.993.1-arm64-mac.zip'
    : 'OcupathIF-Setup-0.993.1-x64.exe';
  const metadataName = isMac ? 'darwin-arm64/latest-mac.yml' : 'win32-x64/latest.yml';
  const base = 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com';
  return {
    url: `${base}/${metadataName}`,
    expectedUrl: `${base}/${metadataName}`,
    httpStatus: 200,
    sha256: isMac ? 'a'.repeat(64) : 'b'.repeat(64),
    expectedSha256: isMac ? 'a'.repeat(64) : 'b'.repeat(64),
    version: '0.993.1',
    path: `${base}/${fileName}`,
    expectedPath: `${base}/${fileName}`,
    sha512: isMac ? 'mac-exact-sha512' : 'windows-exact-sha512',
    expectedSha512: isMac ? 'mac-exact-sha512' : 'windows-exact-sha512',
    size: isMac ? 101 : 102,
    expectedSize: isMac ? 101 : 102,
  };
}

function greenState(overrides = {}) {
  return {
    liveVersion: '0.993.1',
    expectedVersion: '0.993.1',
    releaseDraft: false,
    releaseTagName: 'v0.993.1',
    expectedTagName: 'v0.993.1',
    liveManualPublication: {
      latestManifestExact: true,
      installPageHttpStatus: 200,
      installPageSha256: 'page-exact',
      expectedInstallPageSha256: 'page-exact',
    },
    productionRuntimeFeeds: {
      darwinArm64: exactFeed('mac'),
      win32X64: exactFeed('windows'),
    },
    productionOldVersion: '0.992.1',
    expectedOldVersion: '0.992.1',
    productionTargetVersion: '0.993.1',
    productionUpdaterTransaction: 'PASS',
    macUpdateDetection: 'PASS',
    macManualFallback: 'PASS',
    automaticRelaunch: true,
    unchangedSentinels: 7,
    expectedSentinels: 7,
    rangeRequestCount: 1,
    fullZipHttp200Count: 0,
    windowsUpdateDetection: 'PASS',
    windowsInstallMode: 'manual',
    windowsManualFallback: 'PASS',
    windowsAutomaticInstallObserved: false,
    macManualDownload: 'PASS',
    windowsManualDownload: 'PASS',
    chinaMacValidation: 'baseline-reused',
    chinaWindowsValidation: 'baseline-reused',
    baiduAtomicPromotion: 'PASS',
    ...overrides,
  };
}

test('parses the updater size from the indented files entry', () => {
  const metadata = parseUpdaterMetadata(`version: 0.993.1
files:
  - url: https://downloads.example/OcupathIF.zip
    sha512: exact-sha512
    size: 1313793497
path: https://downloads.example/OcupathIF.zip
sha512: exact-sha512
`);

  assert.equal(metadata.size, 1313793497);
});

test('accepts Mac detection plus Manual Download when automatic update cannot complete', () => {
  const result = evaluatePostpublishGate(greenState({
    productionUpdaterTransaction: 'not-run',
    automaticRelaunch: false,
    unchangedSentinels: 0,
    rangeRequestCount: 0,
  }));
  assert.deepEqual(result, { status: 'GREEN', failures: [] });
});

test('blocks when neither Mac automatic update nor detection plus fallback passed', () => {
  const result = evaluatePostpublishGate(greenState({
    productionUpdaterTransaction: 'not-run',
    macUpdateDetection: 'not-run',
    macManualFallback: 'not-run',
    automaticRelaunch: false,
    unchangedSentinels: 0,
    rangeRequestCount: 0,
  }));
  assert.deepEqual(result.failures, [
    'Mac update reachability: transaction=not-run, detection=not-run, manualFallback=not-run',
  ]);
});

test('rejects a published manifest that is not the exact target version', () => {
  const result = evaluatePostpublishGate(greenState({ liveVersion: '0.992.1' }));
  assert.deepEqual(result.failures, ['live version mismatch: 0.992.1']);
});

test('rejects stale live manual metadata or page bytes', () => {
  const latestWrong = greenState();
  latestWrong.liveManualPublication = {
    ...latestWrong.liveManualPublication,
    latestManifestExact: false,
  };
  assert.deepEqual(evaluatePostpublishGate(latestWrong).failures, [
    'live latest.json does not match the frozen staging manifest',
  ]);

  const pageWrong = greenState();
  pageWrong.liveManualPublication = {
    ...pageWrong.liveManualPublication,
    installPageSha256: 'stale-page',
  };
  assert.deepEqual(evaluatePostpublishGate(pageWrong).failures, [
    'live install.html does not match the rendered publication page',
  ]);
});

test('rejects a missing packaged-app Mac or Windows route', () => {
  const macMissing = greenState();
  macMissing.productionRuntimeFeeds.darwinArm64 = {
    ...macMissing.productionRuntimeFeeds.darwinArm64,
    httpStatus: 404,
  };
  assert.deepEqual(evaluatePostpublishGate(macMissing).failures, [
    'production Mac runtime feed is not the exact packaged-app route',
  ]);

  const windowsMissing = greenState();
  windowsMissing.productionRuntimeFeeds.win32X64 = {
    ...windowsMissing.productionRuntimeFeeds.win32X64,
    httpStatus: 404,
  };
  assert.deepEqual(evaluatePostpublishGate(windowsMissing).failures, [
    'production Windows detection feed is not the exact packaged-app route',
  ]);
});

test('rejects Windows auto-install semantics even when detection succeeds', () => {
  const result = evaluatePostpublishGate(greenState({
    windowsInstallMode: 'in_app',
    windowsAutomaticInstallObserved: true,
  }));
  assert.deepEqual(result.failures, [
    'Windows install mode: in_app',
    'Windows attempted automatic installation instead of Manual Download',
  ]);
});

test('rejects a successful automatic Mac transaction that used the full ZIP', () => {
  const result = evaluatePostpublishGate(greenState({ fullZipHttp200Count: 1 }));
  assert.deepEqual(result.failures, ['full updater ZIP was transferred instead of the differential path']);
});

test('rejects a transaction that did not land on the released version', () => {
  const result = evaluatePostpublishGate(greenState({ productionTargetVersion: '0.992.1' }));
  assert.deepEqual(result.failures, ['production updater target mismatch: 0.992.1']);
});

test('keeps customer-clean open until downloads, regional decision and Baidu pass', () => {
  const result = evaluatePostpublishGate(greenState({
    macManualDownload: 'not-run',
    windowsManualDownload: 'evidence-blocked',
    chinaMacValidation: 'not-run',
    chinaWindowsValidation: 'not-run',
    baiduAtomicPromotion: 'in-progress',
  }));
  assert.deepEqual(result.failures, [
    'Mac production Manual Download transaction: not-run',
    'Windows production Manual Download transaction: evidence-blocked',
    'China Mac regional validation: not-run',
    'China Windows regional validation: not-run',
    'Baidu atomic promotion: in-progress',
  ]);
});

test('passes only after both feeds and every final delivery lane are exact', () => {
  assert.deepEqual(evaluatePostpublishGate(greenState()), { status: 'GREEN', failures: [] });
});
