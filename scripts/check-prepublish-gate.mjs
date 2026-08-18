#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildCosAuthority,
  loadCosEvidence,
  validateCosEvidence,
} from './cos-publication.mjs';
import { evaluatePrepublishGate } from './prepublish-gate.mjs';
import {
  DEFAULT_STAGING_MANIFEST_URL,
  loadReleaseManifest,
  requireExactCommitSha,
} from './release-manifest.mjs';
import { loadRollbackAuthority } from './rollback-authority.mjs';
import { loadWindowsEvidence } from './windows-evidence.mjs';

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function inputStatus(name, fallback) {
  return process.env[name] || fallback;
}

function expectedReleaseAssets(manifest) {
  const keys = manifest.publication.githubAssetKeys;
  return Object.fromEntries(keys.map((key) => {
    const asset = manifest.assets[key];
    return [asset.fileName, {
      size: asset.sizeBytes,
      digest: `sha256:${asset.sha256}`,
    }];
  }));
}

function stopForConfiguration(error) {
  const result = {
    status: 'RED_STOP_LINE',
    failures: [error instanceof Error ? error.message : String(error)],
    phase: 'local-publication-inputs',
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 2;
}

try {
  const manifestSource = process.env.OCUPATH_RELEASE_STAGING_MANIFEST || DEFAULT_STAGING_MANIFEST_URL;
  const manifest = loadReleaseManifest(manifestSource);
  const expectedTargetCommitSha = requireExactCommitSha(
    process.env.OCUPATH_RELEASE_TARGET_SHA,
    'OCUPATH_RELEASE_TARGET_SHA',
  );
  const manifestPath = manifestSource instanceof URL ? fileURLToPath(manifestSource) : manifestSource;
  run(process.execPath, [
    fileURLToPath(new URL('./render-release.mjs', import.meta.url)),
    manifestPath,
    '--check',
  ]);
  const macFeedBody = readFileSync(
    new URL('../ocupathif/direct/darwin-arm64/latest-mac.yml', import.meta.url),
    'utf8',
  );
  const cosAuthority = buildCosAuthority(manifest, { darwinArm64: macFeedBody });
  const cosEvidence = validateCosEvidence(
    cosAuthority,
    loadCosEvidence(process.env.OCUPATH_COS_EVIDENCE_JSON),
  );
  const windowsEvidence = loadWindowsEvidence(
    process.env.OCUPATH_WINDOWS_EVIDENCE_JSON,
    manifest,
    { phase: 'prepublish' },
  ).result;
  const rollbackAuthority = loadRollbackAuthority().result;

  const release = JSON.parse(run('gh', [
    'api',
    `repos/${manifest.release.repository}/releases/${manifest.release.draftReleaseId}`,
  ]));
  const remoteTagPresent = run('git', [
    'ls-remote',
    '--tags',
    'origin',
    manifest.release.tagName,
  ]) !== '';
  const liveManifest = JSON.parse(run('curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    `${manifest.origins.public}/latest.json`,
  ]));

  const state = {
    publicationFilesCurrent: true,
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
    expectedRollbackVersion: manifest.previousLiveVersion,
    expectedTagName: manifest.release.tagName,
    expectedTargetCommitSha,
    expectedAssets: expectedReleaseAssets(manifest),
    rollbackAuthority,
    cosEvidence,
    macTwoLegTransaction: inputStatus('OCUPATH_MAC_TWO_LEG_TRANSACTION', 'not-run'),
    windowsEvidence,
  };

  const result = evaluatePrepublishGate(state);
  process.stdout.write(`${JSON.stringify({ ...result, state }, null, 2)}\n`);
  if (result.status !== 'GREEN') process.exitCode = 2;
} catch (error) {
  stopForConfiguration(error);
}
