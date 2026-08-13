import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const macFeedPath = new URL('../ocupathif/direct/darwin-arm64/latest-mac.yml', import.meta.url);
const macFeed = readFileSync(macFeedPath, 'utf8');
const bootstrapTargetFeedPath = new URL('../ocupathif/bootstrap-target/darwin-arm64/latest-mac.yml', import.meta.url);
const bootstrapTargetFeed = readFileSync(bootstrapTargetFeedPath, 'utf8');
const legacyManifest = JSON.parse(readFileSync(
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

assert.equal(legacyManifest.version, '0.991.1');
assert.equal(
  Object.hasOwn(legacyManifest, 'releaseNotes'),
  false,
  'release notes are internal evidence and must not be published in the customer update manifest',
);
assert.equal(legacyManifest.packages['darwin-arm64'].kind, 'manual_page');
assert.equal(legacyManifest.packages['darwin-arm64'].url, installPageUrl);
assert.equal(
  legacyManifest.packages['darwin-arm64'].sha256,
  'c18c0d29158f8c24ea8e7861dba52100581dde5e10af3600a8d5127452364009',
);
assert.equal(legacyManifest.packages['darwin-arm64'].sizeBytes, 1318746948);
assert.notEqual(
  manualMacCosUrl,
  finalMacCosUrl,
  'manual customer ZIP and updater ZIP have different bytes and must use distinct COS object keys',
);
assert.equal(legacyManifest.packages['win32-x64'].kind, 'manual_page');
assert.equal(legacyManifest.packages['win32-x64'].url, installPageUrl);
assert.equal(
  legacyManifest.packages['win32-x64'].sha256,
  '3db8fcd6deabbc55e2b37c6e086234bf448d536392703e5700e83ca4803091ac',
);
assert.equal(legacyManifest.packages['win32-x64'].sizeBytes, 1354650736);

assert.equal(
  existsSync(new URL('../ocupathif/direct/win32-x64/latest.yml', import.meta.url)),
  false,
  'Windows must not expose an in-app direct-update feed',
);

console.log('updater feed contract: PASS');
