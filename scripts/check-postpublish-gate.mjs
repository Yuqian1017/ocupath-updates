#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { evaluatePostpublishGate } from './postpublish-gate.mjs';

const repository = 'Yuqian1017/ocupath-updates';
const releaseId = '369084603';
const expectedVersion = '0.991.1';
const expectedOldVersion = '0.99.1';
const expectedTagName = 'v0.991.1';

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

const release = JSON.parse(run('gh', ['api', `repos/${repository}/releases/${releaseId}`]));
const liveManifest = JSON.parse(run('curl', [
  '--fail', '--silent', '--show-error', '--location',
  'https://updates.ocupath.ai/ocupathif/latest.json',
]));

let transaction = {};
const transactionSummaryPath = process.env.OCUPATH_PRODUCTION_TRANSACTION_SUMMARY;
if (transactionSummaryPath) transaction = JSON.parse(readFileSync(transactionSummaryPath, 'utf8'));

const state = {
  liveVersion: liveManifest.version,
  expectedVersion,
  releaseDraft: release.draft,
  releaseTagName: release.tag_name,
  expectedTagName,
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
