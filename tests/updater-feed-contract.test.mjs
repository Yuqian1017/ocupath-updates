import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const macFeedPath = new URL('../ocupathif/direct/darwin-arm64/latest-mac.yml', import.meta.url);
const macFeed = readFileSync(macFeedPath, 'utf8');
const bootstrapTargetFeedPath = new URL('../ocupathif/bootstrap-target/darwin-arm64/latest-mac.yml', import.meta.url);
const bootstrapTargetFeed = readFileSync(bootstrapTargetFeedPath, 'utf8');
const manualManifest = JSON.parse(readFileSync(
  new URL('../ocupathif/latest.json', import.meta.url),
  'utf8',
));

const installPageUrl = 'https://updates.ocupath.ai/ocupathif/install.html';
const cosBaseUrl = 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com';
const productionRuntimeFeedUrl = `${cosBaseUrl}/darwin-arm64/latest-mac.yml`;
const bridgeCosUrl = `${cosBaseUrl}/OcupathIF-0.991.0-bootstrap-arm64-mac.zip`;
const finalMacCosUrl = `${cosBaseUrl}/OcupathIF-0.991.1-arm64-mac.zip`;
const manualMacCosUrl = `${cosBaseUrl}/OcupathIF-0.991.1-arm64-mac-standalone.zip`;

assert.match(macFeed, /^version: 0\.991\.0$/m);
assert.match(macFeed, new RegExp(`url: ${bridgeCosUrl.replaceAll('.', '\\.').replaceAll('/', '\/')}`));
assert.match(macFeed, /sha512: OeHHud6lb9ylVEskqee3lWlVNOkXsixough6CQ4XWOjJYQXiW6h35C\/f\+mnIYqUZCA8C9sLd\+GXLo7EDmkZH8A==/);
assert.match(macFeed, /size: 480207063/);
assert.doesNotMatch(macFeed, /github\.com|0\.97\.[12]/);

assert.match(bootstrapTargetFeed, /^version: 0\.991\.1$/m);
assert.match(bootstrapTargetFeed, new RegExp(`url: ${finalMacCosUrl.replaceAll('.', '\\.').replaceAll('/', '\/')}`));
assert.match(bootstrapTargetFeed, /sha512: 5U67IW0fWPXo81VnYftMNQ9ogWbTAqXhFzOMc5gydL7Shppb8iQ5Yf\/kbKOuRmc6\/K5IaenqYpKk79Nb5y2ekw==/);
assert.match(bootstrapTargetFeed, /size: 1313793497/);
assert.doesNotMatch(bootstrapTargetFeed, /github\.com|0\.97\.[12]/);

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
assert.match(
  readme,
  new RegExp(productionRuntimeFeedUrl.replaceAll('.', '\\.').replaceAll('/', '\/')),
  'release operations must record the COS runtime metadata route derived by the packaged updater',
);

assert.equal(manualManifest.version, '0.992.1');
assert.equal(
  Object.hasOwn(manualManifest, 'releaseNotes'),
  false,
  'release notes are internal evidence and must not be published in the customer update manifest',
);
assert.equal(manualManifest.packages['darwin-arm64'].kind, 'manual_page');
assert.equal(manualManifest.packages['darwin-arm64'].url, installPageUrl);
assert.equal(
  manualManifest.packages['darwin-arm64'].sha256,
  '30361e88cb424b0fdb3a263a8743034c76662c0ab9ed939195ef9c846adc1f9d',
);
assert.equal(manualManifest.packages['darwin-arm64'].sizeBytes, 1318754214);
assert.notEqual(
  manualMacCosUrl,
  finalMacCosUrl,
  'manual customer ZIP and updater ZIP have different bytes and must use distinct COS object keys',
);
assert.equal(manualManifest.packages['win32-x64'].kind, 'manual_page');
assert.equal(manualManifest.packages['win32-x64'].url, installPageUrl);
assert.equal(
  manualManifest.packages['win32-x64'].sha256,
  '385a35a12225d44dc5361c20f21ea43b109b908a08e5b4cdfded4d32e9391193',
);
assert.equal(manualManifest.packages['win32-x64'].sizeBytes, 1354655261);

assert.equal(
  existsSync(new URL('../ocupathif/direct/win32-x64/latest.yml', import.meta.url)),
  false,
  'Windows must not expose an in-app direct-update feed',
);

console.log('updater feed contract: PASS');
