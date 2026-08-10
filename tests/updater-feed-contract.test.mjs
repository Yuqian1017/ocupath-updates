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
const bridgeCosUrl = `${cosBaseUrl}/OcupathIF-0.99.0-bootstrap-arm64-mac.zip`;
const finalMacCosUrl = `${cosBaseUrl}/OcupathIF-0.99.1-arm64-mac.zip`;

assert.match(macFeed, /^version: 0\.99\.0$/m);
assert.match(macFeed, new RegExp(`url: ${bridgeCosUrl.replaceAll('.', '\\.').replaceAll('/', '\/')}`));
assert.match(macFeed, /sha512: 0StMXKsEdK5SWUaV38rxDwCFXZrTVZBYoYyePwERD2PMLAbiCe\+S\+KrJwIuB5pevv0w0F1jAcXeJc9ZAsUcGtA==/);
assert.match(macFeed, /size: 480936428/);
assert.doesNotMatch(macFeed, /github\.com|0\.97\.[12]/);

assert.match(bootstrapTargetFeed, /^version: 0\.99\.1$/m);
assert.match(bootstrapTargetFeed, new RegExp(`url: ${finalMacCosUrl.replaceAll('.', '\\.').replaceAll('/', '\/')}`));
assert.match(bootstrapTargetFeed, /sha512: qHPD95CNPfUoBo\/O1Lk\+nekqvc3zMdCAt6LBvLY9ARbad0IPYSD7OQMws5YXlc0l20JPOQ82KnwR1PKYfYYoxQ==/);
assert.match(bootstrapTargetFeed, /size: 1314515661/);
assert.doesNotMatch(bootstrapTargetFeed, /github\.com|0\.97\.[12]/);

assert.equal(legacyManifest.version, '0.99.1');
assert.equal(legacyManifest.packages['darwin-arm64'].kind, 'manual_page');
assert.equal(legacyManifest.packages['darwin-arm64'].url, installPageUrl);
assert.equal(
  legacyManifest.packages['darwin-arm64'].sha256,
  '03d44c0f28471187a47710116db4dcaf2561b38b5df3380566486767afa81dec',
);
assert.equal(legacyManifest.packages['darwin-arm64'].sizeBytes, 1314515661);
assert.equal(legacyManifest.packages['win32-x64'].kind, 'manual_page');
assert.equal(legacyManifest.packages['win32-x64'].url, installPageUrl);
assert.equal(
  legacyManifest.packages['win32-x64'].sha256,
  'f62a863a8eb75f94f13e4cf7a4cb96d52299ce3793013f41854fb950916cfa21',
);
assert.equal(legacyManifest.packages['win32-x64'].sizeBytes, 1354645375);

assert.equal(
  existsSync(new URL('../ocupathif/direct/win32-x64/latest.yml', import.meta.url)),
  false,
  'Windows must not expose an in-app direct-update feed',
);

console.log('updater feed contract: PASS');
