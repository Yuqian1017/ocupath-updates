import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePrepublishGate } from '../scripts/prepublish-gate.mjs';

const exactAssets = {
  'OcupathIF-0.993.1-arm64-mac-standalone.zip': {
    size: 101,
    digest: `sha256:${'a'.repeat(64)}`,
  },
  'OcupathIF-Setup-0.993.1-x64.exe': {
    size: 102,
    digest: `sha256:${'b'.repeat(64)}`,
  },
  'OcuPathIF_v0.993.1_User_Guide_en.pdf': {
    size: 2256745,
    digest: 'sha256:00979793eae523f0fb8922d56880672fffcf743437eb497ea6e5127a2f8a294c',
  },
  'OcuPathIF_v0.993.1_User_Guide_zh.pdf': {
    size: 2535248,
    digest: 'sha256:67d2f1844142927b40b2cc698d1b99ab359f376fb0b6bec8dc802e0facdafbb1',
  },
};

function greenState(overrides = {}) {
  return {
    publicationFilesCurrent: true,
    release: {
      draft: true,
      tagName: 'v0.993.1',
      targetCommitish: 'release/09931-production-publish-20260818',
      assets: Object.entries(exactAssets).map(([name, value]) => ({ name, ...value, state: 'uploaded' })),
    },
    remoteTagPresent: false,
    liveVersion: '0.992.1',
    expectedRollbackVersion: '0.992.1',
    expectedTagName: 'v0.993.1',
    expectedTargetCommitish: 'release/09931-production-publish-20260818',
    expectedAssets: exactAssets,
    cosObjectsVerified: 4,
    expectedCosObjects: 4,
    macTwoLegTransaction: 'PASS',
    windowsNativeValidation: 'baseline-reused',
    ...overrides,
  };
}

test('blocks an incomplete draft before any publication mutation', () => {
  const state = greenState({
    release: {
      ...greenState().release,
      assets: greenState().release.assets.filter((asset) => asset.name !== 'OcupathIF-0.993.1-arm64-mac-standalone.zip'),
    },
    cosObjectsVerified: 0,
    macTwoLegTransaction: 'not-run',
    windowsNativeValidation: 'rerun-required',
  });

  const result = evaluatePrepublishGate(state);

  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, [
    'missing release asset: OcupathIF-0.993.1-arm64-mac-standalone.zip',
    'COS exact objects verified: 0/4',
    'Mac two-leg updater transaction: not-run',
    'Windows native risk decision: rerun-required',
  ]);
});

test('rejects stale rendered publication files', () => {
  const result = evaluatePrepublishGate(greenState({ publicationFilesCurrent: false }));
  assert.deepEqual(result.failures, [
    'rendered publication files do not match the frozen staging manifest',
  ]);
});

test('rejects a tag created before the gate opens', () => {
  const result = evaluatePrepublishGate(greenState({ remoteTagPresent: true }));
  assert.deepEqual(result.failures, ['remote tag already exists before publication: v0.993.1']);
});

test('rejects a same-name asset with different bytes', () => {
  const state = greenState();
  state.release.assets = state.release.assets.map((asset) => (
    asset.name === 'OcupathIF-0.993.1-arm64-mac-standalone.zip'
      ? { ...asset, size: asset.size - 1 }
      : asset
  ));
  assert.deepEqual(evaluatePrepublishGate(state).failures, [
    'release asset bytes mismatch: OcupathIF-0.993.1-arm64-mac-standalone.zip',
  ]);
});

test('rejects a starter asset even when GitHub reports the expected size', () => {
  const state = greenState();
  state.release.assets = state.release.assets.map((asset) => (
    asset.name === 'OcupathIF-0.993.1-arm64-mac-standalone.zip'
      ? { ...asset, state: 'starter', digest: null }
      : asset
  ));
  assert.deepEqual(evaluatePrepublishGate(state).failures, [
    'release asset incomplete: OcupathIF-0.993.1-arm64-mac-standalone.zip (starter)',
  ]);
});

test('accepts either documented Windows baseline reuse or a fresh exact-package run', () => {
  assert.deepEqual(evaluatePrepublishGate(greenState({ windowsNativeValidation: 'baseline-reused' })), { status: 'GREEN', failures: [] });
  assert.deepEqual(evaluatePrepublishGate(greenState({ windowsNativeValidation: 'PASS' })), { status: 'GREEN', failures: [] });
});

test('website publication does not wait for the parallel Baidu lane', () => {
  const result = evaluatePrepublishGate(greenState({ baiduAtomicPromotion: 'in-progress' }));
  assert.deepEqual(result, { status: 'GREEN', failures: [] });
});

test('passes only when every frozen website publication input is exact', () => {
  assert.deepEqual(evaluatePrepublishGate(greenState()), { status: 'GREEN', failures: [] });
});
