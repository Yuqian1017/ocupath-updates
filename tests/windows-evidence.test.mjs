import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DEFAULT_STAGING_MANIFEST_URL,
} from '../scripts/release-manifest.mjs';
import {
  DEFAULT_WINDOWS_EVIDENCE_URL,
  validateWindowsEvidence,
} from '../scripts/windows-evidence.mjs';

const manifest = JSON.parse(readFileSync(DEFAULT_STAGING_MANIFEST_URL, 'utf8'));
const frozen = JSON.parse(readFileSync(DEFAULT_WINDOWS_EVIDENCE_URL, 'utf8'));

function postEvidence() {
  const evidence = structuredClone(frozen);
  evidence.postPublication.liveFeedStatus = 'PASS';
  evidence.postPublication.manualPageStatus = 'PASS';
  evidence.postPublication.exactInstallerBytesStatus = 'PASS';
  evidence.postPublication.evidenceRef = 'release-evidence/windows-postpublication.json';
  return evidence;
}

test('frozen Windows evidence binds controller and fixed-SHA CI to the exact final EXE', () => {
  assert.deepEqual(validateWindowsEvidence(frozen, manifest, { phase: 'prepublish' }), {
    status: 'GREEN',
    failures: [],
    proofLabel: 'controller-and-fixed-sha-ci-only',
    nativeExact: false,
  });
  assert.equal(frozen.target.installerSizeBytes, 1354683792);
  assert.equal(frozen.target.installerSha256, '58e48850399c377457819b5294539b9fdea0164da13d4ee0a1cc2cb030cabeeb');
  assert.equal(frozen.fixedShaCi.authenticodeStatus, 'SKIPPED_NATIVE_NOT_AUTHORIZED');
});

test('postpublish requires durable live feed, manual page and exact installer byte evidence', () => {
  const pending = validateWindowsEvidence(frozen, manifest, { phase: 'postpublish' });
  assert.equal(pending.status, 'RED_STOP_LINE');
  assert.match(pending.failures.join('\n'), /pending placeholders/);

  assert.equal(validateWindowsEvidence(postEvidence(), manifest, { phase: 'postpublish' }).status, 'GREEN');
});

test('Windows evidence cannot imply an unauthorized native or automatic install observation', () => {
  const native = structuredClone(frozen);
  native.nativeExact = true;
  assert.match(validateWindowsEvidence(native, manifest).failures.join('\n'), /nativeExact must remain false/);

  const automatic = structuredClone(frozen);
  automatic.updateReachability.automaticInstallObservation = {
    mode: 'native-exact',
    observed: true,
  };
  assert.match(validateWindowsEvidence(automatic, manifest).failures.join('\n'), /automated-controller-only/);
});

test('Windows evidence rejects source, target, commit or CI provenance drift', () => {
  const source = structuredClone(frozen);
  source.source.version = '0.991.1';
  assert.match(validateWindowsEvidence(source, manifest).failures.join('\n'), /source package identity mismatch/);

  const target = structuredClone(frozen);
  target.target.installerSha256 = 'f'.repeat(64);
  assert.match(validateWindowsEvidence(target, manifest).failures.join('\n'), /target package identity mismatch/);

  const controller = structuredClone(frozen);
  controller.controllerTests.productSourceCommitSha = '2'.repeat(40);
  assert.match(validateWindowsEvidence(controller, manifest).failures.join('\n'), /controller evidence/);

  const behavior = structuredClone(frozen);
  behavior.controllerTests.productBehaviorCommitSha = '3'.repeat(40);
  assert.match(validateWindowsEvidence(behavior, manifest).failures.join('\n'), /controller evidence/);

  const ci = structuredClone(frozen);
  ci.fixedShaCi.authenticodeStatus = 'PASS';
  assert.match(validateWindowsEvidence(ci, manifest).failures.join('\n'), /fixed-SHA CI evidence mismatch/);
});
