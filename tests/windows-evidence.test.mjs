import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

function localPostEvidenceArtifact(mutate = () => {}) {
  const root = join(tmpdir(), `ocupath-windows-evidence-${process.pid}-${Date.now()}`);
  mkdirSync(join(root, 'release-evidence'), { recursive: true });
  mkdirSync(join(root, 'ocupathif', 'direct', 'win32-x64'), { recursive: true });
  const ref = 'release-evidence/windows-postpublication.json';
  const feedBody = readFileSync(new URL('../ocupathif/direct/win32-x64/latest.yml', import.meta.url), 'utf8');
  const manualBody = readFileSync(new URL('../ocupathif/install.html', import.meta.url), 'utf8');
  writeFileSync(join(root, 'ocupathif', 'direct', 'win32-x64', 'latest.yml'), feedBody);
  writeFileSync(join(root, 'ocupathif', 'install.html'), manualBody);
  const artifact = {
    schemaVersion: 1,
    sourceVersion: '0.993.1',
    targetVersion: '0.994.1',
    evidenceLevel: 'live-feed-browser-and-artifact-parsed',
    observedAt: '2026-08-18T18:00:00.000Z',
    artifactParsedAt: '2026-08-18T18:00:01.000Z',
    feed: {
      url: 'https://updates.ocupath.ai/ocupathif/direct/win32-x64/latest.yml',
      httpStatus: 200,
      body: feedBody,
      bodySha256: sha256(feedBody),
      version: '0.994.1',
      path: 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com/OcupathIF-Setup-0.994.1-x64.exe',
      sha512: 'XnvzJ91HAqV3q1845zJWrOMZAfX5giT2Js3+tqAZ9P3IKcxAZWGzy0ZsxhFi7h8l+GIMgp1enddbOHwCtkCCVQ==',
      size: 1354705933,
    },
    manualPage: {
      url: 'https://updates.ocupath.ai/ocupathif/install.html',
      httpStatus: 200,
      bodySha256: sha256(manualBody),
    },
    installer: {
      fileName: 'OcupathIF-Setup-0.994.1-x64.exe',
      sizeBytes: 1354705933,
      sha256: 'ee2801ce9953453fb1982e568b307fe1ee49a71a12d71926c27815581be10e8c',
    },
  };
  mutate(artifact);
  writeFileSync(join(root, ref), `${JSON.stringify(artifact)}\n`);
  return { root, ref, artifact };
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
      id: 32411740699,
      repository: { full_name: 'Yuqian1017/ocupathif_new' },
      head_repository: { full_name: 'Yuqian1017/ocupathif_new' },
      head_sha: 'fbd1788ff5b43bfe12624b9a9984c4f9b90342ed',
      status: 'completed',
      conclusion: 'success',
      path: '.github/workflows/build-windows.yml',
      name: 'Build Windows Standalone',
    },
    job: {
      id: 96563504711,
      run_id: 32411740699,
      head_sha: 'fbd1788ff5b43bfe12624b9a9984c4f9b90342ed',
      status: 'completed',
      conclusion: 'success',
      name: 'build-win',
      html_url: 'https://github.com/Yuqian1017/ocupathif_new/actions/runs/32411740699/job/96563504711',
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
  assert.equal(frozen.target.installerSizeBytes, 1354705933);
  assert.equal(frozen.target.installerSha256, 'ee2801ce9953453fb1982e568b307fe1ee49a71a12d71926c27815581be10e8c');
  assert.equal(frozen.fixedShaCi.authenticodeStatus, 'SKIPPED_NATIVE_NOT_AUTHORIZED');
  assert.equal(
    frozen.controllerTests.evidenceRef,
    'https://github.com/Yuqian1017/ocupathif_new/actions/runs/32411740699/job/96563504711',
  );
  assert.equal(
    frozen.fixedShaCi.runUrl,
    'https://github.com/Yuqian1017/ocupathif_new/actions/runs/32411740699',
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

test('Windows post evidenceRef must be a schema-bound local postpublication artifact', () => {
  const arbitrary = postEvidence('anything.json');
  assert.match(validateWindowsEvidence(arbitrary, manifest, { phase: 'postpublish' }).failures.join('\n'), /release-evidence JSON path/);

  const missing = postEvidence('release-evidence/missing.json');
  assert.match(validateWindowsEvidence(missing, manifest, { phase: 'postpublish' }).failures.join('\n'), /unavailable or invalid/);

  const actionsUrl = postEvidence('https://github.com/Yuqian1017/ocupathif_new/actions/runs/32411740699/job/96563504711');
  assert.match(validateWindowsEvidence(actionsUrl, manifest, {
    phase: 'postpublish',
  }).failures.join('\n'), /local postpublication JSON/);
});

test('Windows post artifact rejects live feed body, installer or timestamp drift', () => {
  const feedDrift = localPostEvidenceArtifact((artifact) => {
    artifact.feed.body = `${artifact.feed.body}# stale\n`;
  });
  assert.match(validateWindowsEvidence(postEvidence(feedDrift.ref), manifest, {
    phase: 'postpublish',
    evidenceBaseDir: feedDrift.root,
  }).failures.join('\n'), /feed evidence mismatch/);

  const installerDrift = localPostEvidenceArtifact((artifact) => {
    artifact.installer.sizeBytes -= 1;
  });
  assert.match(validateWindowsEvidence(postEvidence(installerDrift.ref), manifest, {
    phase: 'postpublish',
    evidenceBaseDir: installerDrift.root,
  }).failures.join('\n'), /installer evidence mismatch/);

  const timeDrift = localPostEvidenceArtifact((artifact) => {
    artifact.artifactParsedAt = '2026-08-18T18:00:01Z';
  });
  assert.match(validateWindowsEvidence(postEvidence(timeDrift.ref), manifest, {
    phase: 'postpublish',
    evidenceBaseDir: timeDrift.root,
  }).failures.join('\n'), /timestamps must be canonical/);
});
