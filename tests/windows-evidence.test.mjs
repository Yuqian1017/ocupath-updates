import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_STAGING_MANIFEST_URL,
} from '../scripts/release-manifest.mjs';
import {
  DEFAULT_WINDOWS_EVIDENCE_URL,
  validateWindowsCiApiState,
  validateWindowsEvidence,
} from '../scripts/windows-evidence.mjs';

const manifest = JSON.parse(readFileSync(DEFAULT_STAGING_MANIFEST_URL, 'utf8'));
const frozen = JSON.parse(readFileSync(DEFAULT_WINDOWS_EVIDENCE_URL, 'utf8'));

function postEvidence(evidenceRef = '__PENDING_WINDOWS_POSTPUBLICATION_EVIDENCE_REF__') {
  const evidence = structuredClone(frozen);
  evidence.postPublication.liveFeedStatus = 'PASS';
  evidence.postPublication.manualPageStatus = 'PASS';
  evidence.postPublication.exactInstallerBytesStatus = 'PASS';
  evidence.postPublication.evidenceRef = evidenceRef;
  return evidence;
}

function localPostEvidenceArtifact() {
  const root = join(tmpdir(), `ocupath-windows-evidence-${process.pid}-${Date.now()}`);
  mkdirSync(join(root, 'release-evidence'), { recursive: true });
  const ref = 'release-evidence/windows-postpublication.json';
  writeFileSync(join(root, ref), `${JSON.stringify({
    schemaVersion: 1,
    sourceVersion: '0.992.1',
    targetVersion: '0.993.1',
    installerSha256: '58e48850399c377457819b5294539b9fdea0164da13d4ee0a1cc2cb030cabeeb',
    liveFeedStatus: 'PASS',
    manualPageStatus: 'PASS',
    exactInstallerBytesStatus: 'PASS',
    evidenceLevel: 'live-feed-browser-and-artifact-parsed',
  })}\n`);
  return { root, ref };
}

function ciApiState() {
  const requiredSteps = [
    'Run standalone builder tests',
    'Verify canonical embedded build provenance',
    'Verify bundled runtime contract',
    'Build Windows installer',
    'Scan final NSIS payload and extracted app.asar',
    'Validate Windows direct-update metadata and bytes',
    'Upload Windows installer zip',
  ];
  return {
    run: {
      id: 32106608240,
      repository: { full_name: 'Yuqian1017/ocupathif_new' },
      head_repository: { full_name: 'Yuqian1017/ocupathif_new' },
      head_sha: 'a0346b68190747cb15880a84bcb23c6e90eecae4',
      status: 'completed',
      conclusion: 'success',
      path: '.github/workflows/build-windows.yml',
      name: 'Build Windows Standalone',
    },
    job: {
      id: 95617238460,
      run_id: 32106608240,
      head_sha: 'a0346b68190747cb15880a84bcb23c6e90eecae4',
      status: 'completed',
      conclusion: 'success',
      name: 'build-win',
      html_url: 'https://github.com/Yuqian1017/ocupathif_new/actions/runs/32106608240/job/95617238460',
      steps: [
        ...requiredSteps.map((name) => ({ name, conclusion: 'success' })),
        { name: 'Verify Authenticode for direct-update installer', conclusion: 'skipped' },
        { name: 'Upload Windows direct-update assets', conclusion: 'skipped' },
      ],
    },
  };
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
  assert.equal(
    frozen.controllerTests.evidenceRef,
    'https://github.com/Yuqian1017/ocupathif_new/actions/runs/32106608240/job/95617238460',
  );
  assert.equal(
    frozen.fixedShaCi.runUrl,
    'https://github.com/Yuqian1017/ocupathif_new/actions/runs/32106608240',
  );
});

test('postpublish requires durable live feed, manual page and exact installer byte evidence', () => {
  const pending = validateWindowsEvidence(frozen, manifest, { phase: 'postpublish' });
  assert.equal(pending.status, 'RED_STOP_LINE');
  assert.match(pending.failures.join('\n'), /pending placeholders/);

  const artifact = localPostEvidenceArtifact();
  assert.equal(validateWindowsEvidence(postEvidence(artifact.ref), manifest, {
    phase: 'postpublish',
    evidenceBaseDir: artifact.root,
  }).status, 'GREEN');
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

test('Windows CI run and job API provenance must match the frozen source and required steps', () => {
  assert.deepEqual(validateWindowsCiApiState(frozen, ciApiState()), {
    status: 'GREEN',
    failures: [],
  });
  const wrongRepo = ciApiState();
  wrongRepo.run.repository.full_name = 'Yuqian1017/ocupath';
  assert.match(validateWindowsCiApiState(frozen, wrongRepo).failures.join('\n'), /run API identity/);

  const wrongStep = ciApiState();
  wrongStep.job.steps.find((step) => step.name === 'Verify canonical embedded build provenance').conclusion = 'failure';
  assert.match(validateWindowsCiApiState(frozen, wrongStep).failures.join('\n'), /required step/);
});

test('Windows post evidenceRef must be nonempty and parseable or a verified allowed URL', () => {
  const arbitrary = postEvidence('anything.json');
  assert.match(validateWindowsEvidence(arbitrary, manifest, { phase: 'postpublish' }).failures.join('\n'), /release-evidence JSON path/);

  const missing = postEvidence('release-evidence/missing.json');
  assert.match(validateWindowsEvidence(missing, manifest, { phase: 'postpublish' }).failures.join('\n'), /unavailable or invalid/);

  const allowedUrl = postEvidence('https://github.com/Yuqian1017/ocupathif_new/actions/runs/32106608240/job/95617238460');
  assert.equal(validateWindowsEvidence(allowedUrl, manifest, {
    phase: 'postpublish',
    evidenceUrlExists: () => true,
  }).status, 'GREEN');
  assert.match(validateWindowsEvidence(allowedUrl, manifest, {
    phase: 'postpublish',
    evidenceUrlExists: () => false,
  }).failures.join('\n'), /not verified as reachable/);
});
