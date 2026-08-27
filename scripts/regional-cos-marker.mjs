import { createHash } from 'node:crypto';

import { cosAuthoritySha256 } from './cos-publication.mjs';
import {
  findPendingFields,
  isCanonicalUtcIso,
  releaseUrls,
  requireExactCommitSha,
} from './release-manifest.mjs';

export const REGIONAL_COS_MARKER_PATH = 'ocupathif/regional-cos/v0.995.1.json';
export const REGIONAL_COS_MARKER_URL_PATH = '/ocupathif/regional-cos/v0.995.1.json';
export const REGIONAL_COS_ORIGIN = 'https://updates.ocupath.ai';
export const REGIONAL_COS_METHODS = ['GET', 'HEAD'];
export const REGIONAL_COS_EXPOSED_HEADERS = ['Content-Length', 'ETag', 'Last-Modified'];

function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function stableVerifierEvidence(evidence) {
  const stable = structuredClone(evidence ?? {});
  delete stable.verificationCompletedAt;
  return stable;
}

export function liveVerifierEvidenceSha256(evidence) {
  return sha256(`${JSON.stringify(stableVerifierEvidence(evidence), null, 2)}\n`);
}

export function regionalCosMarkerBody(marker) {
  return `${JSON.stringify(marker, null, 2)}\n`;
}

export function regionalCosMarkerSha256(marker) {
  return sha256(regionalCosMarkerBody(marker));
}

function liveVerifierFailures(authority, liveGate) {
  const failures = [];
  const evidence = liveGate?.evidence ?? {};
  if (liveGate?.status !== 'GREEN' || evidence.status !== 'PASS') {
    failures.push('live gate did not return GREEN/PASS');
  }
  const isFullRelease = authority?.objects?.length === 6
    && authority?.sequencing === 'payload-first-metadata-last';
  const isManualRotation = authority?.objects?.length === 2
    && authority?.sequencing === 'manual-payloads-only'
    && authority.objects.every((object) => object.phase === 'payload');
  if (
    (!isFullRelease && !isManualRotation)
    || evidence?.objects?.length !== authority?.objects?.length
  ) failures.push('authority or evidence is not an exact full-release or manual-route transaction');
  if (evidence.authoritySha256 !== cosAuthoritySha256(authority)) {
    failures.push('live evidence authority digest mismatch');
  }
  if (!/^[a-f0-9]{64}$/.test(evidence.uploadLedgerSha256 ?? '')) {
    failures.push('live evidence upload ledger digest is invalid');
  }
  if (!isCanonicalUtcIso(evidence.verificationCompletedAt, { allowPending: false })) {
    failures.push('live evidence verification timestamp is invalid');
  }
  authority?.objects?.forEach((expected, index) => {
    const observed = evidence?.objects?.[index];
    if (
      observed?.key !== expected.key
      || observed?.bytes !== expected.bytes
      || observed?.sha256 !== expected.sha256
      || observed?.verifyStatus !== 'PASS'
      || observed?.fullBytes !== expected.bytes
      || observed?.fullSha256 !== expected.sha256
    ) failures.push(`live evidence object mismatch: ${expected.key}`);
  });
  return failures;
}

function expectedAssets(manifest) {
  const urls = releaseUrls(manifest);
  return {
    macManual: {
      key: manifest.assets.macManual.fileName,
      url: urls.macManualCos,
      bytes: manifest.assets.macManual.sizeBytes,
      sha256: manifest.assets.macManual.sha256,
    },
    windowsInstaller: {
      key: manifest.assets.windowsInstaller.fileName,
      url: urls.windowsCos,
      bytes: manifest.assets.windowsInstaller.sizeBytes,
      sha256: manifest.assets.windowsInstaller.sha256,
    },
  };
}

export function buildRegionalCosMarker({
  manifest,
  authority,
  liveGate,
  baseReleaseCommitSha,
  promotedAt,
}) {
  if (findPendingFields(manifest).length > 0) {
    throw new Error('Regional marker cannot be built from a manifest with pending fields');
  }
  const liveFailures = liveVerifierFailures(authority, liveGate);
  if (liveFailures.length > 0) {
    throw new Error(`Regional marker requires a GREEN supported live COS verifier:\n- ${liveFailures.join('\n- ')}`);
  }
  requireExactCommitSha(baseReleaseCommitSha, 'base release commit SHA');
  if (!isCanonicalUtcIso(promotedAt, { allowPending: false })) {
    throw new Error('promotedAt must be canonical UTC ISO');
  }
  if (Date.parse(promotedAt) <= Date.parse(liveGate.evidence.verificationCompletedAt)) {
    throw new Error('promotedAt must follow live verification');
  }
  return {
    schemaVersion: 1,
    version: manifest.version,
    state: 'PROMOTED',
    generatedBy: 'scripts/generate-regional-cos-marker.mjs',
    baseReleaseCommitSha,
    promotedAt,
    verifier: {
      authoritySha256: liveGate.evidence.authoritySha256,
      uploadLedgerSha256: liveGate.evidence.uploadLedgerSha256,
      evidenceSha256: liveVerifierEvidenceSha256(liveGate.evidence),
      verificationCompletedAt: liveGate.evidence.verificationCompletedAt,
    },
    cors: {
      allowedOrigin: REGIONAL_COS_ORIGIN,
      allowedMethods: REGIONAL_COS_METHODS,
      exposedHeaders: REGIONAL_COS_EXPOSED_HEADERS,
    },
    assets: expectedAssets(manifest),
  };
}

export function validateRegionalCosMarker({
  marker,
  manifest,
  authority,
  liveGate,
  baseReleaseCommitSha,
}) {
  const failures = [];
  const verifier = marker?.verifier ?? {};
  const cors = marker?.cors ?? {};
  const assets = marker?.assets ?? {};
  const expected = expectedAssets(manifest);
  const liveFailures = liveVerifierFailures(authority, liveGate);
  if (liveFailures.length > 0) failures.push(`live COS verifier: ${liveFailures.join('; ')}`);
  if (!exactKeys(marker, [
    'schemaVersion', 'version', 'state', 'generatedBy', 'baseReleaseCommitSha',
    'promotedAt', 'verifier', 'cors', 'assets',
  ])) failures.push('marker top-level schema mismatch');
  if (
    marker?.schemaVersion !== 1
    || marker?.version !== manifest.version
    || marker?.state !== 'PROMOTED'
    || marker?.generatedBy !== 'scripts/generate-regional-cos-marker.mjs'
    || marker?.baseReleaseCommitSha !== baseReleaseCommitSha
  ) failures.push('marker release identity mismatch');
  if (findPendingFields(marker).length > 0) failures.push('marker contains pending placeholders');
  if (
    !isCanonicalUtcIso(marker?.promotedAt, { allowPending: false })
    || !isCanonicalUtcIso(verifier.verificationCompletedAt, { allowPending: false })
    || Date.parse(marker.promotedAt) <= Date.parse(verifier.verificationCompletedAt)
  ) failures.push('marker promotion timestamps are invalid');
  if (!exactKeys(verifier, [
    'authoritySha256', 'uploadLedgerSha256', 'evidenceSha256', 'verificationCompletedAt',
  ])) failures.push('marker verifier schema mismatch');
  if (
    verifier.authoritySha256 !== cosAuthoritySha256(authority)
    || verifier.authoritySha256 !== liveGate?.evidence?.authoritySha256
    || verifier.uploadLedgerSha256 !== liveGate?.evidence?.uploadLedgerSha256
    || verifier.evidenceSha256 !== liveVerifierEvidenceSha256(liveGate?.evidence)
  ) failures.push('marker verifier evidence digest mismatch');
  if (
    !exactKeys(cors, ['allowedOrigin', 'allowedMethods', 'exposedHeaders'])
    || cors.allowedOrigin !== REGIONAL_COS_ORIGIN
    || JSON.stringify(cors.allowedMethods) !== JSON.stringify(REGIONAL_COS_METHODS)
    || JSON.stringify(cors.exposedHeaders) !== JSON.stringify(REGIONAL_COS_EXPOSED_HEADERS)
  ) failures.push('marker CORS authority mismatch');
  if (!exactKeys(assets, ['macManual', 'windowsInstaller'])) {
    failures.push('marker asset set mismatch');
  }
  for (const key of ['macManual', 'windowsInstaller']) {
    if (
      !exactKeys(assets[key], ['key', 'url', 'bytes', 'sha256'])
      || JSON.stringify(assets[key]) !== JSON.stringify(expected[key])
    ) failures.push(`marker manual asset mismatch: ${key}`);
  }
  return {
    status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE',
    failures,
    sha256: marker && typeof marker === 'object' ? regionalCosMarkerSha256(marker) : undefined,
  };
}
