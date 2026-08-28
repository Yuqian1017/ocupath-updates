import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_STAGING_MANIFEST_URL,
  isCanonicalUtcIso,
  regionalPromotionTopology,
  loadReleaseManifest,
  requireExactCommitSha,
  releaseUrls,
  validateReleaseManifest,
  validateWebsitePublicationManifest,
} from '../scripts/release-manifest.mjs';

const staging = JSON.parse(readFileSync(DEFAULT_STAGING_MANIFEST_URL, 'utf8'));
const rendererPath = fileURLToPath(new URL('../scripts/render-release.mjs', import.meta.url));
const prepublishPath = fileURLToPath(new URL('../scripts/check-prepublish-gate.mjs', import.meta.url));
const postpublishPath = fileURLToPath(new URL('../scripts/check-postpublish-gate.mjs', import.meta.url));

function finalManifest() {
  const manifest = structuredClone(staging);
  manifest.releaseDate = '2026-08-18T12:00:00.000Z';
  manifest.release.draftReleaseId = '123456789';
  manifest.assets.macManual.sizeBytes = 101;
  manifest.assets.macManual.sha256 = 'a'.repeat(64);
  manifest.assets.macUpdater.sizeBytes = 102;
  manifest.assets.macUpdater.sha256 = 'b'.repeat(64);
  manifest.assets.macUpdater.sha512 = Buffer.alloc(64, 1).toString('base64');
  manifest.assets.macUpdaterBlockmap.sizeBytes = 104;
  manifest.assets.macUpdaterBlockmap.sha256 = 'd'.repeat(64);
  return manifest;
}

test('staging manifest freezes the final 0.995.1 packages and guides', () => {
  assert.deepEqual(validateReleaseManifest(staging), {
    status: 'GREEN',
    failures: [],
    pending: [],
  });
  assert.equal(loadReleaseManifest().version, '0.995.1');
});

test('a fully frozen staging manifest passes the strict publication contract', () => {
  assert.deepEqual(validateReleaseManifest(finalManifest()), {
    status: 'GREEN',
    failures: [],
    pending: [],
  });
});

test('Mac manual distribution requires DMG while direct update retains ZIP', () => {
  const manifest = finalManifest();
  manifest.assets.macManual.fileName = `OcupathIF-${manifest.version}-arm64-mac.dmg`;
  assert.deepEqual(validateReleaseManifest(manifest), {
    status: 'GREEN',
    failures: [],
    pending: [],
  });
  assert.match(manifest.assets.macUpdater.fileName, /\.zip$/);

  manifest.assets.macManual.fileName = `OcupathIF-${manifest.version}-arm64-mac-standalone.zip`;
  assert.match(validateReleaseManifest(manifest).failures.join('\n'), /macManual\.fileName/);
});

test('manifest derives both packaged-app feed routes and exact release URLs', () => {
  const urls = releaseUrls(staging);
  assert.equal(urls.macFeed, `${staging.origins.public}/direct/darwin-arm64/latest-mac.yml`);
  assert.equal(urls.windowsFeed, `${staging.origins.public}/direct/win32-x64/latest.yml`);
  assert.equal(urls.windowsCos, `${staging.origins.cos}/${staging.assets.windowsInstaller.fileName}`);
  assert.equal(staging.feeds.win32X64.installMode, 'manual');
});

test('same-version replacement uses an immutable revision tag and isolated COS keys', () => {
  const manifest = finalManifest();
  manifest.release.tagName = `v${manifest.version}-r2`;
  for (const key of ['macManual', 'windowsInstaller', 'macUpdater', 'macUpdaterBlockmap']) {
    manifest.assets[key].cosKey = `revisions/${manifest.release.tagName}/${manifest.assets[key].fileName}`;
  }

  assert.equal(validateReleaseManifest(manifest).status, 'GREEN');
  const urls = releaseUrls(manifest);
  assert.equal(
    urls.macManualGlobal,
    `https://github.com/${manifest.release.repository}/releases/download/${manifest.release.tagName}/${manifest.assets.macManual.fileName}`,
  );
  assert.equal(
    urls.macManualCos,
    `${manifest.origins.cos}/${manifest.assets.macManual.cosKey}`,
  );
  assert.equal(
    urls.macUpdaterCos,
    `${manifest.origins.cos}/${manifest.assets.macUpdater.cosKey}`,
  );

  delete manifest.assets.macManual.cosKey;
  assert.match(
    validateReleaseManifest(manifest).failures.join('\n'),
    /same-version replacement requires assets\.macManual\.cosKey/,
  );
});

test('replacement revision tags are monotonic and initial releases cannot alias revision keys', () => {
  const badRevision = finalManifest();
  badRevision.release.tagName = `v${badRevision.version}-r1`;
  assert.match(validateReleaseManifest(badRevision).failures.join('\n'), /release\.tagName/);

  const initialWithRevisionKey = finalManifest();
  initialWithRevisionKey.assets.macManual.cosKey = `revisions/v${initialWithRevisionKey.version}-r2/${initialWithRevisionKey.assets.macManual.fileName}`;
  assert.match(
    validateReleaseManifest(initialWithRevisionKey).failures.join('\n'),
    /initial release must not define assets\.macManual\.cosKey/,
  );
});

test('regional promotion topology distinguishes initial publication from replacement rotation', () => {
  assert.deepEqual(regionalPromotionTopology(finalManifest()), {
    markerPresentAtBase: false,
    markerDiffStatus: 'A',
  });
  const replacement = finalManifest();
  replacement.release.tagName = `v${replacement.version}-r2`;
  assert.deepEqual(regionalPromotionTopology(replacement), {
    markerPresentAtBase: true,
    markerDiffStatus: 'M',
  });
});

test('prepared public files are reproducibly rendered from the pending manifest', () => {
  const output = execFileSync(process.execPath, [
    rendererPath,
    '--allow-pending',
    '--check',
  ], { encoding: 'utf8' });
  assert.match(output, /checked 6 publication files/);
});

test('renderer accepts final bytes and gates still require an external immutable target', () => {
  const render = spawnSync(process.execPath, [
    rendererPath,
    '--check',
  ], { encoding: 'utf8' });
  assert.equal(render.status, 0);
  assert.match(render.stdout, /checked 6 publication files/);

  const gate = spawnSync(process.execPath, [
    prepublishPath,
  ], { encoding: 'utf8' });
  assert.equal(gate.status, 2);
  const result = JSON.parse(gate.stdout);
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.equal(result.phase, 'local-publication-inputs');
  assert.match(result.failures[0], /OCUPATH_RELEASE_TARGET_SHA/);

  const postGate = spawnSync(process.execPath, [postpublishPath], { encoding: 'utf8' });
  assert.equal(postGate.status, 2);
  const postResult = JSON.parse(postGate.stdout);
  assert.equal(postResult.status, 'RED_STOP_LINE');
  assert.equal(postResult.phase, 'local-publication-inputs');
  assert.match(postResult.failures[0], /OCUPATH_RELEASE_TARGET_SHA/);
});

test('Windows feed path and manual install mode cannot drift', () => {
  const wrongPath = finalManifest();
  wrongPath.feeds.win32X64.path = 'direct/win32-x64/missing.yml';
  assert.match(validateReleaseManifest(wrongPath).failures.join('\n'), /Windows feed path mismatch/);

  const wrongMode = finalManifest();
  wrongMode.feeds.win32X64.installMode = 'in_app';
  assert.match(validateReleaseManifest(wrongMode).failures.join('\n'), /Windows installMode must be manual/);
});

test('release target is external exact SHA input and cannot be stored as a mutable ref', () => {
  const sha = '1'.repeat(40);
  assert.equal(requireExactCommitSha(sha, 'target'), sha);
  assert.throws(() => requireExactCommitSha('main', 'target'), /exact 40-char lowercase SHA/);
  assert.throws(() => requireExactCommitSha('A'.repeat(40), 'target'), /exact 40-char lowercase SHA/);

  const selfReferential = finalManifest();
  selfReferential.release.targetCommitish = 'v0.995.1';
  assert.match(
    validateReleaseManifest(selfReferential).failures.join('\n'),
    /targetCommitish must not be stored/,
  );
});

test('publication branch is explicit runtime input, never inferred from a mutable draft target', async () => {
  const { requirePublicationBranch } = await import('../scripts/release-manifest.mjs');
  assert.equal(
    requirePublicationBranch('release/09931-production-publish-20260818'),
    'release/09931-production-publish-20260818',
  );
  assert.throws(() => requirePublicationBranch('main'), /explicit release/);
});

test('SHA-512 and releaseDate accept only canonical publication encodings', () => {
  const nonCanonicalSha = finalManifest();
  nonCanonicalSha.assets.macUpdater.sha512 = nonCanonicalSha.assets.macUpdater.sha512.replace(/==$/, '=');
  assert.match(validateReleaseManifest(nonCanonicalSha).failures.join('\n'), /macUpdater.sha512 is invalid/);

  for (const value of [
    '2026-08-18T12:00:00Z',
    '2026-08-18T07:00:00.000-05:00',
    '2026-02-30T12:00:00.000Z',
  ]) {
    const wrongDate = finalManifest();
    wrongDate.releaseDate = value;
    assert.match(validateReleaseManifest(wrongDate).failures.join('\n'), /canonical UTC ISO/);
    assert.equal(isCanonicalUtcIso(value), false);
  }
});

test('publication object sets are exact and payload-first', () => {
  const extraAsset = finalManifest();
  extraAsset.publication.githubAssetKeys.push('macUpdater');
  assert.match(validateReleaseManifest(extraAsset).failures.join('\n'), /exact four release assets/);

  const wrongOrder = finalManifest();
  [wrongOrder.publication.cosObjects[0], wrongOrder.publication.cosObjects[4]] = [
    wrongOrder.publication.cosObjects[4],
    wrongOrder.publication.cosObjects[0],
  ];
  assert.match(validateReleaseManifest(wrongOrder).failures.join('\n'), /exact six payload-first/);
});

test('website publication can proceed with manual packages while updater artifacts remain pending', () => {
  const website = structuredClone(staging);
  website.assets.macUpdater.sizeBytes = '__PENDING_MAC_UPDATER_SIZE_BYTES__';
  website.assets.macUpdater.sha256 = '__PENDING_MAC_UPDATER_SHA256__';
  website.assets.macUpdater.sha512 = '__PENDING_MAC_UPDATER_SHA512__';
  website.assets.macUpdaterBlockmap.sizeBytes = '__PENDING_MAC_UPDATER_BLOCKMAP_SIZE_BYTES__';
  website.assets.macUpdaterBlockmap.sha256 = '__PENDING_MAC_UPDATER_BLOCKMAP_SHA256__';
  assert.deepEqual(validateWebsitePublicationManifest(website), {
    status: 'GREEN',
    failures: [],
    pending: [],
  });
  assert.equal(validateReleaseManifest(website).status, 'RED_STOP_LINE');
  assert.match(validateReleaseManifest(website).failures.join('\n'), /macUpdater/);
});
