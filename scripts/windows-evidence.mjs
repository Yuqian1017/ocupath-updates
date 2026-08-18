import { readFileSync } from 'node:fs';

import { findPendingFields } from './release-manifest.mjs';

export const DEFAULT_WINDOWS_EVIDENCE_URL = new URL(
  '../release-evidence/v0.993.1-windows.json',
  import.meta.url,
);

const EXPECTED_BUILD_REVIEW_SHA = 'a0346b68190747cb15880a84bcb23c6e90eecae4';
const EXPECTED_PRODUCT_BEHAVIOR_SHA = '630d3a3472e6f7680cd54ed4d39413c5649d01e4';
const EXPECTED_CONTROLLER_EVIDENCE_REF = 'https://github.com/Yuqian1017/ocupath/actions/runs/32106608240/job/95617238460';
const EXPECTED_FIXED_SHA_CI_RUN_URL = 'https://github.com/Yuqian1017/ocupath/actions/runs/32106608240';

export function validateWindowsEvidence(evidence, manifest, { phase = 'prepublish' } = {}) {
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
  }

  return {
    status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE',
    failures,
    proofLabel: evidence?.proofLabel,
    nativeExact: evidence?.nativeExact,
  };
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
