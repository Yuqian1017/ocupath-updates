#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { evaluatePrepublishGate } from './prepublish-gate.mjs';
import { REGIONAL_COS_MARKER_PATH } from './regional-cos-marker.mjs';
import {
  DEFAULT_STAGING_MANIFEST_URL,
  loadReleaseManifest,
  requireExactCommitSha,
  requirePublicationBranch,
  validateWebsitePublicationManifest,
} from './release-manifest.mjs';
import {
  loadRollbackAuthority,
  rollbackStepUrl,
  validateLiveRollbackState,
} from './rollback-authority.mjs';
import { loadWindowsEvidence, validateWindowsCiApiState } from './windows-evidence.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim();
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

function remoteBranchSha(branch) {
  const output = run('git', [
    'ls-remote', '--heads', 'origin', `refs/heads/${branch}`,
  ], { cwd: repoRoot });
  if (!output) return undefined;
  const [sha, ref] = output.split(/\s+/);
  if (ref !== `refs/heads/${branch}`) return undefined;
  return sha;
}

function liveRollbackObservations(authority) {
  return authority.restoreSteps.map((step) => {
    const url = rollbackStepUrl(authority, step);
    const response = execFileSync('curl', [
      '--silent', '--show-error', '--location', '--write-out', '\n%{http_code}', url,
    ]);
    const separator = response.lastIndexOf(10);
    const body = response.subarray(0, separator);
    return {
      url,
      httpStatus: Number(response.subarray(separator + 1).toString()),
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  });
}

try {
  const manifestSource = process.env.OCUPATH_RELEASE_STAGING_MANIFEST || DEFAULT_STAGING_MANIFEST_URL;
  const manifest = loadReleaseManifest(manifestSource, { requireFinal: false });
  const websiteManifest = validateWebsitePublicationManifest(manifest);
  if (websiteManifest.status !== 'GREEN') {
    throw new Error(`Website publication manifest is not publishable:\n- ${websiteManifest.failures.join('\n- ')}`);
  }
  const expectedTargetCommitSha = requireExactCommitSha(
    process.env.OCUPATH_RELEASE_TARGET_SHA,
    'OCUPATH_RELEASE_TARGET_SHA',
  );
  const expectedPublicationBranch = requirePublicationBranch(process.env.OCUPATH_RELEASE_BRANCH);
  const manifestPath = manifestSource instanceof URL ? fileURLToPath(manifestSource) : manifestSource;
  run(process.execPath, [
    fileURLToPath(new URL('./render-release.mjs', import.meta.url)),
    manifestPath,
    '--website-only',
    '--check',
  ]);
  const windowsLoaded = loadWindowsEvidence(
    process.env.OCUPATH_WINDOWS_EVIDENCE_JSON,
    manifest,
    { phase: 'prepublish' },
  );
  const windowsCiApi = validateWindowsCiApiState(windowsLoaded.evidence, {
    run: JSON.parse(run('gh', ['api', 'repos/Yuqian1017/ocupathif_new/actions/runs/32411740699'])),
    job: JSON.parse(run('gh', ['api', 'repos/Yuqian1017/ocupathif_new/actions/jobs/96563504711'])),
  });
  const windowsEvidence = {
    ...windowsLoaded.result,
    status: windowsLoaded.result.status === 'GREEN' && windowsCiApi.status === 'GREEN'
      ? 'GREEN'
      : 'RED_STOP_LINE',
    failures: [...windowsLoaded.result.failures, ...windowsCiApi.failures],
  };
  const rollback = loadRollbackAuthority();
  const rollbackAuthority = rollback.result;
  const liveRollbackState = validateLiveRollbackState(
    rollback.authority,
    liveRollbackObservations(rollback.authority),
  );

  const release = JSON.parse(run('gh', [
    'api',
    `repos/${manifest.release.repository}/releases/${manifest.release.draftReleaseId}`,
  ]));
  const remoteTagPresent = run('git', [
    'ls-remote',
    '--tags',
    'origin',
    manifest.release.tagName,
  ], { cwd: repoRoot }) !== '';
  const liveManifest = JSON.parse(run('curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    `${manifest.origins.public}/latest.json`,
  ]));

  const state = {
    publicationFilesCurrent: true,
    localHeadSha: run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
    localWorktreeClean: run('git', ['status', '--porcelain'], { cwd: repoRoot }) === '',
    localBranch: run('git', ['branch', '--show-current'], { cwd: repoRoot }),
    remotePublicationBranchSha: remoteBranchSha(expectedPublicationBranch),
    regionalMarkerPresent: existsSync(new URL(`../${REGIONAL_COS_MARKER_PATH}`, import.meta.url)),
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
    expectedPublicationBranch,
    expectedAssets: expectedReleaseAssets(manifest),
    rollbackAuthority,
    liveRollbackState,
    windowsEvidence,
  };

  const result = evaluatePrepublishGate(state);
  process.stdout.write(`${JSON.stringify({ ...result, state }, null, 2)}\n`);
  if (result.status !== 'GREEN') process.exitCode = 2;
} catch (error) {
  stopForConfiguration(error);
}
