import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCosAuthority,
  buildManualCosAuthority,
  cosAuthoritySha256,
} from '../scripts/cos-publication.mjs';
import {
  buildRegionalCosMarker,
  regionalCosMarkerBody,
  regionalCosMarkerSha256,
  validateRegionalCosMarker,
} from '../scripts/regional-cos-marker.mjs';
import { DEFAULT_STAGING_MANIFEST_URL } from '../scripts/release-manifest.mjs';

const staging = JSON.parse(readFileSync(DEFAULT_STAGING_MANIFEST_URL, 'utf8'));
const baseSha = '1'.repeat(40);

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

function authority(manifest = finalManifest()) {
  return buildCosAuthority(manifest, {
    darwinArm64: 'version: 0.995.1\nreleaseDate: 2026-08-18T12:00:00.000Z\n',
  });
}

function liveGate(expected = authority()) {
  return {
    status: 'GREEN',
    failures: [],
    evidence: {
      schemaVersion: 2,
      generatedBy: 'scripts/verify-cos-assets.mjs',
      authoritySha256: cosAuthoritySha256(expected),
      uploadLedgerSha256: 'd'.repeat(64),
      version: expected.version,
      baseUrl: expected.baseUrl,
      sequencing: expected.sequencing,
      uploadCompletedAt: '2026-08-18T12:00:07.000Z',
      verificationCompletedAt: '2026-08-18T12:00:08.000Z',
      objects: expected.objects.map((object) => ({
        ...object,
        verifyStatus: 'PASS',
        fullBytes: object.bytes,
        fullSha256: object.sha256,
      })),
      status: 'PASS',
      failures: [],
    },
  };
}

test('exact marker is generated only from GREEN six-object live evidence', () => {
  const manifest = finalManifest();
  const expected = authority(manifest);
  const gate = liveGate(expected);
  const marker = buildRegionalCosMarker({
    manifest,
    authority: expected,
    liveGate: gate,
    baseReleaseCommitSha: baseSha,
    promotedAt: '2026-08-18T12:00:09.000Z',
  });

  assert.equal(validateRegionalCosMarker({
    marker,
    manifest,
    authority: expected,
    liveGate: gate,
    baseReleaseCommitSha: baseSha,
  }).status, 'GREEN');
  assert.equal(regionalCosMarkerSha256(marker), regionalCosMarkerSha256(JSON.parse(regionalCosMarkerBody(marker))));
  assert.equal(Object.keys(marker.assets).length, 2);
});

test('published manual routes can be rotated from a GREEN two-object manual verifier', () => {
  const manifest = finalManifest();
  const expected = buildManualCosAuthority(manifest);
  const gate = liveGate(expected);
  const marker = buildRegionalCosMarker({
    manifest,
    authority: expected,
    liveGate: gate,
    baseReleaseCommitSha: baseSha,
    promotedAt: '2026-08-18T12:00:09.000Z',
  });

  assert.equal(validateRegionalCosMarker({
    marker,
    manifest,
    authority: expected,
    liveGate: gate,
    baseReleaseCommitSha: baseSha,
  }).status, 'GREEN');
  assert.deepEqual(expected.objects.map((object) => object.key), [
    manifest.assets.macManual.cosKey,
    manifest.assets.windowsInstaller.cosKey,
  ]);
});

test('marker rejects HEAD-only same-size wrong bytes and live evidence drift', () => {
  const manifest = finalManifest();
  const expected = authority(manifest);
  const gate = liveGate(expected);
  const marker = buildRegionalCosMarker({
    manifest,
    authority: expected,
    liveGate: gate,
    baseReleaseCommitSha: baseSha,
    promotedAt: '2026-08-18T12:00:09.000Z',
  });

  const wrongBytes = structuredClone(marker);
  wrongBytes.assets.macManual.sha256 = 'f'.repeat(64);
  assert.match(validateRegionalCosMarker({
    marker: wrongBytes,
    manifest,
    authority: expected,
    liveGate: gate,
    baseReleaseCommitSha: baseSha,
  }).failures.join('\n'), /manual asset mismatch/);

  const drift = structuredClone(gate);
  drift.evidence.objects[0].fullSha256 = 'e'.repeat(64);
  assert.match(validateRegionalCosMarker({
    marker,
    manifest,
    authority: expected,
    liveGate: drift,
    baseReleaseCommitSha: baseSha,
  }).failures.join('\n'), /verifier evidence digest mismatch/);
});

test('marker generation refuses RED or unsupported verifier results', () => {
  const manifest = finalManifest();
  const expected = authority(manifest);
  assert.throws(() => buildRegionalCosMarker({
    manifest,
    authority: expected,
    liveGate: { status: 'RED_STOP_LINE', failures: ['network drift'] },
    baseReleaseCommitSha: baseSha,
    promotedAt: '2026-08-18T12:00:09.000Z',
  }), /GREEN supported live COS verifier/);

  const short = structuredClone(expected);
  short.objects.pop();
  assert.throws(() => buildRegionalCosMarker({
    manifest,
    authority: short,
    liveGate: liveGate(short),
    baseReleaseCommitSha: baseSha,
    promotedAt: '2026-08-18T12:00:09.000Z',
  }), /GREEN supported live COS verifier/);
});
