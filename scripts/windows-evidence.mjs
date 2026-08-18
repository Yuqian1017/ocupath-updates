import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findPendingFields, isCanonicalUtcIso } from './release-manifest.mjs';

export const DEFAULT_WINDOWS_EVIDENCE_URL = new URL(
  '../release-evidence/v0.993.1-windows.json',
  import.meta.url,
);

const EXPECTED_BUILD_REVIEW_SHA = 'a0346b68190747cb15880a84bcb23c6e90eecae4';
const EXPECTED_PRODUCT_BEHAVIOR_SHA = '630d3a3472e6f7680cd54ed4d39413c5649d01e4';
const EXPECTED_CI_REPOSITORY = 'Yuqian1017/ocupathif_new';
const EXPECTED_CI_RUN_ID = 32106608240;
const EXPECTED_CI_JOB_ID = 95617238460;
const EXPECTED_CONTROLLER_EVIDENCE_REF = `https://github.com/${EXPECTED_CI_REPOSITORY}/actions/runs/${EXPECTED_CI_RUN_ID}/job/${EXPECTED_CI_JOB_ID}`;
const EXPECTED_FIXED_SHA_CI_RUN_URL = `https://github.com/${EXPECTED_CI_REPOSITORY}/actions/runs/${EXPECTED_CI_RUN_ID}`;
const DEFAULT_EVIDENCE_BASE_DIR = fileURLToPath(new URL('../', import.meta.url));

function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

function validatePostEvidenceRef(ref, post, target, manifest, { evidenceBaseDir }) {
  const failures = [];
  if (typeof ref !== 'string' || ref.trim() === '') return ['Windows post-publication evidenceRef is required'];
  if (ref.startsWith('https://')) {
    return ['Windows post-publication evidenceRef must be a schema-bound local postpublication JSON artifact'];
  }
  if (ref.startsWith('/') || !ref.startsWith('release-evidence/') || !ref.endsWith('.json')) {
    return ['Windows post-publication evidenceRef must be a local release-evidence JSON path'];
  }
  const root = resolve(evidenceBaseDir);
  const evidenceRoot = resolve(root, 'release-evidence');
  const artifactPath = resolve(root, ref);
  if (!artifactPath.startsWith(`${evidenceRoot}${sep}`)) {
    return ['Windows post-publication evidenceRef escapes the evidence root'];
  }
  try {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    const expectedFeedUrl = `${manifest.origins.public}/${manifest.feeds.win32X64.path}`;
    const expectedManualUrl = `${manifest.origins.public}/install.html`;
    const expectedFeedBody = readFileSync(resolve(root, 'ocupathif', manifest.feeds.win32X64.path), 'utf8');
    const expectedManualBody = readFileSync(resolve(root, 'ocupathif', 'install.html'), 'utf8');
    const feed = artifact?.feed ?? {};
    const manualPage = artifact?.manualPage ?? {};
    const installer = artifact?.installer ?? {};
    if (
      artifact?.schemaVersion !== 1
      || artifact?.sourceVersion !== post.sourceVersion
      || artifact?.targetVersion !== post.targetVersion
      || artifact?.evidenceLevel !== post.evidenceLevel
    ) {
      failures.push('Windows post-publication evidenceRef JSON does not match the claimed evidence');
    }
    if (
      feed.url !== expectedFeedUrl
      || feed.httpStatus !== 200
      || feed.body !== expectedFeedBody
      || feed.bodySha256 !== sha256(expectedFeedBody)
      || feed.version !== target.version
      || feed.path !== `${manifest.origins.cos}/${target.installerFileName}`
      || feed.sha512 !== target.installerSha512
      || feed.size !== target.installerSizeBytes
    ) failures.push('Windows post-publication feed evidence mismatch');
    if (
      manualPage.url !== expectedManualUrl
      || manualPage.httpStatus !== 200
      || manualPage.bodySha256 !== sha256(expectedManualBody)
    ) failures.push('Windows post-publication manual page evidence mismatch');
    if (
      installer.fileName !== target.installerFileName
      || installer.sizeBytes !== target.installerSizeBytes
      || installer.sha256 !== target.installerSha256
    ) failures.push('Windows post-publication installer evidence mismatch');
    if (
      !isCanonicalUtcIso(artifact?.observedAt, { allowPending: false })
      || !isCanonicalUtcIso(artifact?.artifactParsedAt, { allowPending: false })
      || Date.parse(artifact.artifactParsedAt) <= Date.parse(artifact.observedAt)
    ) failures.push('Windows post-publication timestamps must be canonical and artifactParsedAt must follow observedAt');
  } catch (error) {
    failures.push(`Windows post-publication evidenceRef JSON is unavailable or invalid: ${error.message}`);
  }
  return failures;
}

export function validateWindowsEvidence(evidence, manifest, {
  phase = 'prepublish',
  evidenceBaseDir = DEFAULT_EVIDENCE_BASE_DIR,
} = {}) {
  const failures = [];
  const target = evidence?.target ?? {};
  const source = evidence?.source ?? {};
  const controller = evidence?.controllerTests ?? {};
  const ci = evidence?.fixedShaCi ?? {};
  const reachability = evidence?.updateReachability ?? {};
  const observation = reachability.automaticInstallObservation ?? {};
  const post = evidence?.postPublication ?? {};

  if (evidence?.schemaVersion !== 1) failures.push('Windows evidence schemaVersion must be 1');
  const pendingScope = structuredClone(evidence ?? {});
  if (phase === 'prepublish') delete pendingScope.postPublication;
  if (findPendingFields(pendingScope).length > 0) failures.push('Windows evidence contains pending placeholders');
  if (evidence?.version !== manifest.version) failures.push('Windows evidence version mismatch');
  if (evidence?.nativeExact !== false) failures.push('Windows nativeExact must remain false unless a separately authorized native run is attached');
  if (evidence?.proofLabel !== 'controller-and-fixed-sha-ci-only') {
    failures.push('Windows proofLabel must be controller-and-fixed-sha-ci-only');
  }

  if (
    source.version !== manifest.previousLiveVersion
    || source.installerFileName !== 'OcupathIF-Setup-0.992.1-x64.exe'
    || source.installerSizeBytes !== 1354655261
    || source.installerSha256 !== '385a35a12225d44dc5361c20f21ea43b109b908a08e5b4cdfded4d32e9391193'
  ) {
    failures.push('Windows source package identity mismatch');
  }
  if (
    target.version !== manifest.version
    || target.installerFileName !== manifest.assets.windowsInstaller.fileName
    || target.installerSizeBytes !== manifest.assets.windowsInstaller.sizeBytes
    || target.installerSha256 !== manifest.assets.windowsInstaller.sha256
    || target.installerSha512 !== manifest.assets.windowsInstaller.sha512
  ) {
    failures.push('Windows target package identity mismatch');
  }
  if (target.productSourceCommitSha !== EXPECTED_BUILD_REVIEW_SHA) {
    failures.push('Windows target productSourceCommitSha must match the frozen build-review SHA');
  }

  if (
    controller.status !== 'PASS'
    || controller.passed !== 11
    || controller.total !== 11
    || controller.productSourceCommitSha !== target.productSourceCommitSha
    || controller.productBehaviorCommitSha !== EXPECTED_PRODUCT_BEHAVIOR_SHA
    || controller.evidenceRef !== EXPECTED_CONTROLLER_EVIDENCE_REF
  ) {
    failures.push('Windows controller evidence must be exact 11/11 on the target product SHA');
  }
  if (
    ci.status !== 'PASS'
    || ci.productSourceCommitSha !== target.productSourceCommitSha
    || ci.repository !== EXPECTED_CI_REPOSITORY
    || ci.runId !== EXPECTED_CI_RUN_ID
    || ci.jobId !== EXPECTED_CI_JOB_ID
    || ci.runUrl !== EXPECTED_FIXED_SHA_CI_RUN_URL
    || ci.installerSha256 !== target.installerSha256
    || ci.sourceBoundaryStatus !== 'PASS'
    || ci.provenanceStatus !== 'PASS'
    || ci.authenticodeStatus !== 'SKIPPED_NATIVE_NOT_AUTHORIZED'
  ) {
    failures.push('Windows fixed-SHA CI evidence mismatch');
  }

  if (
    reachability.sourceVersion !== source.version
    || reachability.targetVersion !== target.version
    || reachability.feedUrl !== `${manifest.origins.public}/${manifest.feeds.win32X64.path}`
    || reachability.installMode !== 'manual'
    || reachability.detectionEvidenceLevel !== 'automated-controller-only'
    || reachability.detectionStatus !== 'source-controller-verified'
    || reachability.manualFallbackStatus !== 'source-controller-verified'
  ) {
    failures.push('Windows source-to-target Manual Download reachability evidence mismatch');
  }
  if (observation.mode !== 'automated-controller-only' || observation.observed !== false) {
    failures.push('Windows automatic-install observation must explicitly record automated-controller-only and observed=false');
  }
  if (phase === 'postpublish') {
    if (findPendingFields(post).length > 0) failures.push('Windows post-publication evidence contains pending placeholders');
    if (
      post.sourceVersion !== source.version
      || post.targetVersion !== target.version
      || post.liveFeedStatus !== 'PASS'
      || post.manualPageStatus !== 'PASS'
      || post.exactInstallerBytesStatus !== 'PASS'
      || post.evidenceLevel !== 'live-feed-browser-and-artifact-parsed'
    ) {
      failures.push('Windows post-publication reachability evidence mismatch');
    }
    failures.push(...validatePostEvidenceRef(post.evidenceRef, post, target, manifest, {
      evidenceBaseDir,
    }));
  }

  return {
    status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE',
    failures,
    proofLabel: evidence?.proofLabel,
    nativeExact: evidence?.nativeExact,
  };
}

export function validateWindowsCiApiState(evidence, apiState) {
  const failures = [];
  const targetSha = evidence?.target?.productSourceCommitSha;
  const run = apiState?.run ?? {};
  const job = apiState?.job ?? {};
  if (
    run.id !== EXPECTED_CI_RUN_ID
    || run.repository?.full_name !== EXPECTED_CI_REPOSITORY
    || run.head_repository?.full_name !== EXPECTED_CI_REPOSITORY
    || run.head_sha !== targetSha
    || run.status !== 'completed'
    || run.conclusion !== 'success'
    || run.path !== '.github/workflows/build-windows.yml'
    || run.name !== 'Build Windows Standalone'
  ) {
    failures.push('Windows CI run API identity/provenance mismatch');
  }
  if (
    job.id !== EXPECTED_CI_JOB_ID
    || job.run_id !== EXPECTED_CI_RUN_ID
    || job.head_sha !== targetSha
    || job.status !== 'completed'
    || job.conclusion !== 'success'
    || job.name !== 'build-win'
    || job.html_url !== EXPECTED_CONTROLLER_EVIDENCE_REF
  ) {
    failures.push('Windows CI job API identity/provenance mismatch');
  }
  const stepConclusions = new Map((job.steps ?? []).map((step) => [step.name, step.conclusion]));
  const requiredPassSteps = [
    'Run standalone builder tests',
    'Verify canonical embedded build provenance',
    'Verify bundled runtime contract',
    'Build Windows installer',
    'Scan final NSIS payload and extracted app.asar',
    'Validate Windows direct-update metadata and bytes',
    'Upload Windows installer zip',
  ];
  for (const step of requiredPassSteps) {
    if (stepConclusions.get(step) !== 'success') failures.push(`Windows CI required step is not success: ${step}`);
  }
  if (stepConclusions.get('Verify Authenticode for direct-update installer') !== 'skipped') {
    failures.push('Windows CI Authenticode step must remain explicitly skipped');
  }
  if (stepConclusions.get('Upload Windows direct-update assets') !== 'skipped') {
    failures.push('Windows CI direct-update upload step must remain explicitly skipped');
  }
  return { status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE', failures };
}

export function loadWindowsEvidence(pathOrUrl, manifest, options) {
  const source = pathOrUrl || process.env.OCUPATH_WINDOWS_EVIDENCE_JSON || DEFAULT_WINDOWS_EVIDENCE_URL;
  const evidence = JSON.parse(readFileSync(source, 'utf8'));
  const result = validateWindowsEvidence(evidence, manifest, options);
  if (result.status !== 'GREEN') {
    const error = new Error(`Windows evidence is not acceptable:\n- ${result.failures.join('\n- ')}`);
    error.validation = result;
    throw error;
  }
  return { evidence, result };
}
