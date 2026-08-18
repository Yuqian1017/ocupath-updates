#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createWriteStream, readFileSync, statSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  cosAuthoritySha256,
  cosUploadLedgerSha256,
  validateCosEvidence,
  validateCosUploadLedger,
} from './cos-publication.mjs';

const authorityPath = process.argv[2];
const uploadLedgerPath = process.argv[3];
if (!authorityPath || !uploadLedgerPath) {
  throw new Error('Usage: verify-cos-assets.mjs <COS_AUTHORITY.json> <COS_UPLOAD_LEDGER.json>');
}

const authority = JSON.parse(readFileSync(authorityPath, 'utf8'));
const uploadLedger = JSON.parse(readFileSync(uploadLedgerPath, 'utf8'));
const ledgerResult = validateCosUploadLedger(authority, uploadLedger);
if (ledgerResult.status !== 'GREEN') {
  throw new Error(`COS upload ledger is invalid:\n- ${ledgerResult.failures.join('\n- ')}`);
}
const results = [];
const regionalPageOrigin = 'https://updates.ocupath.ai';

for (const [index, object] of authority.objects.entries()) {
  const encodedKey = object.key.split('/').map(encodeURIComponent).join('/');
  const url = `${authority.baseUrl}/${encodedKey}`;
  const ledgerObject = uploadLedger.objects[index];
  const result = {
    ...object,
    uploadStatus: ledgerObject.uploadStatus,
    uploadedAt: ledgerObject.uploadedAt,
    verifyStatus: 'FAIL',
  };
  try {
    const corsOptions = await fetch(url, {
      method: 'OPTIONS',
      redirect: 'follow',
      headers: {
        Origin: regionalPageOrigin,
        'Access-Control-Request-Method': 'HEAD',
      },
    });
    result.corsOptionsStatus = corsOptions.status;
    result.corsAllowOrigin = corsOptions.headers.get('access-control-allow-origin');
    result.corsAllowMethods = corsOptions.headers.get('access-control-allow-methods');
    result.corsExposeHeaders = corsOptions.headers.get('access-control-expose-headers');

    const head = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { Origin: regionalPageOrigin },
    });
    result.headStatus = head.status;
    result.contentLength = Number(head.headers.get('content-length'));
    result.lastModified = head.headers.get('last-modified');
    result.etag = head.headers.get('etag');
    result.headCorsAllowOrigin = head.headers.get('access-control-allow-origin');
    result.headCorsExposeHeaders = head.headers.get('access-control-expose-headers');
    if (head.status !== 200 || result.contentLength !== object.bytes) {
      throw new Error(`HEAD ${head.status}; content-length ${result.contentLength}`);
    }

    const range = await fetch(url, { headers: { Range: 'bytes=0-1023' }, redirect: 'follow' });
    result.rangeStatus = range.status;
    result.contentRange = range.headers.get('content-range');
    const rangeBytes = Buffer.from(await range.arrayBuffer());
    result.rangeBytes = rangeBytes.length;
    if (range.status !== 206 || rangeBytes.length !== Math.min(1024, object.bytes)) {
      throw new Error(`Range ${range.status}; bytes ${rangeBytes.length}`);
    }

    const target = join(tmpdir(), `ocupath-cos-verify-${process.pid}-${index}-${basename(object.key)}`);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`GET ${response.status}`);
    const output = createWriteStream(target, { flags: 'wx' });
    const hash = createHash('sha256');
    let bytes = 0;
    const source = Readable.fromWeb(response.body);
    source.on('data', (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    source.pipe(output);
    await finished(output);
    result.fullBytes = bytes;
    result.fullSha256 = hash.digest('hex');
    result.verifyStatus = bytes === object.bytes && result.fullSha256 === object.sha256 ? 'PASS' : 'FAIL';
    if (statSync(target).size !== bytes) throw new Error('temporary stream size mismatch');
    await import('node:fs/promises').then(({ unlink }) => unlink(target));
  } catch (error) {
    result.verifyStatus = 'FAIL';
    result.error = error instanceof Error ? error.message : String(error);
  }
  results.push(result);
}

const output = {
  schemaVersion: 2,
  generatedBy: 'scripts/verify-cos-assets.mjs',
  authoritySha256: cosAuthoritySha256(authority),
  uploadLedgerSha256: cosUploadLedgerSha256(uploadLedger),
  version: authority.version,
  baseUrl: authority.baseUrl,
  sequencing: authority.sequencing,
  uploadCompletedAt: uploadLedger.uploadCompletedAt,
  verificationCompletedAt: new Date().toISOString(),
  objects: results,
};
const validated = validateCosEvidence(authority, output, uploadLedger);
output.status = validated.status === 'GREEN' ? 'PASS' : 'RED_STOP_LINE';
output.failures = validated.failures;
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.status !== 'PASS') process.exitCode = 2;
