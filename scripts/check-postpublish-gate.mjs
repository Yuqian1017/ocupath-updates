#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  evaluatePostpublishGate,
  parseUpdaterMetadata,
} from './postpublish-gate.mjs';

const repository = 'Yuqian1017/ocupath-updates';
const releaseId = '369530281';
const expectedVersion = '0.991.1';
const expectedOldVersion = '0.99.1';
const expectedTagName = 'v0.991.1-c801';
const expectedRuntimeFeedUrl = 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com/darwin-arm64/latest-mac.yml';
const expectedRuntimeFeedSha256 = 'c45f1d96f9a7e031135afaa15ce37e8908d089f6abfa9d70a5e4a3d9ac58ce3b';
const expectedUpdaterUrl = 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com/OcupathIF-0.991.1-arm64-mac.zip';
const expectedUpdaterSha512 = '5U67IW0fWPXo81VnYftMNQ9ogWbTAqXhFzOMc5gydL7Shppb8iQ5Yf/kbKOuRmc6/K5IaenqYpKk79Nb5y2ekw==';
const expectedUpdaterSize = 1313793497;

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

const release = JSON.parse(run('gh', ['api', `repos/${repository}/releases/${releaseId}`]));
const liveManifest = JSON.parse(run('curl', [
  '--fail', '--silent', '--show-error', '--location',
  'https://updates.ocupath.ai/ocupathif/latest.json',
]));
const runtimeFeedResponse = fetchTextWithStatus(expectedRuntimeFeedUrl);
const runtimeFeedBody = runtimeFeedResponse.body;
const runtimeFeedMetadata = parseUpdaterMetadata(runtimeFeedBody);

let transaction = {};
const transactionSummaryPath = process.env.OCUPATH_PRODUCTION_TRANSACTION_SUMMARY;
if (transactionSummaryPath) transaction = JSON.parse(readFileSync(transactionSummaryPath, 'utf8'));

const state = {
  liveVersion: liveManifest.version,
  expectedVersion,
  releaseDraft: release.draft,
  releaseTagName: release.tag_name,
  expectedTagName,
  productionRuntimeFeed: {
    url: expectedRuntimeFeedUrl,
    expectedUrl: expectedRuntimeFeedUrl,
    httpStatus: runtimeFeedResponse.httpStatus,
    sha256: createHash('sha256').update(runtimeFeedBody).digest('hex'),
    expectedSha256: expectedRuntimeFeedSha256,
    version: runtimeFeedMetadata.version,
    path: runtimeFeedMetadata.path,
    expectedPath: expectedUpdaterUrl,
    sha512: runtimeFeedMetadata.sha512,
    expectedSha512: expectedUpdaterSha512,
    size: runtimeFeedMetadata.size,
    expectedSize: expectedUpdaterSize,
  },
  productionOldVersion: transaction.fromVersion ?? expectedOldVersion,
  productionTargetVersion: transaction.toVersion,
  expectedOldVersion,
  productionUpdaterTransaction: transaction.status ?? 'not-run',
  automaticRelaunch: transaction.ui?.automaticRelaunchObserved ?? false,
  unchangedSentinels: transaction.sentinels?.unchangedCount ?? 0,
  expectedSentinels: 7,
  rangeRequestCount: transaction.download?.rangeRequestCount ?? 0,
  fullZipHttp200Count: transaction.download?.fullZipHttp200Count ?? 0,
  macManualDownload: process.env.OCUPATH_MAC_MANUAL_DOWNLOAD ?? 'not-run',
  windowsManualDownload: process.env.OCUPATH_WINDOWS_MANUAL_DOWNLOAD ?? 'not-run',
  chinaMacTransaction: process.env.OCUPATH_CHINA_MAC_TRANSACTION ?? 'not-run',
  chinaWindowsTransaction: process.env.OCUPATH_CHINA_WINDOWS_TRANSACTION ?? 'not-run',
};

const result = evaluatePostpublishGate(state);
process.stdout.write(`${JSON.stringify({ ...result, state }, null, 2)}\n`);
if (result.status !== 'GREEN') process.exitCode = 2;
