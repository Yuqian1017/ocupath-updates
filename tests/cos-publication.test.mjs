import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCosAuthority,
  validateCosEvidence,
} from '../scripts/cos-publication.mjs';
import { DEFAULT_STAGING_MANIFEST_URL } from '../scripts/release-manifest.mjs';

const staging = JSON.parse(readFileSync(DEFAULT_STAGING_MANIFEST_URL, 'utf8'));

function finalManifest() {
  const manifest = structuredClone(staging);
  manifest.releaseDate = '2026-08-18T12:00:00.000Z';
  manifest.release.draftReleaseId = '123456789';
  manifest.assets.macManual.sizeBytes = 101;
  manifest.assets.macManual.sha256 = 'a'.repeat(64);
  manifest.assets.macUpdater.sizeBytes = 102;
  manifest.assets.macUpdater.sha256 = 'b'.repeat(64);
  manifest.assets.macUpdater.sha512 = Buffer.alloc(64, 1).toString('base64');
  manifest.assets.macUpdaterBlockmap.sizeBytes = 103;
  manifest.assets.macUpdaterBlockmap.sha256 = 'c'.repeat(64);
  return manifest;
}

function authority() {
  return buildCosAuthority(finalManifest(), {
    darwinArm64: 'version: 0.993.1\nreleaseDate: 2026-08-18T12:00:00.000Z\n',
  });
}

function evidence(expected = authority()) {
  return {
    schemaVersion: 1,
    version: expected.version,
    baseUrl: expected.baseUrl,
    sequencing: expected.sequencing,
    objects: expected.objects.map((object, index) => ({
      ...object,
      uploadStatus: 'PASS',
      verifyStatus: 'PASS',
      uploadedAt: `2026-08-18T12:00:0${index + 1}.000Z`,
    })),
    promotionCompletedAt: '2026-08-18T12:00:07.000Z',
  };
}

test('COS authority is the exact six-object payload-first metadata-last contract', () => {
  const expected = authority();
  assert.deepEqual(expected.objects.map(({ order, phase, key }) => ({ order, phase, key })), [
    { order: 1, phase: 'payload', key: 'OcupathIF-0.993.1-arm64-mac-standalone.zip' },
    { order: 2, phase: 'payload', key: 'OcupathIF-Setup-0.993.1-x64.exe' },
    { order: 3, phase: 'payload', key: 'OcupathIF-0.993.1-arm64-mac.zip' },
    { order: 4, phase: 'payload', key: 'OcupathIF-0.993.1-arm64-mac.zip.blockmap' },
    { order: 5, phase: 'metadata', key: 'latest-mac.yml' },
    { order: 6, phase: 'metadata', key: 'darwin-arm64/latest-mac.yml' },
  ]);
  assert.deepEqual(expected.objects[4], {
    ...expected.objects[5],
    order: 5,
    key: 'latest-mac.yml',
  });
  assert.deepEqual(validateCosEvidence(expected, evidence(expected)), {
    status: 'GREEN',
    failures: [],
    objectCount: 6,
  });
});

test('COS evidence rejects extras, byte drift and reordered or simultaneous uploads', () => {
  const expected = authority();

  const extra = evidence(expected);
  extra.objects.push({ ...extra.objects.at(-1), key: 'unexpected' });
  assert.match(validateCosEvidence(expected, extra).failures.join('\n'), /object count mismatch/);

  const drift = evidence(expected);
  drift.objects[1].sha256 = 'f'.repeat(64);
  assert.match(validateCosEvidence(expected, drift).failures.join('\n'), /object 2 sha256 mismatch/);

  const sameTime = evidence(expected);
  sameTime.objects[4].uploadedAt = sameTime.objects[3].uploadedAt;
  assert.match(validateCosEvidence(expected, sameTime).failures.join('\n'), /not strictly increasing/);

  const earlyCompletion = evidence(expected);
  earlyCompletion.promotionCompletedAt = earlyCompletion.objects.at(-1).uploadedAt;
  assert.match(validateCosEvidence(expected, earlyCompletion).failures.join('\n'), /must follow all six/);
});

test('COS evidence rejects pending values and noncanonical timestamps', () => {
  const expected = authority();
  const pending = evidence(expected);
  pending.objects[0].verifyStatus = '__PENDING_VERIFY__';
  assert.match(validateCosEvidence(expected, pending).failures.join('\n'), /pending placeholders/);

  const noncanonical = evidence(expected);
  noncanonical.objects[0].uploadedAt = '2026-08-18T12:00:01Z';
  assert.match(validateCosEvidence(expected, noncanonical).failures.join('\n'), /not canonical UTC ISO/);
});
