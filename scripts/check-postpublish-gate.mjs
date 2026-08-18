#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildCosAuthority,
  loadCosEvidence,
  validateCosEvidence,
} from './cos-publication.mjs';
import {
  evaluatePostpublishGate,
  parseUpdaterMetadata,
} from './postpublish-gate.mjs';
import {
  DEFAULT_STAGING_MANIFEST_URL,
  loadReleaseManifest,
  requireExactCommitSha,
  releaseUrls,
} from './release-manifest.mjs';
import { loadWindowsEvidence } from './windows-evidence.mjs';

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
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

function runtimeFeedState({ manifest, localPath, liveUrl, expectedAsset }) {
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
    expectedPath: `${manifest.origins.cos}/${expectedAsset.fileName}`,
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
  ]);
  const rows = output.split('\n').filter(Boolean).map((line) => line.split(/\s+/));
  const peeled = rows.find(([, ref]) => ref === `refs/tags/${tagName}^{}`);
  const direct = rows.find(([, ref]) => ref === `refs/tags/${tagName}`);
  if (!peeled && !direct) throw new Error(`remote tag is missing: ${tagName}`);
  return (peeled || direct)[0];
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
  const urls = releaseUrls(manifest);
  const macFeedPath = new URL('../ocupathif/direct/darwin-arm64/latest-mac.yml', import.meta.url);
  const windowsFeedPath = new URL('../ocupathif/direct/win32-x64/latest.yml', import.meta.url);
  const cosAuthority = buildCosAuthority(manifest, {
    darwinArm64: readFileSync(macFeedPath, 'utf8'),
  });
  const cosEvidence = validateCosEvidence(
    cosAuthority,
    loadCosEvidence(process.env.OCUPATH_COS_EVIDENCE_JSON),
  );
  const windowsEvidence = loadWindowsEvidence(
    process.env.OCUPATH_WINDOWS_EVIDENCE_JSON,
    manifest,
    { phase: 'postpublish' },
  ).result;
  const release = JSON.parse(run('gh', [
    'api',
    `repos/${manifest.release.repository}/releases/${manifest.release.draftReleaseId}`,
  ]));
  const liveLatestPage = fetchTextWithStatus(`${manifest.origins.public}/latest.json`);
  const liveManifest = JSON.parse(liveLatestPage.body);
  const localLatestPage = readFileSync(new URL('../ocupathif/latest.json', import.meta.url), 'utf8');
  const liveInstallPage = fetchTextWithStatus(`${manifest.origins.public}/install.html`);
  const localInstallPage = readFileSync(new URL('../ocupathif/install.html', import.meta.url), 'utf8');

  let transaction = {};
  const transactionSummaryPath = process.env.OCUPATH_PRODUCTION_TRANSACTION_SUMMARY;
  if (transactionSummaryPath) transaction = JSON.parse(readFileSync(transactionSummaryPath, 'utf8'));

  const state = {
    liveVersion: liveManifest.version,
    expectedVersion: manifest.version,
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
    remoteTagCommitSha: remoteTagCommitSha(manifest.release.tagName),
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
        manifest,
        localPath: macFeedPath,
        liveUrl: urls.macFeed,
        expectedAsset: manifest.assets.macUpdater,
      }),
      win32X64: runtimeFeedState({
        manifest,
        localPath: windowsFeedPath,
        liveUrl: urls.windowsFeed,
        expectedAsset: manifest.assets.windowsInstaller,
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
