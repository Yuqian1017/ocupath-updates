import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePostpublishGate,
  parseUpdaterMetadata,
} from '../scripts/postpublish-gate.mjs';

const targetSha = '1'.repeat(40);
const promotionSha = '2'.repeat(40);
const regionalMarkerPath = 'ocupathif/regional-cos/v0.995.1.json';
const publicationBranch = 'release/09931-production-publish-20260818';
const exactAssets = {
  'OcupathIF-0.995.1-arm64-mac.dmg': {
    size: 101,
    digest: `sha256:${'a'.repeat(64)}`,
  },
  'OcupathIF-Setup-0.995.1-x64.exe': {
    size: 102,
    digest: `sha256:${'b'.repeat(64)}`,
  },
  'OcuPathIF_v0.995.1_User_Guide_en.pdf': {
    size: 2261610,
    digest: 'sha256:3d94b58cf23d56003379cb46f17311fa44868b8369812e339b69688b299615ec',
  },
  'OcuPathIF_v0.995.1_User_Guide_zh.pdf': {
    size: 2546203,
    digest: 'sha256:473f9f8617dcf699cd8f2c013302efe845b6a5248726f9caa74379ca8b78f880',
  },
};

function exactFeed(platform) {
  const isMac = platform === 'mac';
  const fileName = isMac
    ? 'OcupathIF-0.995.1-arm64-mac.zip'
    : 'OcupathIF-Setup-0.995.1-x64.exe';
  const metadataName = isMac ? 'direct/darwin-arm64/latest-mac.yml' : 'direct/win32-x64/latest.yml';
  const base = 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com';
  const publicBase = 'https://updates.ocupath.ai/ocupathif';
  return {
    url: `${publicBase}/${metadataName}`,
    expectedUrl: `${publicBase}/${metadataName}`,
    httpStatus: 200,
    sha256: isMac ? 'a'.repeat(64) : 'b'.repeat(64),
    expectedSha256: isMac ? 'a'.repeat(64) : 'b'.repeat(64),
    version: '0.995.1',
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
    liveVersion: '0.995.1',
    expectedVersion: '0.995.1',
    release: {
      draft: false,
      tagName: 'v0.995.1',
      targetCommitish: targetSha,
      assets: Object.entries(exactAssets).map(([name, value]) => ({
        name,
        ...value,
        state: 'uploaded',
      })),
    },
    expectedTagName: 'v0.995.1',
    expectedTargetCommitSha: targetSha,
    expectedRegionalPromotionSha: promotionSha,
    expectedPublicationBranch: publicationBranch,
    localHeadSha: promotionSha,
    localWorktreeClean: true,
    localBranch: publicationBranch,
    remotePublicationBranchSha: promotionSha,
    remoteTagCommitSha: targetSha,
    regionalPromotionParentShas: [targetSha],
    regionalPromotionChangedFiles: [{ status: 'A', path: regionalMarkerPath }],
    regionalMarkerPresentAtBase: false,
    expectedRegionalMarkerDiffStatus: 'A',
    expectedRegionalMarkerPresentAtBase: false,
    expectedRegionalMarkerPath: regionalMarkerPath,
    regionalMarkerEvidence: { status: 'GREEN', failures: [], sha256: 'marker-exact' },
    liveRegionalMarker: {
      httpStatus: 200,
      sha256: 'marker-exact',
      expectedSha256: 'marker-exact',
    },
    expectedAssets: exactAssets,
    liveManualPublication: {
      latestJsonHttpStatus: 200,
      latestJsonSha256: 'latest-exact',
      expectedLatestJsonSha256: 'latest-exact',
      installPageHttpStatus: 200,
      installPageSha256: 'page-exact',
      expectedInstallPageSha256: 'page-exact',
    },
    productionRuntimeFeeds: {
      darwinArm64: exactFeed('mac'),
      win32X64: exactFeed('windows'),
    },
    productionOldVersion: '0.994.1',
    expectedOldVersion: '0.994.1',
    productionTargetVersion: '0.995.1',
    productionUpdaterTransaction: 'PASS',
    macUpdateDetection: 'PASS',
    macManualFallback: 'PASS',
    automaticRelaunch: true,
    unchangedSentinels: 7,
    expectedSentinels: 7,
    rangeRequestCount: 1,
    fullZipHttp200Count: 0,
    windowsEvidence: { status: 'GREEN', failures: [], proofLabel: 'controller-and-fixed-sha-ci-only', nativeExact: false },
    cosEvidence: { status: 'GREEN', failures: [] },
    macManualDownload: 'PASS',
    chinaMacValidation: 'baseline-reused',
    chinaWindowsValidation: 'baseline-reused',
    baiduAtomicPromotion: 'PASS',
    ...overrides,
  };
}

test('parses the updater size from the indented files entry', () => {
  const metadata = parseUpdaterMetadata(`version: 0.995.1
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
  const result = evaluatePostpublishGate(greenState({ liveVersion: '0.994.1' }));
  assert.deepEqual(result.failures, ['live version mismatch: 0.994.1']);
});

test('rejects stale live manual metadata or page bytes', () => {
  const latestWrong = greenState();
  latestWrong.liveManualPublication = {
    ...latestWrong.liveManualPublication,
    latestJsonSha256: 'stale-latest-json',
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

test('rejects missing durable Windows evidence instead of inferring native proof', () => {
  const result = evaluatePostpublishGate(greenState({
    windowsEvidence: { status: 'RED_STOP_LINE', failures: ['native exact run was not authorized'] },
  }));
  assert.deepEqual(result.failures, [
    'Windows durable evidence: native exact run was not authorized',
  ]);
});

test('rejects a successful automatic Mac transaction that used the full ZIP', () => {
  const result = evaluatePostpublishGate(greenState({ fullZipHttp200Count: 1 }));
  assert.deepEqual(result.failures, ['full updater ZIP was transferred instead of the differential path']);
});

test('rejects a transaction that did not land on the released version', () => {
  const result = evaluatePostpublishGate(greenState({ productionTargetVersion: '0.994.1' }));
  assert.deepEqual(result.failures, ['production updater target mismatch: 0.994.1']);
});

test('keeps customer-clean open until downloads, regional decision and Baidu pass', () => {
  const result = evaluatePostpublishGate(greenState({
    macManualDownload: 'not-run',
    chinaMacValidation: 'not-run',
    chinaWindowsValidation: 'not-run',
    baiduAtomicPromotion: 'in-progress',
  }));
  assert.deepEqual(result.failures, [
    'Mac production Manual Download transaction: not-run',
    'China Mac regional validation: not-run',
    'China Windows regional validation: not-run',
    'Baidu atomic promotion: in-progress',
  ]);
});

test('passes only after both feeds and every final delivery lane are exact', () => {
  assert.deepEqual(evaluatePostpublishGate(greenState()), { status: 'GREEN', failures: [] });
});

test('rejects release target or remote tag drift from the external exact SHA', () => {
  const releaseWrong = greenState();
  releaseWrong.release.targetCommitish = 'main';
  assert.deepEqual(evaluatePostpublishGate(releaseWrong).failures, [
    'published release target SHA mismatch: main',
  ]);

  const tagWrong = greenState({ remoteTagCommitSha: '2'.repeat(40) });
  assert.deepEqual(evaluatePostpublishGate(tagWrong).failures, [
    `remote tag commit SHA mismatch: ${'2'.repeat(40)}`,
  ]);
});

test('postpublish binds local HEAD and remote publication branch to the promotion commit', () => {
  const state = greenState({ remotePublicationBranchSha: '4'.repeat(40) });
  assert.deepEqual(evaluatePostpublishGate(state).failures, [
    `remote publication branch SHA mismatch: ${'4'.repeat(40)}`,
  ]);
});

test('regional promotion must be the one-marker direct child of the immutable base tag', () => {
  const parentWrong = greenState({ regionalPromotionParentShas: ['3'.repeat(40)] });
  assert.deepEqual(evaluatePostpublishGate(parentWrong).failures, [
    `regional promotion parent set mismatch: ${'3'.repeat(40)}`,
  ]);

  const mergeCommit = greenState({ regionalPromotionParentShas: [targetSha, '3'.repeat(40)] });
  assert.deepEqual(evaluatePostpublishGate(mergeCommit).failures, [
    `regional promotion parent set mismatch: ${targetSha},${'3'.repeat(40)}`,
  ]);

  const extraFile = greenState({
    regionalPromotionChangedFiles: [
      { status: 'A', path: regionalMarkerPath },
      { status: 'M', path: 'ocupathif/install.html' },
    ],
  });
  assert.deepEqual(evaluatePostpublishGate(extraFile).failures, [
    'regional promotion commit must add only ocupathif/regional-cos/v0.995.1.json',
  ]);

  const atBase = greenState({ regionalMarkerPresentAtBase: true });
  assert.deepEqual(evaluatePostpublishGate(atBase).failures, [
    'regional marker already existed in the immutable base release commit',
  ]);

  const wrongLiveMarker = greenState({
    liveRegionalMarker: { httpStatus: 200, sha256: 'stale', expectedSha256: 'marker-exact' },
  });
  assert.deepEqual(evaluatePostpublishGate(wrongLiveMarker).failures, [
    'live regional COS marker does not match the promotion commit',
  ]);
});

test('same-version replacement accepts a modified marker already present at the base SHA', () => {
  const replacement = greenState({
    regionalPromotionChangedFiles: [{ status: 'M', path: regionalMarkerPath }],
    regionalMarkerPresentAtBase: true,
    expectedRegionalMarkerDiffStatus: 'M',
    expectedRegionalMarkerPresentAtBase: true,
  });
  assert.deepEqual(evaluatePostpublishGate(replacement), { status: 'GREEN', failures: [] });

  replacement.regionalPromotionChangedFiles = [{ status: 'A', path: regionalMarkerPath }];
  replacement.regionalMarkerPresentAtBase = false;
  assert.deepEqual(evaluatePostpublishGate(replacement).failures, [
    'regional promotion commit must modify only ocupathif/regional-cos/v0.995.1.json',
    'regional marker is missing from the replacement base release commit',
  ]);
});

test('postpublish rechecks the exact four release assets and rejects extras', () => {
  const state = greenState();
  state.release.assets.push({
    name: 'unexpected.zip',
    size: 1,
    digest: `sha256:${'f'.repeat(64)}`,
    state: 'uploaded',
  });
  assert.deepEqual(evaluatePostpublishGate(state).failures, [
    'release asset count mismatch: 5/4',
    'unexpected release assets: unexpected.zip',
  ]);

  const wrongDigest = greenState();
  wrongDigest.release.assets[0].digest = `sha256:${'0'.repeat(64)}`;
  assert.deepEqual(evaluatePostpublishGate(wrongDigest).failures, [
    'release asset bytes mismatch: OcupathIF-0.995.1-arm64-mac.dmg',
  ]);

  const incomplete = greenState();
  incomplete.release.assets[0].state = 'starter';
  assert.deepEqual(evaluatePostpublishGate(incomplete).failures, [
    'release asset incomplete: OcupathIF-0.995.1-arm64-mac.dmg (starter)',
  ]);
});
