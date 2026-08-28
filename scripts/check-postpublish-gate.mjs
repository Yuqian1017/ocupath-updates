#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLiveCosGate } from './live-cos-gate.mjs';
import {
  evaluatePostpublishGate,
  parseUpdaterMetadata,
} from './postpublish-gate.mjs';
import {
  REGIONAL_COS_MARKER_PATH,
  REGIONAL_COS_MARKER_URL_PATH,
  regionalCosMarkerBody,
  validateRegionalCosMarker,
} from './regional-cos-marker.mjs';
import {
  DEFAULT_STAGING_MANIFEST_URL,
  loadReleaseManifest,
  regionalPromotionTopology,
  requireExactCommitSha,
  requirePublicationBranch,
  releaseUrls,
} from './release-manifest.mjs';
import { loadWindowsEvidence, validateWindowsCiApiState } from './windows-evidence.mjs';

const scriptRepoRoot = fileURLToPath(new URL('../', import.meta.url));
const releaseStateRepoRoot = resolve(
  process.env.OCUPATH_RELEASE_REPO_ROOT || scriptRepoRoot,
);

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim();
}

function fetchTextWithStatus(url) {
  const response = execFileSync('curl', [
    '--silent', '--show-error', '--location', '--write-out', '\n%{http_code}', url,
  ], { encoding: 'utf8' });
  const statusSeparator = response.lastIndexOf('\n');
  return {
    body: response.slice(0, statusSeparator),
    httpStatus: Number(response.slice(statusSeparator + 1)),
  };
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

function runtimeFeedState({ localPath, liveUrl, expectedAsset, expectedPath }) {
  const response = fetchTextWithStatus(liveUrl);
  const metadata = parseUpdaterMetadata(response.body);
  const expectedBody = readFileSync(localPath, 'utf8');
  return {
    url: liveUrl,
    expectedUrl: liveUrl,
    httpStatus: response.httpStatus,
    sha256: createHash('sha256').update(response.body).digest('hex'),
    expectedSha256: createHash('sha256').update(expectedBody).digest('hex'),
    version: metadata.version,
    path: metadata.path,
    expectedPath,
    sha512: metadata.sha512,
    expectedSha512: expectedAsset.sha512,
    size: metadata.size,
    expectedSize: expectedAsset.sizeBytes,
  };
}

function expectedReleaseAssets(manifest) {
  return Object.fromEntries(manifest.publication.githubAssetKeys.map((key) => {
    const asset = manifest.assets[key];
    return [asset.fileName, {
      size: asset.sizeBytes,
      digest: `sha256:${asset.sha256}`,
    }];
  }));
}

function remoteTagCommitSha(tagName) {
  const output = run('git', [
    'ls-remote',
    'origin',
    `refs/tags/${tagName}`,
    `refs/tags/${tagName}^{}`,
  ], { cwd: releaseStateRepoRoot });
  const rows = output.split('\n').filter(Boolean).map((line) => line.split(/\s+/));
  const peeled = rows.find(([, ref]) => ref === `refs/tags/${tagName}^{}`);
  const direct = rows.find(([, ref]) => ref === `refs/tags/${tagName}`);
  if (!peeled && !direct) throw new Error(`remote tag is missing: ${tagName}`);
  return (peeled || direct)[0];
}

function remoteBranchSha(branch) {
  const output = run('git', [
    'ls-remote', '--heads', 'origin', `refs/heads/${branch}`,
  ], { cwd: releaseStateRepoRoot });
  if (!output) return undefined;
  const [sha, ref] = output.split(/\s+/);
  if (ref !== `refs/heads/${branch}`) return undefined;
  return sha;
}

function gitObjectExists(spec) {
  try {
    run('git', ['cat-file', '-e', spec], { cwd: releaseStateRepoRoot });
    return true;
  } catch {
    return false;
  }
}

function changedFiles(fromSha, toSha) {
  const output = run('git', ['diff', '--name-status', fromSha, toSha], { cwd: releaseStateRepoRoot });
  if (!output) return [];
  return output.split('\n').map((line) => {
    const [status, path] = line.split('\t');
    return { status, path };
  });
}

function commitParents(sha) {
  const [commit, ...parents] = run('git', [
    'rev-list', '--parents', '-n', '1', sha,
  ], { cwd: releaseStateRepoRoot }).split(/\s+/);
  if (commit !== sha) throw new Error(`git did not resolve the exact promotion SHA: ${sha}`);
  return parents;
}

try {
  const manifestSource = process.env.OCUPATH_RELEASE_STAGING_MANIFEST || DEFAULT_STAGING_MANIFEST_URL;
  const manifest = loadReleaseManifest(manifestSource);
  const expectedTargetCommitSha = requireExactCommitSha(
    process.env.OCUPATH_RELEASE_TARGET_SHA,
    'OCUPATH_RELEASE_TARGET_SHA',
  );
  const expectedRegionalPromotionSha = requireExactCommitSha(
    process.env.OCUPATH_REGIONAL_PROMOTION_SHA,
    'OCUPATH_REGIONAL_PROMOTION_SHA',
  );
  if (expectedRegionalPromotionSha === expectedTargetCommitSha) {
    throw new Error('OCUPATH_REGIONAL_PROMOTION_SHA must differ from the immutable base release SHA');
  }
  const expectedPublicationBranch = requirePublicationBranch(process.env.OCUPATH_RELEASE_BRANCH);
  const manifestPath = manifestSource instanceof URL ? fileURLToPath(manifestSource) : manifestSource;
  run(process.execPath, [
    fileURLToPath(new URL('./render-release.mjs', import.meta.url)),
    manifestPath,
    '--check',
  ]);
  const localHeadSha = run('git', ['rev-parse', 'HEAD'], { cwd: releaseStateRepoRoot });
  const localWorktreeClean = run('git', ['status', '--porcelain'], { cwd: releaseStateRepoRoot }) === '';
  const localBranch = run('git', ['branch', '--show-current'], { cwd: releaseStateRepoRoot });
  const remotePublicationBranchSha = remoteBranchSha(expectedPublicationBranch);
  const publishedTagCommitSha = remoteTagCommitSha(manifest.release.tagName);
  const regionalPromotionParentShas = commitParents(expectedRegionalPromotionSha);
  const regionalPromotionChangedFiles = changedFiles(expectedTargetCommitSha, expectedRegionalPromotionSha);
  const regionalMarkerPresentAtBase = gitObjectExists(`${expectedTargetCommitSha}:${REGIONAL_COS_MARKER_PATH}`);
  const expectedTopology = regionalPromotionTopology(manifest);
  const expectedPromotionDiff = [{
    status: expectedTopology.markerDiffStatus,
    path: REGIONAL_COS_MARKER_PATH,
  }];
  const topologyFailures = [];
  if (localHeadSha !== expectedRegionalPromotionSha) topologyFailures.push('local HEAD is not the regional promotion SHA');
  if (!localWorktreeClean) topologyFailures.push('local updates worktree is dirty');
  if (localBranch !== expectedPublicationBranch) topologyFailures.push('local branch is not the publication branch');
  if (remotePublicationBranchSha !== expectedRegionalPromotionSha) topologyFailures.push('remote publication branch is not the promotion SHA');
  if (publishedTagCommitSha !== expectedTargetCommitSha) topologyFailures.push('remote release tag is not the immutable base SHA');
  if (JSON.stringify(regionalPromotionParentShas) !== JSON.stringify([expectedTargetCommitSha])) {
    topologyFailures.push('regional promotion must have exactly one parent and it must be the base SHA');
  }
  if (JSON.stringify(regionalPromotionChangedFiles) !== JSON.stringify(expectedPromotionDiff)) {
    const action = expectedTopology.markerDiffStatus === 'M' ? 'modified' : 'added';
    topologyFailures.push(`regional promotion diff is not the single ${action} marker ${REGIONAL_COS_MARKER_PATH}`);
  }
  if (regionalMarkerPresentAtBase !== expectedTopology.markerPresentAtBase) {
    topologyFailures.push(expectedTopology.markerPresentAtBase
      ? 'regional marker is missing from the replacement base SHA'
      : 'regional marker already exists at the initial base SHA');
  }
  if (topologyFailures.length > 0) {
    throw new Error(`Regional promotion topology is invalid:\n- ${topologyFailures.join('\n- ')}`);
  }
  const urls = releaseUrls(manifest);
  const macFeedPath = new URL('../ocupathif/direct/darwin-arm64/latest-mac.yml', import.meta.url);
  const windowsFeedPath = new URL('../ocupathif/direct/win32-x64/latest.yml', import.meta.url);
  const cosAuthorityPath = fileURLToPath(new URL('../release-manifests/v0.995.1-cos-authority.json', import.meta.url));
  const cosAuthority = JSON.parse(readFileSync(cosAuthorityPath, 'utf8'));
  const cosUploadLedgerPath = process.env.OCUPATH_COS_UPLOAD_LEDGER_JSON;
  if (!cosUploadLedgerPath) throw new Error('OCUPATH_COS_UPLOAD_LEDGER_JSON is required');
  const cosEvidence = await runLiveCosGate(cosAuthorityPath, cosUploadLedgerPath);
  const regionalMarkerPath = fileURLToPath(new URL(`../${REGIONAL_COS_MARKER_PATH}`, import.meta.url));
  const localRegionalMarkerBody = readFileSync(regionalMarkerPath, 'utf8');
  const regionalMarker = JSON.parse(localRegionalMarkerBody);
  const regionalMarkerValidation = validateRegionalCosMarker({
    marker: regionalMarker,
    manifest,
    authority: cosAuthority,
    liveGate: cosEvidence,
    baseReleaseCommitSha: expectedTargetCommitSha,
  });
  const regionalMarkerFailures = [...regionalMarkerValidation.failures];
  if (localRegionalMarkerBody !== regionalCosMarkerBody(regionalMarker)) {
    regionalMarkerFailures.push('regional marker body is not canonical rendered JSON');
  }
  const regionalMarkerEvidence = {
    ...regionalMarkerValidation,
    status: regionalMarkerFailures.length === 0 ? 'GREEN' : 'RED_STOP_LINE',
    failures: regionalMarkerFailures,
    sha256: createHash('sha256').update(localRegionalMarkerBody).digest('hex'),
  };
  const windowsLoaded = loadWindowsEvidence(
    process.env.OCUPATH_WINDOWS_EVIDENCE_JSON,
    manifest,
    { phase: 'postpublish' },
  );
  const windowsCi = windowsLoaded.evidence.fixedShaCi;
  const windowsCiApi = validateWindowsCiApiState(windowsLoaded.evidence, {
    run: JSON.parse(run('gh', ['api', `repos/${windowsCi.repository}/actions/runs/${windowsCi.runId}`])),
    job: JSON.parse(run('gh', ['api', `repos/${windowsCi.repository}/actions/jobs/${windowsCi.jobId}`])),
  });
  const windowsEvidence = {
    ...windowsLoaded.result,
    status: windowsLoaded.result.status === 'GREEN' && windowsCiApi.status === 'GREEN'
      ? 'GREEN'
      : 'RED_STOP_LINE',
    failures: [...windowsLoaded.result.failures, ...windowsCiApi.failures],
  };
  const release = JSON.parse(run('gh', [
    'api',
    `repos/${manifest.release.repository}/releases/${manifest.release.draftReleaseId}`,
  ]));
  const liveLatestPage = fetchTextWithStatus(`${manifest.origins.public}/latest.json`);
  const liveManifest = JSON.parse(liveLatestPage.body);
  const localLatestPage = readFileSync(new URL('../ocupathif/latest.json', import.meta.url), 'utf8');
  const liveInstallPage = fetchTextWithStatus(`${manifest.origins.public}/install.html`);
  const localInstallPage = readFileSync(new URL('../ocupathif/install.html', import.meta.url), 'utf8');
  const liveRegionalMarker = fetchTextWithStatus(`${manifest.origins.public}${REGIONAL_COS_MARKER_URL_PATH}`);

  let transaction = {};
  const transactionSummaryPath = process.env.OCUPATH_PRODUCTION_TRANSACTION_SUMMARY;
  if (transactionSummaryPath) transaction = JSON.parse(readFileSync(transactionSummaryPath, 'utf8'));

  const state = {
    liveVersion: liveManifest.version,
    expectedVersion: manifest.version,
    localHeadSha,
    localWorktreeClean,
    localBranch,
    remotePublicationBranchSha,
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
    expectedTagName: manifest.release.tagName,
    expectedTargetCommitSha,
    expectedRegionalPromotionSha,
    expectedPublicationBranch,
    remoteTagCommitSha: publishedTagCommitSha,
    regionalPromotionParentShas,
    regionalPromotionChangedFiles,
    regionalMarkerPresentAtBase,
    expectedRegionalMarkerDiffStatus: expectedTopology.markerDiffStatus,
    expectedRegionalMarkerPresentAtBase: expectedTopology.markerPresentAtBase,
    expectedRegionalMarkerPath: REGIONAL_COS_MARKER_PATH,
    regionalMarkerEvidence,
    liveRegionalMarker: {
      httpStatus: liveRegionalMarker.httpStatus,
      sha256: createHash('sha256').update(liveRegionalMarker.body).digest('hex'),
      expectedSha256: regionalMarkerEvidence.sha256,
    },
    expectedAssets: expectedReleaseAssets(manifest),
    liveManualPublication: {
      latestJsonHttpStatus: liveLatestPage.httpStatus,
      latestJsonSha256: createHash('sha256').update(liveLatestPage.body).digest('hex'),
      expectedLatestJsonSha256: createHash('sha256').update(localLatestPage).digest('hex'),
      installPageHttpStatus: liveInstallPage.httpStatus,
      installPageSha256: createHash('sha256').update(liveInstallPage.body).digest('hex'),
      expectedInstallPageSha256: createHash('sha256').update(localInstallPage).digest('hex'),
    },
    productionRuntimeFeeds: {
      darwinArm64: runtimeFeedState({
        localPath: macFeedPath,
        liveUrl: urls.macFeed,
        expectedAsset: manifest.assets.macUpdater,
        expectedPath: urls.macUpdaterCos,
      }),
      win32X64: runtimeFeedState({
        localPath: windowsFeedPath,
        liveUrl: urls.windowsFeed,
        expectedAsset: manifest.assets.windowsInstaller,
        expectedPath: urls.windowsCos,
      }),
    },
    productionOldVersion: transaction.fromVersion ?? manifest.previousLiveVersion,
    productionTargetVersion: transaction.toVersion ?? process.env.OCUPATH_PRODUCTION_TARGET_VERSION,
    expectedOldVersion: manifest.previousLiveVersion,
    productionUpdaterTransaction: transaction.status ?? 'not-run',
    macUpdateDetection: process.env.OCUPATH_MAC_UPDATE_DETECTION ?? 'not-run',
    macManualFallback: process.env.OCUPATH_MAC_MANUAL_FALLBACK ?? 'not-run',
    automaticRelaunch: transaction.ui?.automaticRelaunchObserved ?? false,
    unchangedSentinels: transaction.sentinels?.unchangedCount ?? 0,
    expectedSentinels: 7,
    rangeRequestCount: transaction.download?.rangeRequestCount ?? 0,
    fullZipHttp200Count: transaction.download?.fullZipHttp200Count ?? 0,
    cosEvidence,
    windowsEvidence,
    macManualDownload: process.env.OCUPATH_MAC_MANUAL_DOWNLOAD ?? 'not-run',
    chinaMacValidation: process.env.OCUPATH_CHINA_MAC_VALIDATION ?? 'not-run',
    chinaWindowsValidation: process.env.OCUPATH_CHINA_WINDOWS_VALIDATION ?? 'not-run',
    baiduAtomicPromotion: process.env.OCUPATH_BAIDU_ATOMIC_PROMOTION ?? 'in-progress',
  };

  const result = evaluatePostpublishGate(state);
  process.stdout.write(`${JSON.stringify({ ...result, state }, null, 2)}\n`);
  if (result.status !== 'GREEN') process.exitCode = 2;
} catch (error) {
  stopForConfiguration(error);
}
