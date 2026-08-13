#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

import { evaluatePrepublishGate } from './prepublish-gate.mjs';

const repository = 'Yuqian1017/ocupath-updates';
const releaseId = '369530281';
const expectedTagName = 'v0.991.1';
const expectedTargetCommitish = 'release/0991-two-leg-feed-20260810';

const expectedAssets = {
  'OcupathIF-0.991.1-arm64-mac-standalone.zip': {
    size: 1318746948,
    digest: 'sha256:c18c0d29158f8c24ea8e7861dba52100581dde5e10af3600a8d5127452364009',
  },
  'OcupathIF-Setup-0.991.1-x64.exe': {
    size: 1354650736,
    digest: 'sha256:3db8fcd6deabbc55e2b37c6e086234bf448d536392703e5700e83ca4803091ac',
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

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function inputStatus(name, fallback) {
  return process.env[name] || fallback;
}

const release = JSON.parse(run('gh', [
  'api',
  `repos/${repository}/releases/${releaseId}`,
]));
const remoteTagPresent = run('git', [
  'ls-remote',
  '--tags',
  'origin',
  expectedTagName,
]) !== '';
const liveManifest = JSON.parse(run('curl', [
  '--fail',
  '--silent',
  '--show-error',
  '--location',
  'https://updates.ocupath.ai/ocupathif/latest.json',
]));

const state = {
  release: {
    draft: release.draft,
    tagName: release.tag_name,
    targetCommitish: release.target_commitish,
    assets: release.assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      digest: asset.digest,
      state: asset.state,
    })),
  },
  remoteTagPresent,
  liveVersion: liveManifest.version,
  expectedRollbackVersion: '0.99.1',
  expectedTagName,
  expectedTargetCommitish,
  expectedAssets,
  cosObjectsVerified: Number(inputStatus('OCUPATH_COS_OBJECTS_VERIFIED', '0')),
  expectedCosObjects: 6,
  macTwoLegTransaction: inputStatus('OCUPATH_MAC_TWO_LEG_TRANSACTION', 'not-run'),
  windowsNativeValidation: inputStatus('OCUPATH_WINDOWS_NATIVE_VALIDATION', 'evidence-blocked'),
  baiduAtomicPromotion: inputStatus('OCUPATH_BAIDU_ATOMIC_PROMOTION', 'in-progress'),
};

const result = evaluatePrepublishGate(state);
process.stdout.write(`${JSON.stringify({ ...result, state }, null, 2)}\n`);
if (result.status !== 'GREEN') process.exitCode = 2;
