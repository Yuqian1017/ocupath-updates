import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  validateCosEvidence,
  validateCosUploadLedger,
} from './cos-publication.mjs';

const verifierPath = fileURLToPath(new URL('./verify-cos-assets.mjs', import.meta.url));
const execFileAsync = promisify(execFile);

export async function runLiveCosGate(authorityPath, uploadLedgerPath) {
  const authority = JSON.parse(readFileSync(authorityPath, 'utf8'));
  const uploadLedger = JSON.parse(readFileSync(uploadLedgerPath, 'utf8'));
  const ledger = validateCosUploadLedger(authority, uploadLedger);
  if (ledger.status !== 'GREEN') {
    return { status: 'RED_STOP_LINE', failures: ledger.failures, evidence: undefined };
  }
  let stdout = '';
  let processPassed = true;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [verifierPath, authorityPath, uploadLedgerPath], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch (error) {
    processPassed = false;
    stdout = typeof error.stdout === 'string' ? error.stdout : error.stdout?.toString?.() ?? '';
    if (!stdout) {
      return {
        status: 'RED_STOP_LINE',
        failures: [`live COS verifier failed without parseable output: ${error.message}`],
        evidence: undefined,
      };
    }
  }
  let evidence;
  try {
    evidence = JSON.parse(stdout);
  } catch (error) {
    return {
      status: 'RED_STOP_LINE',
      failures: [`live COS verifier output is not JSON: ${error.message}`],
      evidence: undefined,
    };
  }
  const validation = validateCosEvidence(authority, evidence, uploadLedger);
  const failures = [...validation.failures];
  if (!processPassed || evidence.status !== 'PASS') failures.push('live COS verifier process did not PASS');
  return {
    status: failures.length === 0 ? 'GREEN' : 'RED_STOP_LINE',
    failures,
    evidence,
  };
}
