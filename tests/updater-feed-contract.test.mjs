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
assert.match(bootstrapTargetFeed, /sha512: 6Elg8SONs0xGRJXoeLWPj3xYjmfYlfM0L7gLHGMOjuV6w0hTrQLd6AJyj83aiVhzhRz4Mwft\+MKoSXGL8\/HgKQ==/);
assert.match(bootstrapTargetFeed, /size: 1313800582/);
assert.doesNotMatch(bootstrapTargetFeed, /github\.com|0\.97\.[12]/);

assert.equal(legacyManifest.version, '0.991.1');
assert.equal(legacyManifest.packages['darwin-arm64'].kind, 'manual_page');
assert.equal(legacyManifest.packages['darwin-arm64'].url, installPageUrl);
assert.equal(
  legacyManifest.packages['darwin-arm64'].sha256,
  '146a0d91eb608083b702a8cd7f970da938eff45f29e67c9d8212da02c96e0897',
);
assert.equal(legacyManifest.packages['darwin-arm64'].sizeBytes, 1318754674);
assert.notEqual(
  manualMacCosUrl,
  finalMacCosUrl,
  'manual customer ZIP and updater ZIP have different bytes and must use distinct COS object keys',
);
assert.equal(legacyManifest.packages['win32-x64'].kind, 'manual_page');
assert.equal(legacyManifest.packages['win32-x64'].url, installPageUrl);
assert.equal(
  legacyManifest.packages['win32-x64'].sha256,
  '23c3981ce1b7076040a748c513504595a852c6c7c0e5b0d54499706a7bb0ce2d',
);
assert.equal(legacyManifest.packages['win32-x64'].sizeBytes, 1354649495);

assert.equal(
  existsSync(new URL('../ocupathif/direct/win32-x64/latest.yml', import.meta.url)),
  false,
  'Windows must not expose an in-app direct-update feed',
);

console.log('updater feed contract: PASS');
