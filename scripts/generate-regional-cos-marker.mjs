#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLiveCosGate } from './live-cos-gate.mjs';
import { buildCosAuthority } from './cos-publication.mjs';
import {
  buildRegionalCosMarker,
  REGIONAL_COS_MARKER_PATH,
  regionalCosMarkerBody,
  regionalCosMarkerSha256,
  validateRegionalCosMarker,
} from './regional-cos-marker.mjs';
import {
  DEFAULT_STAGING_MANIFEST_URL,
  loadReleaseManifest,
  requireExactCommitSha,
} from './release-manifest.mjs';

const uploadLedgerPath = process.argv[2];
const baseReleaseCommitSha = requireExactCommitSha(process.argv[3], 'base release commit SHA');
if (!uploadLedgerPath) {
  throw new Error('Usage: generate-regional-cos-marker.mjs <COS_UPLOAD_LEDGER.json> <BASE_RELEASE_SHA>');
}

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const authorityPath = fileURLToPath(new URL('../release-manifests/v0.993.1-cos-authority.json', import.meta.url));
const markerPath = resolve(repoRoot, REGIONAL_COS_MARKER_PATH);
const runGit = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const localHead = runGit(['rev-parse', 'HEAD']);
if (localHead !== baseReleaseCommitSha) {
  throw new Error(`Regional marker must be generated at the exact base release commit: ${localHead}`);
}
if (runGit(['status', '--porcelain']) !== '') {
  throw new Error('Regional marker generation requires a clean base release worktree');
}
if (existsSync(markerPath)) throw new Error(`Regional marker already exists: ${REGIONAL_COS_MARKER_PATH}`);
try {
  runGit(['cat-file', '-e', `${baseReleaseCommitSha}:${REGIONAL_COS_MARKER_PATH}`]);
  throw new Error('Base release commit must not contain the regional marker');
} catch (error) {
  if (error instanceof Error && error.message === 'Base release commit must not contain the regional marker') throw error;
}

const manifestSource = process.env.OCUPATH_RELEASE_STAGING_MANIFEST || DEFAULT_STAGING_MANIFEST_URL;
const manifest = loadReleaseManifest(manifestSource);
const authority = JSON.parse(readFileSync(authorityPath, 'utf8'));
const expectedAuthority = buildCosAuthority(manifest, {
  darwinArm64: readFileSync(new URL('../ocupathif/direct/darwin-arm64/latest-mac.yml', import.meta.url), 'utf8'),
});
if (JSON.stringify(authority) !== JSON.stringify(expectedAuthority)) {
  throw new Error('Frozen six-object COS authority is stale against the final manifest and rendered feed');
}
const liveGate = await runLiveCosGate(authorityPath, uploadLedgerPath);
if (liveGate.status !== 'GREEN') {
  throw new Error(`Regional marker generation stopped by live COS verifier:\n- ${liveGate.failures.join('\n- ')}`);
}
const verifiedAt = Date.parse(liveGate.evidence.verificationCompletedAt);
const promotedAt = new Date(Math.max(Date.now(), verifiedAt + 1)).toISOString();
const marker = buildRegionalCosMarker({
  manifest,
  authority,
  liveGate,
  baseReleaseCommitSha,
  promotedAt,
});
const validation = validateRegionalCosMarker({
  marker,
  manifest,
  authority,
  liveGate,
  baseReleaseCommitSha,
});
if (validation.status !== 'GREEN') {
  throw new Error(`Generated regional marker is invalid:\n- ${validation.failures.join('\n- ')}`);
}
mkdirSync(dirname(markerPath), { recursive: true });
writeFileSync(markerPath, regionalCosMarkerBody(marker), { flag: 'wx' });
process.stdout.write(`${JSON.stringify({
  status: 'GREEN',
  markerPath: REGIONAL_COS_MARKER_PATH,
  markerSha256: regionalCosMarkerSha256(marker),
  baseReleaseCommitSha,
  verificationCompletedAt: liveGate.evidence.verificationCompletedAt,
  promotedAt,
}, null, 2)}\n`);
