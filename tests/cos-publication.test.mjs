import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  buildCosAuthority,
  buildManualCosAuthority,
  cosAuthoritySha256,
  cosUploadLedgerSha256,
  validateCosEvidence,
  validateCosUploadLedger,
} from '../scripts/cos-publication.mjs';
import { runLiveCosGate } from '../scripts/live-cos-gate.mjs';
import { DEFAULT_STAGING_MANIFEST_URL } from '../scripts/release-manifest.mjs';

const staging = JSON.parse(readFileSync(DEFAULT_STAGING_MANIFEST_URL, 'utf8'));
const execFileAsync = promisify(execFile);
const verifierPath = fileURLToPath(new URL('../scripts/verify-cos-assets.mjs', import.meta.url));

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
    darwinArm64: 'version: 0.995.1\nreleaseDate: 2026-08-18T12:00:00.000Z\n',
  });
}

function evidence(expected = authority(), ledger = uploadLedger(expected)) {
  return {
    schemaVersion: 2,
    generatedBy: 'scripts/verify-cos-assets.mjs',
    authoritySha256: cosAuthoritySha256(expected),
    uploadLedgerSha256: cosUploadLedgerSha256(ledger),
    version: expected.version,
    baseUrl: expected.baseUrl,
    sequencing: expected.sequencing,
    objects: expected.objects.map((object, index) => {
      const rangeBytes = Math.min(1024, object.bytes);
      return {
        ...object,
        uploadStatus: ledger.objects[index].uploadStatus,
        uploadedAt: ledger.objects[index].uploadedAt,
        verifyStatus: 'PASS',
        headStatus: 200,
        contentLength: object.bytes,
        etag: `"fixture-${index}"`,
        corsOptionsStatus: 204,
        corsAllowOrigin: 'https://updates.ocupath.ai',
        corsAllowMethods: 'GET, HEAD',
        corsExposeHeaders: 'Content-Length, ETag, Last-Modified',
        headCorsAllowOrigin: 'https://updates.ocupath.ai',
        headCorsExposeHeaders: 'Content-Length, ETag, Last-Modified',
        lastModified: index < 4
          ? 'Tue, 18 Aug 2026 12:00:01 GMT'
          : 'Tue, 18 Aug 2026 12:00:02 GMT',
        rangeStatus: 206,
        contentRange: `bytes 0-${rangeBytes - 1}/${object.bytes}`,
        rangeBytes,
        fullBytes: object.bytes,
        fullSha256: object.sha256,
      };
    }),
    uploadCompletedAt: ledger.uploadCompletedAt,
    verificationCompletedAt: '2026-08-18T12:00:08.000Z',
  };
}

function uploadLedger(expected = authority()) {
  return {
    schemaVersion: 1,
    version: expected.version,
    baseUrl: expected.baseUrl,
    sequencing: expected.sequencing,
    authoritySha256: cosAuthoritySha256(expected),
    objects: expected.objects.map((object, index) => ({
      order: object.order,
      phase: object.phase,
      key: object.key,
      uploadStatus: 'PASS',
      uploadedAt: `2026-08-18T12:00:0${index + 1}.000Z`,
    })),
    uploadCompletedAt: '2026-08-18T12:00:07.000Z',
  };
}

test('COS authority is the exact six-object payload-first metadata-last contract', () => {
  const expected = authority();
  assert.deepEqual(expected.objects.map(({ order, phase, key }) => ({ order, phase, key })), [
    { order: 1, phase: 'payload', key: staging.assets.macManual.cosKey },
    { order: 2, phase: 'payload', key: staging.assets.windowsInstaller.cosKey },
    { order: 3, phase: 'payload', key: staging.assets.macUpdater.cosKey },
    { order: 4, phase: 'payload', key: staging.assets.macUpdaterBlockmap.cosKey },
    { order: 5, phase: 'metadata', key: 'latest-mac.yml' },
    { order: 6, phase: 'metadata', key: 'darwin-arm64/latest-mac.yml' },
  ]);
  assert.deepEqual(expected.objects[4], {
    ...expected.objects[5],
    order: 5,
    key: 'latest-mac.yml',
  });
  assert.deepEqual(validateCosEvidence(expected, evidence(expected), uploadLedger(expected)), {
    status: 'GREEN',
    failures: [],
    objectCount: 6,
  });
});

test('same-version replacement authority writes payloads to isolated COS object keys', () => {
  const manifest = finalManifest();
  manifest.release.tagName = `v${manifest.version}-r2`;
  for (const key of ['macManual', 'windowsInstaller', 'macUpdater', 'macUpdaterBlockmap']) {
    manifest.assets[key].cosKey = `revisions/${manifest.release.tagName}/${manifest.assets[key].fileName}`;
  }
  const expected = buildCosAuthority(manifest, {
    darwinArm64: 'version: 0.995.1\nreleaseDate: 2026-08-18T12:00:00.000Z\n',
  });
  assert.deepEqual(expected.objects.slice(0, 4).map((object) => object.key), [
    `revisions/v0.995.1-r2/${manifest.assets.macManual.fileName}`,
    `revisions/v0.995.1-r2/${manifest.assets.windowsInstaller.fileName}`,
    `revisions/v0.995.1-r2/${manifest.assets.macUpdater.fileName}`,
    `revisions/v0.995.1-r2/${manifest.assets.macUpdaterBlockmap.fileName}`,
  ]);
});

test('COS evidence rejects extras, byte drift and reordered or simultaneous uploads', () => {
  const expected = authority();

  const extra = evidence(expected);
  extra.objects.push({ ...extra.objects.at(-1), key: 'unexpected' });
  assert.match(validateCosEvidence(expected, extra, uploadLedger(expected)).failures.join('\n'), /object count mismatch/);

  const drift = evidence(expected);
  drift.objects[1].sha256 = 'f'.repeat(64);
  assert.match(validateCosEvidence(expected, drift, uploadLedger(expected)).failures.join('\n'), /object 2 sha256 mismatch/);

  const sameTime = evidence(expected);
  sameTime.objects[4].uploadedAt = sameTime.objects[3].uploadedAt;
  assert.match(validateCosEvidence(expected, sameTime, uploadLedger(expected)).failures.join('\n'), /not strictly increasing/);

  const earlyCompletion = evidence(expected);
  earlyCompletion.uploadCompletedAt = earlyCompletion.objects.at(-1).uploadedAt;
  assert.match(validateCosEvidence(expected, earlyCompletion, uploadLedger(expected)).failures.join('\n'), /must follow every upload/);
});

test('COS evidence rejects pending values and noncanonical timestamps', () => {
  const expected = authority();
  const pending = evidence(expected);
  pending.objects[0].verifyStatus = '__PENDING_VERIFY__';
  assert.match(validateCosEvidence(expected, pending, uploadLedger(expected)).failures.join('\n'), /pending placeholders/);

  const noncanonical = evidence(expected);
  noncanonical.objects[0].uploadedAt = '2026-08-18T12:00:01Z';
  assert.match(validateCosEvidence(expected, noncanonical, uploadLedger(expected)).failures.join('\n'), /not canonical UTC ISO/);
});

test('COS evidence requires actual HEAD, Range and full-byte verifier fields', () => {
  const expected = authority();
  const handWrittenPass = evidence(expected);
  delete handWrittenPass.generatedBy;
  delete handWrittenPass.objects[0].headStatus;
  delete handWrittenPass.objects[0].fullSha256;
  const failures = validateCosEvidence(expected, handWrittenPass, uploadLedger(expected)).failures.join('\n');
  assert.match(failures, /must be generated by/);
  assert.match(failures, /network verification mismatch/);
});

test('full COS evidence requires live Last-Modified proof that metadata followed payloads', () => {
  const expected = authority();
  const missing = evidence(expected);
  delete missing.objects[4].lastModified;
  assert.match(
    validateCosEvidence(expected, missing, uploadLedger(expected)).failures.join('\n'),
    /Last-Modified/,
  );

  const simultaneous = evidence(expected);
  simultaneous.objects[4].lastModified = simultaneous.objects[3].lastModified;
  assert.match(
    validateCosEvidence(expected, simultaneous, uploadLedger(expected)).failures.join('\n'),
    /does not prove metadata-last promotion/,
  );
});

test('COS evidence requires browser-readable regional CORS for exact origin and headers', () => {
  const expected = authority();
  const missing = evidence(expected);
  delete missing.objects[0].headCorsAllowOrigin;
  assert.match(
    validateCosEvidence(expected, missing, uploadLedger(expected)).failures.join('\n'),
    /regional CORS readiness mismatch/,
  );

  const broadMethods = evidence(expected);
  broadMethods.objects[0].corsAllowMethods = 'GET, HEAD, PUT';
  assert.match(
    validateCosEvidence(expected, broadMethods, uploadLedger(expected)).failures.join('\n'),
    /regional CORS readiness mismatch/,
  );
});

test('upload ledger and manual website authority stay separate from full updater publication', () => {
  const full = authority();
  assert.equal(validateCosUploadLedger(full, uploadLedger(full)).status, 'GREEN');

  const manual = buildManualCosAuthority(finalManifest());
  assert.equal(manual.sequencing, 'manual-payloads-only');
  assert.deepEqual(manual.objects.map((object) => object.key), [
    staging.assets.macManual.cosKey,
    staging.assets.windowsInstaller.cosKey,
  ]);
  assert.equal(validateCosEvidence(manual, evidence(manual), uploadLedger(manual)).status, 'GREEN');

  const wrongLedger = uploadLedger(full);
  wrongLedger.objects[4].uploadedAt = wrongLedger.objects[3].uploadedAt;
  assert.match(validateCosUploadLedger(full, wrongLedger).failures.join('\n'), /not strictly increasing/);

  const evidenceWithDifferentLedger = evidence(full);
  const changedLedger = uploadLedger(full);
  changedLedger.objects[0].uploadedAt = '2026-08-18T11:59:59.000Z';
  assert.match(
    validateCosEvidence(full, evidenceWithDifferentLedger, changedLedger).failures.join('\n'),
    /upload ledger digest mismatch/,
  );
});

test('verify-cos-assets is the network-backed evidence generator for HEAD, Range and full SHA', async () => {
  const bodies = new Map([
    ['/manual-mac.zip', Buffer.from('mac-manual-payload')],
    ['/manual-win.exe', Buffer.from('windows-manual-payload')],
  ]);
  const server = createServer((request, response) => {
    const body = bodies.get(request.url);
    if (!body) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-length', body.length);
    response.setHeader('last-modified', 'Thu, 01 Jan 2026 00:00:01 GMT');
    response.setHeader('etag', '"fixture-etag"');
    response.setHeader('access-control-allow-origin', 'https://updates.ocupath.ai');
    response.setHeader('access-control-allow-methods', 'GET, HEAD');
    response.setHeader('access-control-expose-headers', 'Content-Length, ETag, Last-Modified');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (request.headers.range) {
      const end = body.length - 1;
      response.writeHead(206, { 'content-range': `bytes 0-${end}/${body.length}` });
      response.end(body);
      return;
    }
    response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const authority = {
      schemaVersion: 1,
      version: '0.995.1',
      baseUrl: `http://127.0.0.1:${port}`,
      sequencing: 'manual-payloads-only',
      objects: [...bodies.entries()].map(([key, body], index) => ({
        order: index + 1,
        phase: 'payload',
        key: key.slice(1),
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      })),
    };
    const ledger = {
      schemaVersion: 1,
      version: authority.version,
      baseUrl: authority.baseUrl,
      sequencing: authority.sequencing,
      authoritySha256: cosAuthoritySha256(authority),
      objects: authority.objects.map((object, index) => ({
        order: object.order,
        phase: object.phase,
        key: object.key,
        uploadStatus: 'PASS',
        uploadedAt: `2026-01-01T00:00:0${index + 1}.000Z`,
      })),
      uploadCompletedAt: '2026-01-01T00:00:03.000Z',
    };
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'ocupath-cos-verifier-test-'));
    const authorityPath = join(fixtureRoot, 'authority.json');
    const ledgerPath = join(fixtureRoot, 'ledger.json');
    writeFileSync(authorityPath, `${JSON.stringify(authority, null, 2)}\n`);
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    const { stdout } = await execFileAsync(process.execPath, [verifierPath, authorityPath, ledgerPath]);
    const generated = JSON.parse(stdout);
    assert.equal(generated.status, 'PASS');
    assert.equal(generated.generatedBy, 'scripts/verify-cos-assets.mjs');
    assert.equal(generated.uploadLedgerSha256, cosUploadLedgerSha256(ledger));
    assert.equal(validateCosEvidence(authority, generated, ledger).status, 'GREEN');
    assert.deepEqual(generated.objects.map((object) => object.rangeStatus), [206, 206]);
    assert.equal((await runLiveCosGate(authorityPath, ledgerPath)).status, 'GREEN');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('live COS gate cannot be satisfied by a forged external PASS document', async () => {
  const body = Buffer.from('forged');
  const unreachable = {
    schemaVersion: 1,
    version: '0.995.1',
    baseUrl: 'https://example.invalid',
    sequencing: 'manual-payloads-only',
    objects: [{
      order: 1,
      phase: 'payload',
      key: 'manual.zip',
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    }],
  };
  const ledger = uploadLedger(unreachable);
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'ocupath-cos-live-gate-red-'));
  const authorityPath = join(fixtureRoot, 'authority.json');
  const ledgerPath = join(fixtureRoot, 'ledger.json');
  writeFileSync(authorityPath, `${JSON.stringify(unreachable, null, 2)}\n`);
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  const result = await runLiveCosGate(authorityPath, ledgerPath);
  assert.equal(result.status, 'RED_STOP_LINE');
  assert.match(result.failures.join('\n'), /live COS verifier process did not PASS|network verification mismatch/);
});
