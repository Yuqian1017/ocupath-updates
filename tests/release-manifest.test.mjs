import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_STAGING_MANIFEST_URL,
  loadReleaseManifest,
  releaseUrls,
  validateReleaseManifest,
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
  manifest.assets.windowsInstaller.sizeBytes = 103;
  manifest.assets.windowsInstaller.sha256 = 'c'.repeat(64);
  manifest.assets.windowsInstaller.sha512 = Buffer.alloc(64, 2).toString('base64');
  return manifest;
}

test('staging manifest fixes the 0.993.1 names and guides but remains unpublishable', () => {
  const prepared = validateReleaseManifest(staging, { requireFinal: false });
  assert.equal(prepared.status, 'GREEN');
  assert.deepEqual(prepared.pending, [
    'releaseDate',
    'release.draftReleaseId',
    'assets.macManual.sizeBytes',
    'assets.macManual.sha256',
    'assets.macUpdater.sizeBytes',
    'assets.macUpdater.sha256',
    'assets.macUpdater.sha512',
    'assets.macUpdaterBlockmap.sizeBytes',
    'assets.macUpdaterBlockmap.sha256',
    'assets.windowsInstaller.sizeBytes',
    'assets.windowsInstaller.sha256',
    'assets.windowsInstaller.sha512',
  ]);

  const strict = validateReleaseManifest(staging);
  assert.equal(strict.status, 'RED_STOP_LINE');
  assert.match(strict.failures.at(-1), /pending publication fields/);
  assert.throws(() => loadReleaseManifest(), /not publishable/);
});

test('a fully frozen staging manifest passes the strict publication contract', () => {
  assert.deepEqual(validateReleaseManifest(finalManifest()), {
    status: 'GREEN',
    failures: [],
    pending: [],
  });
});

test('manifest derives both packaged-app feed routes and exact release URLs', () => {
  const urls = releaseUrls(staging);
  assert.equal(urls.macFeed, `${staging.origins.public}/direct/darwin-arm64/latest-mac.yml`);
  assert.equal(urls.windowsFeed, `${staging.origins.public}/direct/win32-x64/latest.yml`);
  assert.equal(urls.windowsCos, `${staging.origins.cos}/${staging.assets.windowsInstaller.fileName}`);
  assert.equal(staging.feeds.win32X64.installMode, 'manual');
});

test('prepared public files are reproducibly rendered from the pending manifest', () => {
  const output = execFileSync(process.execPath, [
    rendererPath,
    '--allow-pending',
    '--check',
  ], { encoding: 'utf8' });
  assert.match(output, /checked 4 publication files/);
});

test('renderer and prepublish gate stop before remote work while fields are pending', () => {
  const render = spawnSync(process.execPath, [
    rendererPath,
    '--check',
  ], { encoding: 'utf8' });
  assert.notEqual(render.status, 0);
  assert.match(render.stderr, /pending publication fields/);

  const gate = spawnSync(process.execPath, [
    prepublishPath,
  ], { encoding: 'utf8' });
  assert.equal(gate.status, 2);
  const result = JSON.parse(gate.stdout);
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.equal(result.phase, 'local-publication-inputs');
  assert.match(result.failures[0], /pending publication fields/);

  const postGate = spawnSync(process.execPath, [postpublishPath], { encoding: 'utf8' });
  assert.equal(postGate.status, 2);
  const postResult = JSON.parse(postGate.stdout);
  assert.equal(postResult.status, 'RED_STOP_LINE');
  assert.equal(postResult.phase, 'local-publication-inputs');
  assert.match(postResult.failures[0], /pending publication fields/);
});

test('Windows feed path and manual install mode cannot drift', () => {
  const wrongPath = finalManifest();
  wrongPath.feeds.win32X64.path = 'direct/win32-x64/missing.yml';
  assert.match(validateReleaseManifest(wrongPath).failures.join('\n'), /Windows feed path mismatch/);

  const wrongMode = finalManifest();
  wrongMode.feeds.win32X64.installMode = 'in_app';
  assert.match(validateReleaseManifest(wrongMode).failures.join('\n'), /Windows installMode must be manual/);
});
