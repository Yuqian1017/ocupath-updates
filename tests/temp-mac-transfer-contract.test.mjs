import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/attach-public-mac-09911-temp.yml', import.meta.url),
  'utf8',
);

test('temporary Mac transfer is manual, draft-only, exact-byte checked, and duplicate-safe', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /MAC_09911_COS_URL/);
  assert.match(workflow, /1318754674/);
  assert.match(workflow, /146a0d91eb608083b702a8cd7f970da938eff45f29e67c9d8212da02c96e0897/);
  assert.match(workflow, /isDraft.*true/);
  assert.match(workflow, /test -z/);
  assert.doesNotMatch(workflow, /release edit|--draft=false|git tag|update-ref|force/);
});
