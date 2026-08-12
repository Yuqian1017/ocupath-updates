import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePrepublishGate } from '../scripts/prepublish-gate.mjs';

const exactAssets = {
  'OcupathIF-0.991.1-arm64-mac.zip': {
    size: 1319589471,
    digest: 'sha256:aa28c4c8b082346316fd449d1f483d0cdf8d4820529a84215ace50e8db647d7e',
  },
  'OcupathIF-Setup-0.991.1-x64.exe': {
    size: 1354649495,
    digest: 'sha256:23c3981ce1b7076040a748c513504595a852c6c7c0e5b0d54499706a7bb0ce2d',
  },
  'OcuPathIF_v0.991.1_User_Guide_en.pdf': {
    size: 2259757,
    digest: 'sha256:7382634b07486eb0c7439c1e6ed8fd20182a856faeb45f948fb364fffdac23dc',
  },
  'OcuPathIF_v0.991.1_User_Guide_zh.pdf': {
    size: 2546526,
    digest: 'sha256:97550c86147300606f5744a648b8c85b15fa4f0937628a14cfc2ae716489581c',
  },
};

function greenState(overrides = {}) {
  return {
    release: {
      draft: true,
      tagName: 'v0.991.1',
      targetCommitish: 'release/0991-two-leg-feed-20260810',
      assets: Object.entries(exactAssets).map(([name, value]) => ({ name, ...value })),
    },
    remoteTagPresent: false,
    liveVersion: '0.99.1',
    expectedRollbackVersion: '0.99.1',
    expectedTagName: 'v0.991.1',
    expectedTargetCommitish: 'release/0991-two-leg-feed-20260810',
    expectedAssets: exactAssets,
    cosObjectsVerified: 6,
    expectedCosObjects: 6,
    macTwoLegTransaction: 'PASS',
    windowsNativeValidation: 'PASS',
    baiduAtomicPromotion: 'PASS',
    ...overrides,
  };
}

test('blocks an incomplete draft before any publication mutation', () => {
  const state = greenState({
    release: {
      ...greenState().release,
      assets: greenState().release.assets.filter((asset) => asset.name !== 'OcupathIF-0.991.1-arm64-mac.zip'),
    },
    cosObjectsVerified: 0,
    macTwoLegTransaction: 'not-run',
    windowsNativeValidation: 'evidence-blocked',
    baiduAtomicPromotion: 'in-progress',
  });

  const result = evaluatePrepublishGate(state);

  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, [
    'missing release asset: OcupathIF-0.991.1-arm64-mac.zip',
    'COS exact objects verified: 0/6',
    'Mac two-leg updater transaction: not-run',
    'Windows native validation: evidence-blocked',
    'Baidu atomic promotion: in-progress',
  ]);
});

test('rejects a tag created before the gate opens', () => {
  const result = evaluatePrepublishGate(greenState({ remoteTagPresent: true }));
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, ['remote tag already exists before publication: v0.991.1']);
});

test('rejects a same-name asset with different bytes', () => {
  const state = greenState();
  state.release.assets = state.release.assets.map((asset) => (
    asset.name === 'OcupathIF-0.991.1-arm64-mac.zip'
      ? { ...asset, size: asset.size - 1 }
      : asset
  ));
  const result = evaluatePrepublishGate(state);
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, ['release asset bytes mismatch: OcupathIF-0.991.1-arm64-mac.zip']);
});

test('passes only when every frozen publication input is exact', () => {
  const result = evaluatePrepublishGate(greenState());
  assert.deepEqual(result, { status: 'GREEN', failures: [] });
});
