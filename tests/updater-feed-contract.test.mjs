import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { loadReleaseManifest, releaseUrls } from '../scripts/release-manifest.mjs';

const macFeedPath = new URL('../ocupathif/direct/darwin-arm64/latest-mac.yml', import.meta.url);
const macFeed = readFileSync(macFeedPath, 'utf8');
const windowsFeedPath = new URL('../ocupathif/direct/win32-x64/latest.yml', import.meta.url);
const windowsFeed = readFileSync(windowsFeedPath, 'utf8');
const bootstrapTargetFeedPath = new URL('../ocupathif/bootstrap-target/darwin-arm64/latest-mac.yml', import.meta.url);
const bootstrapTargetFeed = readFileSync(bootstrapTargetFeedPath, 'utf8');
const manualManifest = JSON.parse(readFileSync(
  new URL('../ocupathif/latest.json', import.meta.url),
  'utf8',
));
const stagingManifest = loadReleaseManifest(undefined, { requireFinal: false });
const urls = releaseUrls(stagingManifest);
const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

assert.match(macFeed, new RegExp(`^version: ${escaped(stagingManifest.version)}$`, 'm'));
assert.match(macFeed, new RegExp(`url: ${escaped(urls.macUpdaterCos)}`));
assert.match(macFeed, new RegExp(`sha512: ${escaped(stagingManifest.assets.macUpdater.sha512)}`));
assert.match(macFeed, new RegExp(`size: ${escaped(stagingManifest.assets.macUpdater.sizeBytes)}`));
assert.doesNotMatch(macFeed, /github\.com|0\.97\.[12]/);

assert.equal(existsSync(windowsFeedPath), true, 'Windows update detection feed must exist');
assert.match(windowsFeed, new RegExp(`^version: ${escaped(stagingManifest.version)}$`, 'm'));
assert.match(windowsFeed, new RegExp(`url: ${escaped(urls.windowsCos)}`));
assert.match(windowsFeed, new RegExp(`sha512: ${escaped(stagingManifest.assets.windowsInstaller.sha512)}`));
assert.match(windowsFeed, new RegExp(`size: ${escaped(stagingManifest.assets.windowsInstaller.sizeBytes)}`));
assert.equal(
  stagingManifest.feeds.win32X64.installMode,
  'manual',
  'Windows feed is detection-only and must hand off to Manual Download',
);

assert.match(bootstrapTargetFeed, /^version: 0\.991\.1$/m);
assert.match(bootstrapTargetFeed, /OcupathIF-0\.991\.1-arm64-mac\.zip/);
assert.match(bootstrapTargetFeed, /sha512: 5U67IW0fWPXo81VnYftMNQ9ogWbTAqXhFzOMc5gydL7Shppb8iQ5Yf\/kbKOuRmc6\/K5IaenqYpKk79Nb5y2ekw==/);
assert.match(bootstrapTargetFeed, /size: 1313793497/);
assert.doesNotMatch(bootstrapTargetFeed, /github\.com|0\.97\.[12]/);

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
assert.match(readme, new RegExp(escaped(urls.macFeed)));
assert.match(readme, /direct\/win32-x64\/latest\.yml/);
assert.match(readme, /installMode=manual/);

assert.equal(manualManifest.version, stagingManifest.version);
assert.equal(
  Object.hasOwn(manualManifest, 'releaseNotes'),
  false,
  'release notes are internal evidence and must not be published in the customer update manifest',
);
assert.equal(manualManifest.packages['darwin-arm64'].kind, 'manual_page');
assert.equal(manualManifest.packages['darwin-arm64'].url, urls.installPage);
assert.equal(manualManifest.packages['darwin-arm64'].sha256, stagingManifest.assets.macManual.sha256);
assert.equal(manualManifest.packages['darwin-arm64'].sizeBytes, stagingManifest.assets.macManual.sizeBytes);
assert.notEqual(
  urls.macManualCos,
  urls.macUpdaterCos,
  'manual customer ZIP and updater ZIP have different bytes and must use distinct COS object keys',
);
assert.equal(manualManifest.packages['win32-x64'].kind, 'manual_page');
assert.equal(manualManifest.packages['win32-x64'].url, urls.installPage);
assert.equal(manualManifest.packages['win32-x64'].sha256, stagingManifest.assets.windowsInstaller.sha256);
assert.equal(manualManifest.packages['win32-x64'].sizeBytes, stagingManifest.assets.windowsInstaller.sizeBytes);

console.log('updater feed contract: PASS');
