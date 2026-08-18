import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePrepublishGate } from '../scripts/prepublish-gate.mjs';

const targetSha = '1'.repeat(40);
const publicationBranch = 'release/09931-production-publish-20260818';

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
      targetCommitish: targetSha,
      assets: Object.entries(exactAssets).map(([name, value]) => ({ name, ...value, state: 'uploaded' })),
    },
    remoteTagPresent: false,
    liveVersion: '0.992.1',
    expectedRollbackVersion: '0.992.1',
    expectedTagName: 'v0.993.1',
    expectedTargetCommitSha: targetSha,
    expectedPublicationBranch: publicationBranch,
    localHeadSha: targetSha,
    localWorktreeClean: true,
    localBranch: publicationBranch,
    remotePublicationBranchSha: targetSha,
    expectedAssets: exactAssets,
    rollbackAuthority: { status: 'GREEN', failures: [] },
    liveRollbackState: { status: 'GREEN', failures: [] },
    manualCosEvidence: { status: 'GREEN', failures: [] },
    windowsEvidence: { status: 'GREEN', failures: [], proofLabel: 'baseline-reused', nativeExact: false },
    ...overrides,
  };
}

test('blocks an incomplete draft before any publication mutation', () => {
  const state = greenState({
    release: {
      ...greenState().release,
      assets: greenState().release.assets.filter((asset) => asset.name !== 'OcupathIF-0.993.1-arm64-mac-standalone.zip'),
    },
    manualCosEvidence: { status: 'RED_STOP_LINE', failures: ['not-run'] },
    windowsEvidence: { status: 'RED_STOP_LINE', failures: ['missing'] },
  });

  const result = evaluatePrepublishGate(state);

  assert.equal(result.status, 'RED_STOP_LINE');
  assert.deepEqual(result.failures, [
    'release asset count mismatch: 3/4',
    'missing release asset: OcupathIF-0.993.1-arm64-mac-standalone.zip',
    'COS manual payload evidence: not-run',
    'Windows durable evidence: missing',
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

test('rejects rollback capture-to-cutover drift before any mutation', () => {
  const result = evaluatePrepublishGate(greenState({
    liveRollbackState: { status: 'RED_STOP_LINE', failures: ['ocupathif/latest.json drifted'] },
  }));
  assert.deepEqual(result.failures, ['live rollback recheck: ocupathif/latest.json drifted']);
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

test('requires the durable Windows evidence verdict instead of a naked status boolean', () => {
  assert.deepEqual(evaluatePrepublishGate(greenState({ windowsEvidence: undefined })).failures, [
    'Windows durable evidence: missing',
  ]);
});

test('website publication does not wait for the parallel Baidu lane', () => {
  const result = evaluatePrepublishGate(greenState({
    baiduAtomicPromotion: 'in-progress',
    cosEvidence: { status: 'RED_STOP_LINE', failures: ['updater payloads not uploaded'] },
    macTwoLegTransaction: 'not-run',
  }));
  assert.deepEqual(result, { status: 'GREEN', failures: [] });
});

test('passes only when every frozen website publication input is exact', () => {
  assert.deepEqual(evaluatePrepublishGate(greenState()), { status: 'GREEN', failures: [] });
});

test('rejects a mutable or different GitHub target', () => {
  const state = greenState();
  state.release.targetCommitish = 'main';
  assert.deepEqual(evaluatePrepublishGate(state).failures, [
    'release target SHA mismatch: main',
  ]);
});

test('binds the external target SHA to local HEAD and the exact remote publication branch', () => {
  assert.deepEqual(evaluatePrepublishGate(greenState({ localHeadSha: '2'.repeat(40) })).failures, [
    `local HEAD SHA mismatch: ${'2'.repeat(40)}`,
  ]);
  assert.deepEqual(evaluatePrepublishGate(greenState({ localBranch: 'main' })).failures, [
    'local publication branch mismatch: main',
  ]);
  assert.deepEqual(evaluatePrepublishGate(greenState({ localWorktreeClean: false })).failures, [
    'local updates worktree is dirty',
  ]);
  assert.deepEqual(evaluatePrepublishGate(greenState({ remotePublicationBranchSha: '3'.repeat(40) })).failures, [
    `remote publication branch SHA mismatch: ${'3'.repeat(40)}`,
  ]);
});

test('rejects duplicate, extra, or differently digested release assets', () => {
  const state = greenState();
  state.release.assets.push({
    name: 'unexpected.txt',
    size: 1,
    digest: `sha256:${'f'.repeat(64)}`,
    state: 'uploaded',
  });
  assert.deepEqual(evaluatePrepublishGate(state).failures, [
    'release asset count mismatch: 5/4',
    'unexpected release assets: unexpected.txt',
  ]);

  const duplicate = greenState();
  duplicate.release.assets.push({ ...duplicate.release.assets[0] });
  assert.deepEqual(evaluatePrepublishGate(duplicate).failures, [
    'release asset count mismatch: 5/4',
    'duplicate release assets: OcupathIF-0.993.1-arm64-mac-standalone.zip',
  ]);
});
