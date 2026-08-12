#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createWriteStream, readFileSync, statSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

const authorityPath = process.argv[2];
if (!authorityPath) throw new Error('Usage: verify-cos-assets.mjs <COS_UPLOAD_AUTHORITY.json>');

const authority = JSON.parse(readFileSync(authorityPath, 'utf8'));
const results = [];

for (const object of authority.objects) {
  const url = `${authority.baseUrl}/${encodeURIComponent(object.key)}`;
  const result = { key: object.key, expectedBytes: object.bytes, expectedSha256: object.sha256 };
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    result.headStatus = head.status;
    result.contentLength = Number(head.headers.get('content-length'));
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

    const target = join(tmpdir(), `ocupath-cos-verify-${process.pid}-${basename(object.key)}`);
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
    result.status = bytes === object.bytes && result.fullSha256 === object.sha256 ? 'PASS' : 'FAIL';
    if (statSync(target).size !== bytes) throw new Error('temporary stream size mismatch');
    await import('node:fs/promises').then(({ unlink }) => unlink(target));
  } catch (error) {
    result.status = 'FAIL';
    result.error = error instanceof Error ? error.message : String(error);
  }
  results.push(result);
}

const output = {
  schemaVersion: 1,
  baseUrl: authority.baseUrl,
  status: results.every((result) => result.status === 'PASS') ? 'PASS' : 'RED_STOP_LINE',
  results,
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.status !== 'PASS') process.exitCode = 2;
