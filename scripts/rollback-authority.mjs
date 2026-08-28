import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCanonicalUtcIso } from './release-manifest.mjs';

export const DEFAULT_ROLLBACK_AUTHORITY_URL = new URL(
  '../rollback/v0.995.1-r1/ROLLBACK_AUTHORITY.json',
  import.meta.url,
);

const INITIAL_EXPECTED_SEQUENCE = [
  ['pages', 'ensure_absent', 'ocupathif/regional-cos/v0.995.1.json'],
  ['cos', 'restore_body', 'latest-mac.yml'],
  ['cos', 'restore_body', 'darwin-arm64/latest-mac.yml'],
  ['pages', 'restore_body', 'ocupathif/direct/darwin-arm64/latest-mac.yml'],
  ['pages', 'restore_body', 'ocupathif/direct/win32-x64/latest.yml'],
  ['pages', 'restore_body', 'ocupathif/latest.json'],
  ['pages', 'restore_body', 'ocupathif/install.html'],
];

const REPLACEMENT_EXPECTED_SEQUENCE = INITIAL_EXPECTED_SEQUENCE.map((entry, index) => (
  index === 0 ? ['pages', 'restore_body', 'ocupathif/regional-cos/v0.995.1.json'] : entry
));

function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

export function rollbackStepUrl(authority, step) {
  const origin = authority?.origins?.[step.surface];
  if (!origin) throw new Error(`rollback origin missing for ${step.surface}`);
  return `${origin}/${step.key}`;
}

export function validateLiveRollbackState(authority, observations) {
  const failures = [];
  const steps = authority?.restoreSteps ?? [];
  if (!Array.isArray(observations) || observations.length !== steps.length) {
    failures.push(`live rollback observation count mismatch: ${observations?.length ?? 0}/${steps.length}`);
  }
  steps.forEach((step, index) => {
    const observed = observations?.[index];
    if (!observed) return;
    const expectedUrl = rollbackStepUrl(authority, step);
    if (observed.url !== expectedUrl) failures.push(`live rollback URL mismatch: ${step.key}`);
    if (observed.httpStatus !== step.expectedHttpStatus) {
      failures.push(`live rollback HTTP status mismatch: ${step.key}`);
    }
    if (step.action === 'ensure_absent') return;
    if (observed.bytes !== step.bytes || observed.sha256 !== step.sha256) {
      failures.push(`live rollback bytes mismatch: ${step.key}`);
    }
  });
  return { status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE', failures };
}

export function validateRollbackAuthority(authority, authorityPathOrUrl = DEFAULT_ROLLBACK_AUTHORITY_URL) {
  const failures = [];
  const steps = authority?.restoreSteps ?? [];
  const authorityPath = authorityPathOrUrl instanceof URL
    ? fileURLToPath(authorityPathOrUrl)
    : resolve(authorityPathOrUrl);
  const baseDir = dirname(authorityPath);
  const replacementAuthority = authority?.version === '0.995.1' && authority?.releaseRevision === 'r1';
  const initialAuthority = authority?.version === '0.994.1' && !Object.hasOwn(authority ?? {}, 'releaseRevision');
  const expectedSequence = replacementAuthority
    ? REPLACEMENT_EXPECTED_SEQUENCE
    : INITIAL_EXPECTED_SEQUENCE;

  if (authority?.schemaVersion !== 1) failures.push('rollback schemaVersion must be 1');
  if (!replacementAuthority && !initialAuthority) {
    failures.push('rollback authority identity must be 0.994.1 initial or 0.995.1-r1 replacement');
  }
  if (authority?.source !== 'read-only production fetch') failures.push('rollback source mismatch');
  if (authority?.origins?.pages !== 'https://updates.ocupath.ai') failures.push('rollback Pages origin mismatch');
  if (
    authority?.origins?.cos
    !== 'https://ocupathif-downloads-hk-1466317075.cos.ap-hongkong.myqcloud.com'
  ) failures.push('rollback COS origin mismatch');
  if (!isCanonicalUtcIso(authority?.capturedAt, { allowPending: false })) {
    failures.push('rollback capturedAt must be canonical UTC ISO');
  }
  if (steps.length !== expectedSequence.length) failures.push('rollback restore step count mismatch');

  expectedSequence.forEach(([surface, action, key], index) => {
    const step = steps[index];
    if (!step) return;
    if (step.order !== index + 1 || step.surface !== surface || step.action !== action || step.key !== key) {
      failures.push(`rollback step ${index + 1} sequence mismatch`);
    }
    if (action === 'ensure_absent') {
      if (step.expectedHttpStatus !== 404 || Object.hasOwn(step, 'bodyPath')) {
        failures.push(`rollback absence contract mismatch: ${step.key}`);
      }
      return;
    }
    if (step.expectedHttpStatus !== 200) {
      failures.push(`rollback HTTP status mismatch: ${step.key}`);
    }
    try {
      const bodyPath = resolve(baseDir, step.bodyPath);
      const body = readFileSync(bodyPath);
      if (statSync(bodyPath).size !== step.bytes || sha256(body) !== step.sha256) {
        failures.push(`rollback body mismatch: ${step.key}`);
      }
    } catch (error) {
      failures.push(`rollback body unavailable: ${step.key} (${error.message})`);
    }
  });

  return { status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE', failures };
}

export function loadRollbackAuthority(pathOrUrl = DEFAULT_ROLLBACK_AUTHORITY_URL) {
  const authority = JSON.parse(readFileSync(pathOrUrl, 'utf8'));
  const result = validateRollbackAuthority(authority, pathOrUrl);
  if (result.status !== 'GREEN') {
    throw new Error(`Rollback authority is invalid:\n- ${result.failures.join('\n- ')}`);
  }
  return { authority, result };
}
