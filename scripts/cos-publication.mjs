import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { findPendingFields, isCanonicalUtcIso } from './release-manifest.mjs';

function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

export function buildCosAuthority(manifest, feedBodies) {
  const objects = manifest.publication.cosObjects.map((spec) => {
    if (spec.phase === 'payload') {
      const asset = manifest.assets[spec.assetKey];
      return {
        order: spec.order,
        phase: spec.phase,
        key: asset.fileName,
        bytes: asset.sizeBytes,
        sha256: asset.sha256,
      };
    }
    const body = feedBodies[spec.feedKey];
    if (typeof body !== 'string') throw new Error(`Missing rendered feed body: ${spec.feedKey}`);
    return {
      order: spec.order,
      phase: spec.phase,
      key: spec.key,
      bytes: Buffer.byteLength(body),
      sha256: sha256(body),
    };
  });
  return {
    schemaVersion: 1,
    version: manifest.version,
    baseUrl: manifest.origins.cos,
    sequencing: 'payload-first-metadata-last',
    objects,
  };
}

export function loadCosEvidence(path) {
  if (!path) throw new Error('OCUPATH_COS_EVIDENCE_JSON is required');
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function validateCosEvidence(authority, evidence) {
  const failures = [];
  if (evidence?.schemaVersion !== 1) failures.push('COS evidence schemaVersion must be 1');
  if (evidence?.version !== authority.version) failures.push('COS evidence version mismatch');
  if (evidence?.baseUrl !== authority.baseUrl) failures.push('COS evidence baseUrl mismatch');
  if (authority?.sequencing !== 'payload-first-metadata-last') failures.push('COS authority sequencing mismatch');
  if (evidence?.sequencing !== authority.sequencing) failures.push('COS evidence sequencing mismatch');
  if (findPendingFields(evidence).length > 0) failures.push('COS evidence contains pending placeholders');

  const actual = evidence?.objects ?? [];
  if (actual.length !== authority.objects.length) {
    failures.push(`COS evidence object count mismatch: ${actual.length}/${authority.objects.length}`);
  }
  let priorTime = -Infinity;
  authority.objects.forEach((expected, index) => {
    const observed = actual[index];
    if (!observed) return;
    for (const key of ['order', 'phase', 'key', 'bytes', 'sha256']) {
      if (observed[key] !== expected[key]) {
        failures.push(`COS object ${index + 1} ${key} mismatch`);
      }
    }
    if (observed.uploadStatus !== 'PASS' || observed.verifyStatus !== 'PASS') {
      failures.push(`COS object ${expected.key} is not uploaded and verified`);
    }
    if (!isCanonicalUtcIso(observed.uploadedAt, { allowPending: false })) {
      failures.push(`COS object ${expected.key} uploadedAt is not canonical UTC ISO`);
    } else {
      const time = Date.parse(observed.uploadedAt);
      if (time <= priorTime) failures.push(`COS upload order is not strictly increasing at ${expected.key}`);
      priorTime = time;
    }
    if (expected.phase === 'metadata' && index < 4) {
      failures.push(`COS metadata object ${expected.key} was not sequenced after all payloads`);
    }
  });
  if (!isCanonicalUtcIso(evidence?.promotionCompletedAt, { allowPending: false })) {
    failures.push('COS promotionCompletedAt is not canonical UTC ISO');
  } else if (Date.parse(evidence.promotionCompletedAt) <= priorTime) {
    failures.push('COS promotionCompletedAt must follow all six uploads');
  }

  return {
    status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE',
    failures,
    objectCount: actual.length,
  };
}
